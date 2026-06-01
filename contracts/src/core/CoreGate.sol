// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Permission} from "../utils/auth/Permission.sol";
import {Error} from "../utils/Error.sol";
import {IntentLib} from "../utils/IntentLib.sol";
import {AccountLib} from "./AccountLib.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {IWNT} from "../utils/interfaces/IWNT.sol";

import {AccountModule, CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH} from "./module/AccountModule.sol";
import {WalletDepositModule} from "./module/WalletDepositModule.sol";
import {PuppetAccount} from "./PuppetAccount.sol";
import {TransientRoute} from "./TransientRoute.sol";
import {IAccount} from "./interface/IAccount.sol";
import {RegisterModule} from "./module/RegisterModule.sol";
import {IArbSys} from "../utils/interfaces/IArbSys.sol";

bytes32 constant WITHDRAW_INTENT_TYPEHASH = keccak256(
    "WithdrawIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,uint256 amount)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant SIGN_TRANSIENT_ROUTE_BALANCE_INTENT_TYPEHASH = keccak256(
    "SignTransientRouteBalanceIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,uint256 amount)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

contract CoreGate is Permission, EIP712 {
    struct Config {
        address attestor;
        address feeReceiver;
        uint transferGasLimit;
        uint maxBlockDelay;
        uint maxRelayFeeBps;
    }

    struct WithdrawIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        uint amount;
    }

    struct SignTransientRouteBalanceIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        uint amount;
    }

    IArbSys internal constant arbSys = IArbSys(address(100));

    AccountModule internal immutable accountModule;
    WalletDepositModule internal immutable walletDepositModule;
    RegisterModule internal immutable registerModule;

    address internal immutable attestor;
    address internal immutable feeReceiver;
    uint internal immutable transferGasLimit;
    uint internal immutable maxBlockDelay;
    uint internal immutable maxRelayFeeBps;

    constructor(
        IAuthority _authority,
        AccountModule _accountGate,
        WalletDepositModule _walletDeposit,
        RegisterModule _register,
        Config memory _config
    ) Permission(_authority) EIP712("CoreGate", "1") {
        if (
            address(_accountGate) == address(0) || address(_walletDeposit) == address(0)
                || address(_register) == address(0)
        ) revert Error.Gate__InvalidModule();
        accountModule = _accountGate;
        walletDepositModule = _walletDeposit;
        registerModule = _register;
        attestor = _config.attestor;
        feeReceiver = _config.feeReceiver;
        transferGasLimit = _config.transferGasLimit;
        maxBlockDelay = _config.maxBlockDelay;
        maxRelayFeeBps = _config.maxRelayFeeBps;
    }

    function getConfig() external view returns (Config memory) {
        return Config({
            attestor: attestor,
            feeReceiver: feeReceiver,
            transferGasLimit: transferGasLimit,
            maxBlockDelay: maxBlockDelay,
            maxRelayFeeBps: maxRelayFeeBps
        });
    }

    function createPuppetAccount(
        AccountModule.CreatePuppetAccountIntent calldata _intent,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.initialDepositAmount, maxRelayFeeBps);
        IERC20 _feeToken = IntentLib.verifyTokenAndCap(registerModule, _intent.params.baseTokenId, address(0), 0);

        (PuppetAccount _puppetAccount, address _transientRoute) =
            accountModule.createPuppetAccount(_intent.params, _userDeploySig, _signerProof);

        IAccount.Call[] memory _trCalls = new IAccount.Call[](1);
        _trCalls[0] =
            _erc20TransferCall(_feeToken, address(_puppetAccount), _intent.initialDepositAmount, transferGasLimit);
        IAccount.Call[] memory _calls = new IAccount.Call[](1);
        _calls[0] = IAccount.Call({
            target: _transientRoute, value: 0, gasLimit: 0, callData: abi.encodeCall(TransientRoute.execute, (_trCalls))
        });

        accountModule.dispatch(
            _puppetAccount,
            _calls,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH,
                        AccountLib.hashAccount(_intent.params),
                        _intent.blockNumber,
                        _intent.deadline,
                        _intent.acceptableRelayFee,
                        _intent.nonce,
                        _intent.chainId,
                        _intent.initialDepositAmount
                    )
                )
            ),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce,
            _feeToken,
            _intent.initialDepositAmount,
            0,
            _actualRelayFee,
            feeReceiver,
            transferGasLimit
        );
    }

    function walletDeposit(
        AccountLib.AccountInitParams calldata _params,
        IERC20 _token,
        uint _amount
    ) external {
        address _transientRoute = accountModule.predictTransientRoute(accountModule.predictPuppetAccount(_params));
        walletDepositModule.deposit(msg.sender, _transientRoute, _token, _amount, transferGasLimit);
    }

    function walletDepositWnt(
        AccountLib.AccountInitParams calldata _params
    ) external payable {
        address _transientRoute = accountModule.predictTransientRoute(accountModule.predictPuppetAccount(_params));
        walletDepositModule.depositWnt{value: msg.value}(
            msg.sender, _transientRoute, registerModule.getWnt(), transferGasLimit
        );
    }

    function signTransientRouteBalance(
        SignTransientRouteBalanceIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.amount == 0) revert Error.Deposit__NothingToRecord();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IERC20 _token =
            IntentLib.verifyTokenAndCap(registerModule, _intent.params.baseTokenId, address(0), _intent.amount);
        PuppetAccount _puppetAccount = accountModule.verifyPuppetAccount(_intent.params);
        address _transientRoute = accountModule.predictTransientRoute(address(_puppetAccount));

        uint _trBalance = _token.balanceOf(_transientRoute);
        if (_trBalance < _intent.amount) revert Error.Deposit__InsufficientBalance(_trBalance, _intent.amount);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _puppetAccount.signedBalance() + _intent.amount, maxRelayFeeBps);

        IAccount.Call[] memory _trCalls = new IAccount.Call[](1);
        _trCalls[0] = _erc20TransferCall(_token, address(_puppetAccount), _intent.amount, transferGasLimit);
        IAccount.Call[] memory _calls = new IAccount.Call[](1);
        _calls[0] = IAccount.Call({
            target: _transientRoute, value: 0, gasLimit: 0, callData: abi.encodeCall(TransientRoute.execute, (_trCalls))
        });

        accountModule.dispatch(
            _puppetAccount,
            _calls,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        SIGN_TRANSIENT_ROUTE_BALANCE_INTENT_TYPEHASH,
                        AccountLib.hashAccount(_intent.params),
                        _intent.blockNumber,
                        _intent.deadline,
                        _intent.acceptableRelayFee,
                        _intent.nonce,
                        _intent.chainId,
                        _intent.amount
                    )
                )
            ),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce,
            _token,
            _intent.amount,
            0,
            _actualRelayFee,
            feeReceiver,
            transferGasLimit
        );

        _logEvent("SignTransientRouteBalance", abi.encode(_intent, _puppetAccount));
    }

    function walletWithdraw(
        WithdrawIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.amount == 0) revert Error.Deposit__NothingToWithdraw();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IERC20 _token =
            IntentLib.verifyTokenAndCap(registerModule, _intent.params.baseTokenId, address(0), _intent.amount);
        PuppetAccount _puppetAccount = accountModule.verifyPuppetAccount(_intent.params);

        uint _signed = _puppetAccount.signedBalance();
        if (_signed < _intent.amount) revert Error.Deposit__InsufficientBalance(_signed, _intent.amount);
        if (_actualRelayFee >= _intent.amount) revert Error.Deposit__RelayFeeTooHigh();
        uint _receiverAmount = _intent.amount - _actualRelayFee;

        IAccount.Call[] memory _calls = new IAccount.Call[](1);
        _calls[0] = _erc20TransferCall(_token, _intent.params.user, _receiverAmount, transferGasLimit);

        accountModule.dispatch(
            _puppetAccount,
            _calls,
            _hashWithdraw(_intent),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce,
            _token,
            0,
            _receiverAmount,
            _actualRelayFee,
            feeReceiver,
            transferGasLimit
        );

        _logEvent("Withdraw", abi.encode(_intent, _puppetAccount));
    }

    function walletWithdrawWnt(
        WithdrawIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.amount == 0) revert Error.Deposit__NothingToWithdraw();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyTokenAndCap(registerModule, _intent.params.baseTokenId, address(0), _intent.amount);
        IWNT _wnt = registerModule.getWnt();
        PuppetAccount _puppetAccount = accountModule.verifyPuppetAccount(_intent.params);

        uint _signed = _puppetAccount.signedBalance();
        if (_signed < _intent.amount) revert Error.Deposit__InsufficientBalance(_signed, _intent.amount);
        if (_actualRelayFee >= _intent.amount) revert Error.Deposit__RelayFeeTooHigh();
        uint _receiverAmount = _intent.amount - _actualRelayFee;

        IAccount.Call[] memory _calls = new IAccount.Call[](2);
        _calls[0] = IAccount.Call({
            target: address(_wnt),
            value: 0,
            gasLimit: transferGasLimit,
            callData: abi.encodeCall(IWNT.withdraw, (_receiverAmount))
        });
        _calls[1] = IAccount.Call({target: _intent.params.user, value: _receiverAmount, gasLimit: 50_000, callData: ""});

        accountModule.dispatch(
            _puppetAccount,
            _calls,
            _hashWithdraw(_intent),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce,
            IERC20(address(_wnt)),
            0,
            _receiverAmount,
            _actualRelayFee,
            feeReceiver,
            transferGasLimit
        );

        _logEvent("Withdraw", abi.encode(_intent, _puppetAccount));
    }

    function _erc20TransferCall(
        IERC20 _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return IAccount.Call({
            target: address(_token),
            value: 0,
            gasLimit: _gasLimit,
            callData: abi.encodeCall(IERC20.transfer, (_to, _amount))
        });
    }

    function _hashWithdraw(
        WithdrawIntent calldata _intent
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    WITHDRAW_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.amount
                )
            )
        );
    }

    function _blockNumber() internal view returns (uint) {
        return address(arbSys).code.length > 0 ? arbSys.arbBlockNumber() : block.number;
    }
}
