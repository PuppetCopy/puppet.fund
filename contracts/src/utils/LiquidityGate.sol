// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {RATE_PRECISION} from "./IntentLib.sol";
import {Error} from "./Error.sol";

import {AccountLib} from "./AccountLib.sol";
import {BalanceLib} from "./BalanceLib.sol";
import {CallLib} from "./CallLib.sol";
import {NATIVE_TOKEN} from "./Native.sol";
import {SwapLib} from "./SwapLib.sol";
import {AccountModule} from "../core/AccountModule.sol";
import {EscrowStore} from "../core/EscrowStore.sol";
import {FundAccount} from "../core/FundAccount.sol";
import {UserAccount} from "../core/UserAccount.sol";
import {Deposit} from "../core/Deposit.sol";
import {IAccount} from "./interfaces/IAccount.sol";
import {IWNT} from "./interfaces/IWNT.sol";
import {GateConfig} from "./GateConfig.sol";

bytes32 constant DEPOSIT_ACROSS_INTENT_TYPEHASH = keccak256(
    "DepositAcrossIntent(IntentHeader header,uint256 destinationChainId,SwapParams swap)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)SwapParams(address inputToken,uint256 inputAmount,address outputToken,uint256 outputAmount,address provider,bytes providerCallData)"
);

bytes32 constant FUND_SWAP_INTENT_TYPEHASH = keccak256(
    "FundSwapIntent(IntentHeader header,uint256 destinationChainId,SwapParams swap)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)SwapParams(address inputToken,uint256 inputAmount,address outputToken,uint256 outputAmount,address provider,bytes providerCallData)"
);

bytes32 constant RETIRE_ESCROW_INTENT_TYPEHASH = keccak256(
    "RetireEscrowIntent(IntentHeader header,address token,uint256 amount)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

bytes32 constant WITHDRAW_INTENT_TYPEHASH = keccak256(
    "WithdrawIntent(IntentHeader header,uint256 destinationChainId,SwapParams swap)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)SwapParams(address inputToken,uint256 inputAmount,address outputToken,uint256 outputAmount,address provider,bytes providerCallData)"
);

abstract contract LiquidityGate {
    struct RetireEscrowIntent {
        AccountLib.IntentHeader header;
        address token;
        uint amount;
    }

    AccountModule internal immutable accountModule;
    Deposit public immutable depositModule;
    EscrowStore public immutable escrowStore;

    address internal immutable attestor;
    address internal immutable feeReceiver;
    uint internal immutable transferGasLimit;
    uint internal immutable maxIntentTtl;
    uint internal immutable maxRelayFeeBps;
    uint internal immutable maxSwapRelayFeeBps;

    constructor(
        AccountModule _accountModule,
        Deposit _depositModule,
        EscrowStore _escrowStore,
        GateConfig memory _config
    ) {
        if (
            address(_accountModule) == address(0) || address(_depositModule) == address(0)
                || address(_escrowStore) == address(0) || _config.attestor == address(0)
                || _config.feeReceiver == address(0) || _config.transferGasLimit == 0 || _config.maxIntentTtl == 0
        ) {
            revert Error.Gate__InvalidModule();
        }
        if (_config.maxRelayFeeBps >= RATE_PRECISION) {
            revert Error.Gate__InvalidRelayFeeBps(_config.maxRelayFeeBps);
        }
        if (_config.maxSwapRelayFeeBps >= RATE_PRECISION) {
            revert Error.Gate__InvalidRelayFeeBps(_config.maxSwapRelayFeeBps);
        }
        accountModule = _accountModule;
        depositModule = _depositModule;
        escrowStore = _escrowStore;
        attestor = _config.attestor;
        feeReceiver = _config.feeReceiver;
        transferGasLimit = _config.transferGasLimit;
        maxIntentTtl = _config.maxIntentTtl;
        maxRelayFeeBps = _config.maxRelayFeeBps;
        maxSwapRelayFeeBps = _config.maxSwapRelayFeeBps;
    }

    function getConfig() public view returns (GateConfig memory) {
        return GateConfig({
            attestor: attestor,
            feeReceiver: feeReceiver,
            transferGasLimit: transferGasLimit,
            maxIntentTtl: maxIntentTtl,
            maxRelayFeeBps: maxRelayFeeBps,
            maxSwapRelayFeeBps: maxSwapRelayFeeBps
        });
    }

    function _deriveBody(
        address _body,
        address _owner,
        AccountLib.Genesis calldata _genesis
    ) internal virtual {
        if (_body.codehash != accountModule.bodyHash()) revert Error.Account__NotDelegated(_body);
        (address _module,) = FundAccount(payable(_body)).bound();
        if (_module == address(0)) {
            accountModule.createUserAccount(_owner);
            accountModule.createAccount(_body, _genesis.parent, _genesis.key, _genesis.approval);
        }
        _verifyBody(_body, _owner);
    }

    function _verifyBody(
        address _body,
        address _owner
    ) internal view {
        if (_body.codehash != accountModule.bodyHash()) revert Error.Account__NotDelegated(_body);
        (address _module, address _parent) = FundAccount(payable(_body)).bound();
        if (_module != address(accountModule) || _parent != accountModule.predictUserAccount(_owner)) {
            revert Error.Account__HeaderMismatch(_body);
        }
    }

    function _verifyUser(
        address _account,
        address _user
    ) internal {
        if (accountModule.createUserAccount(_user) != _account) revert Error.Account__HeaderMismatch(_account);
    }

    function _authorize(
        AccountLib.IntentHeader calldata _header
    ) internal view {
        uint _expected = IAccount(_header.account).nonce();
        if (_header.nonce != _expected) revert Error.Account__NonceMismatch(_header.account, _expected, _header.nonce);
        if (block.timestamp > _header.deadline) revert Error.Intent__ExpiredDeadline(_header.deadline, block.timestamp);
        if (_header.deadline > block.timestamp + maxIntentTtl) {
            revert Error.Intent__DeadlineTooFar(_header.deadline, block.timestamp, maxIntentTtl);
        }
        if (_header.fee == 0) revert Error.Intent__ZeroRelayFee(_header.account);
    }

    function deposit(
        address _token,
        uint _amount
    ) external payable {
        address _account = accountModule.createUserAccount(msg.sender);
        depositModule.deposit{value: msg.value}(msg.sender, _account, _token, _amount, getConfig());
        accountModule.record(
            _account,
            bytes32(0),
            abi.encode(msg.sig, _token, _amount, msg.value),
            _token == NATIVE_TOKEN
                ? BalanceLib.list(NATIVE_TOKEN, address(depositModule.wnt()))
                : BalanceLib.list(_token)
        );
    }

    function depositEscrow(
        address _token,
        uint _amount
    ) external payable {
        if (_token == NATIVE_TOKEN) revert Error.Balance__InvalidDeposit();
        address _account = accountModule.createUserAccount(msg.sender);
        depositModule.deposit{value: msg.value}(msg.sender, address(escrowStore), _token, _amount, getConfig());
        uint _escrowed = escrowStore.escrow(_account, _token, _amount);
        accountModule.record(
            _account, bytes32(0), abi.encode(msg.sig, _token, _amount, msg.value, _escrowed), new address[](0)
        );
    }

    function retireEscrow(
        RetireEscrowIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        address _account = _intent.header.account;
        _verifyUser(_account, _intent.header.user);
        bytes32 _structHash = keccak256(
            abi.encode(RETIRE_ESCROW_INTENT_TYPEHASH, AccountLib.hashHeader(_intent.header), _intent.token, _intent.amount)
        );
        _authorize(_intent.header);
        if (_intent.amount == 0) revert Error.Balance__ZeroAmount();
        address _token = _intent.token == NATIVE_TOKEN ? address(depositModule.wnt()) : _intent.token;
        IAccount.Call[] memory _legs = new IAccount.Call[](_token == _intent.token ? 2 : 3);
        uint _n;
        if (_token != _intent.token) {
            _legs[_n++] = IAccount.Call({
                target: _token, value: _intent.amount, gasLimit: 0, callData: abi.encodeCall(IWNT.deposit, ())
            });
        }
        _legs[_n++] = CallLib.pay(_token, address(escrowStore), _intent.amount, transferGasLimit);
        _legs[_n] = CallLib.pay(_intent.header.feeToken, feeReceiver, _intent.header.fee, transferGasLimit);
        uint _escrowed = escrowStore.escrowedMap(_account, _token) + _intent.amount;
        accountModule.dispatch(
            IAccount(_account),
            attestor,
            _structHash,
            _intent.header.deadline,
            _coSig,
            abi.encode(msg.sig, _token, _intent.amount, _escrowed, _intent.header.feeToken, _intent.header.fee),
            _legs,
            BalanceLib.list(_intent.token, _intent.header.feeToken)
        );
        escrowStore.escrow(_account, _token, _intent.amount);
    }

    function requestReturn(
        address _token
    ) external {
        address _account = accountModule.predictUserAccount(msg.sender);
        if (_account.code.length == 0) revert Error.Account__InvalidUser();
        uint _returnAt = escrowStore.requestReturn(_account, _token);
        accountModule.record(_account, bytes32(0), abi.encode(msg.sig, _token, _returnAt), new address[](0));
    }

    function returnEscrow(
        address _token
    ) external {
        address _account = accountModule.predictUserAccount(msg.sender);
        if (_account.code.length == 0) revert Error.Account__InvalidUser();
        uint _returned = escrowStore.refund(_account, _token, transferGasLimit);
        accountModule.record(_account, bytes32(0), abi.encode(msg.sig, _token, _returned), new address[](0));
    }

    function depositAcross(
        Deposit.SwapIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        address _account = _intent.header.account;
        _verifyUser(_account, _intent.header.user);
        bytes32 _structHash = keccak256(
            abi.encode(
                DEPOSIT_ACROSS_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                _intent.destinationChainId,
                SwapLib.hashSwap(_intent.swap)
            )
        );
        _authorize(_intent.header);
        depositModule.depositAcross(_account, _intent, _structHash, _coSig, getConfig());
    }

    function fundSwap(
        Deposit.SwapIntent calldata _intent,
        bytes calldata _coSig,
        AccountLib.Genesis calldata _genesis
    ) external {
        address _account = _intent.header.account;
        _deriveBody(_account, _intent.header.user, _genesis);
        bytes32 _structHash = keccak256(
            abi.encode(
                FUND_SWAP_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                _intent.destinationChainId,
                SwapLib.hashSwap(_intent.swap)
            )
        );
        _authorize(_intent.header);
        depositModule.fundSwap(_account, _intent, _structHash, _coSig, getConfig());
    }

    function withdraw(
        Deposit.SwapIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        address _account = _intent.header.account;
        _verifyUser(_account, _intent.header.user);
        bytes32 _structHash = keccak256(
            abi.encode(
                WITHDRAW_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                _intent.destinationChainId,
                SwapLib.hashSwap(_intent.swap)
            )
        );
        _authorize(_intent.header);
        depositModule.withdraw(_account, _intent, _structHash, _coSig, getConfig());
    }
}
