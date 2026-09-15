// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {BaseGate} from "./utils/BaseGate.sol";
import {BalanceLib} from "./utils/BalanceLib.sol";
import {CallLib} from "./utils/CallLib.sol";
import {Error} from "./utils/Error.sol";
import {IntentLib, RATE_PRECISION} from "./utils/IntentLib.sol";
import {AccountLib} from "./utils/AccountLib.sol";
import {SwapLib} from "./utils/SwapLib.sol";
import {AccountModule} from "./core/AccountModule.sol";
import {Deposit, SCHEDULED_CREDIT_TYPEHASH} from "./core/Deposit.sol";
import {DepositRoute} from "./core/DepositRoute.sol";
import {Register} from "./core/Register.sol";
import {IAccount} from "./utils/interfaces/IAccount.sol";

bytes32 constant DEPOSIT_SWAP_TYPEHASH = keccak256(
    "DepositSwap(IntentHeader header,SwapParams swap,uint256 destinationChainId)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)SwapParams(address inputToken,uint256 inputAmount,address outputToken,uint256 outputAmount,address provider,bytes providerCallData)"
);

bytes32 constant WITHDRAW_INTENT_TYPEHASH = keccak256(
    "WithdrawIntent(IntentHeader header,SwapParams swap,uint256 destinationChainId)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)SwapParams(address inputToken,uint256 inputAmount,address outputToken,uint256 outputAmount,address provider,bytes providerCallData)"
);

bytes32 constant OPERATE_INTENT_TYPEHASH = keccak256(
    "OperateIntent(IntentHeader header,bytes32 creditListHash,uint256 cycle,address token,uint256 value,uint256 collateral,uint256 skin,uint256 backed,bytes32 backingListHash,bytes32 callListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

bytes32 constant SETTLE_INTENT_TYPEHASH = keccak256(
    "SettleIntent(IntentHeader header,uint256 cycle,address token,uint256 value,bytes32 gainListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

contract CoreGate is BaseGate {
    struct WithdrawIntent {
        AccountLib.IntentHeader header;
        SwapLib.SwapParams swap;
        uint destinationChainId;
    }

    struct OperateIntent {
        AccountLib.IntentHeader header;
        address[] creditList;
        uint cycle;
        address token;
        uint value;
        uint collateral;
        uint skin;
        uint backed;
        AccountLib.Backing[] backingList;
        IAccount.Call[] callList;
    }

    struct Outcome {
        address puppet;
        uint amount;
        AccountLib.Mandate mandate;
    }

    struct SettleIntent {
        AccountLib.IntentHeader header;
        uint cycle;
        address token;
        uint value;
        Outcome[] gainList;
    }

    Deposit public immutable depositModule;

    constructor(
        AccountModule _accountModule,
        Register _register,
        Deposit _depositModule,
        Config memory _config
    ) BaseGate(_accountModule, _register, _config) {
        if (address(_depositModule) == address(0)) revert Error.Gate__InvalidModule();
        depositModule = _depositModule;
    }

    function depositRoute(
        address _token,
        uint _amount
    ) external payable {
        depositModule.deposit{value: msg.value}(
            msg.sender, accountModule.predictDepositRoute(msg.sender), _token, _amount, transferGasLimit
        );
    }

    function deposit(
        address _account,
        address _token,
        uint _amount
    ) external payable {
        address _user = accountModule.userOf(_account);
        if (_user != msg.sender) revert Error.Account__UnauthorizedCaller();
        depositModule.deposit{value: msg.value}(_user, _account, _token, _amount, transferGasLimit);
        accountModule.record(_account, bytes32(0), abi.encode(msg.sig, _token, _amount));
    }

    function depositAcross(
        Deposit.DepositSwap calldata _intent,
        bytes calldata _intentSignature,
        AccountLib.Genesis calldata _genesis
    ) external {
        address _account = _intent.header.account;
        _deriveAccount(_account, _intent.header.user, _genesis);
        bytes32 _intentDigest = _authorize(
            _intent.header,
            keccak256(
                abi.encode(
                    DEPOSIT_SWAP_TYPEHASH,
                    AccountLib.hashHeader(_intent.header),
                    SwapLib.hashSwap(_intent.swap),
                    _intent.destinationChainId
                )
            )
        );
        depositModule.depositAcross(
            _account, _intent, _intentDigest, _intentSignature, attestor, feeReceiver, maxRelayFeeBps, transferGasLimit
        );
    }

    function credit(
        address _account,
        address _user,
        Deposit.ScheduledCredit calldata _claim,
        bytes calldata _claimSignature,
        AccountLib.Genesis calldata _genesis
    ) external {
        _deriveAccount(_account, _user, _genesis);
        bytes32 _digest = AccountLib.typedDigest(
            block.chainid,
            _account,
            keccak256(abi.encode(SCHEDULED_CREDIT_TYPEHASH, _claim.token, _claim.amount, _claim.expiry, _claim.fee))
        );
        depositModule.settleCredit(
            _account, _user, _claim, _digest, _claimSignature, attestor, feeReceiver, maxRelayFeeBps, transferGasLimit
        );
    }

    function withdraw(
        WithdrawIntent calldata _intent,
        bytes calldata _intentSignature
    ) external {
        address _account = _intent.header.account;
        _existingAccount(_account, _intent.header.user);
        bytes32 _intentDigest = _authorize(
            _intent.header,
            keccak256(
                abi.encode(
                    WITHDRAW_INTENT_TYPEHASH,
                    AccountLib.hashHeader(_intent.header),
                    SwapLib.hashSwap(_intent.swap),
                    _intent.destinationChainId
                )
            )
        );
        if (_intent.header.feeToken != _intent.swap.inputToken) {
            revert Error.Intent__FeeTokenMismatch(_intent.header.feeToken, _intent.swap.inputToken);
        }
        if (_intent.swap.inputAmount == 0) revert Error.Balance__NothingToWithdraw();
        uint _held = BalanceLib.balanceOf(_intent.swap.inputToken, _account);
        if (_held < _intent.swap.inputAmount) {
            revert Error.Balance__InsufficientBalance(_held, _intent.swap.inputAmount);
        }

        IAccount.Call[] memory _legs;
        if (_intent.swap.provider == address(0)) {
            IntentLib.verifyRelayFeeRatio(_intent.header.fee, _intent.swap.inputAmount, maxRelayFeeBps);
            if (
                _intent.destinationChainId != block.chainid || _intent.swap.inputToken != _intent.swap.outputToken
                    || _intent.swap.outputAmount != _intent.swap.inputAmount - _intent.header.fee
            ) {
                revert Error.Balance__InvalidWithdraw();
            }
            _legs = new IAccount.Call[](2);
            _legs[0] = CallLib.pay(
                _intent.swap.inputToken,
                _intent.header.user,
                _intent.swap.inputAmount - _intent.header.fee,
                transferGasLimit
            );
            _legs[1] = _feeLeg(_intent.header);
        } else {
            SwapLib.verify(registerModule, _intent.swap, _intent.header.fee, maxRelayFeeBps);
            _legs = SwapLib.calls(
                _intent.swap.inputToken,
                _intent.swap.inputAmount,
                feeReceiver,
                _intent.header.fee,
                _intent.swap.provider,
                _intent.swap.providerCallData,
                transferGasLimit
            );
        }

        bool _measurable = _intent.swap.provider != address(0) && _intent.destinationChainId == block.chainid;
        uint _outputBefore = _measurable ? BalanceLib.balanceOf(_intent.swap.outputToken, _intent.header.user) : 0;
        accountModule.dispatch(
            IAccount(_account),
            attestor,
            _intentDigest,
            _intentSignature,
            abi.encode(
                msg.sig,
                _intent.destinationChainId,
                _intent.swap.inputToken,
                _intent.swap.inputAmount,
                _intent.swap.outputToken,
                _measurable ? _intent.swap.outputAmount : 0
            ),
            _legs
        );
        if (_measurable) {
            uint _received = BalanceLib.balanceOf(_intent.swap.outputToken, _intent.header.user) - _outputBefore;
            if (_received < _intent.swap.outputAmount) {
                revert Error.Balance__SwapOutputNotReceived(
                    _intent.swap.outputToken, _received, _intent.swap.outputAmount
                );
            }
        }
    }

    function operate(
        OperateIntent calldata _intent,
        bytes calldata _intentSignature
    ) external {
        address _master = _intent.header.account;
        _existingAccount(_master, _intent.header.user);
        bytes32 _digest = _authorize(
            _intent.header,
            keccak256(
                abi.encode(
                    OPERATE_INTENT_TYPEHASH,
                    AccountLib.hashHeader(_intent.header),
                    keccak256(abi.encode(_intent.creditList)),
                    _intent.cycle,
                    _intent.token,
                    _intent.value,
                    _intent.collateral,
                    _intent.skin,
                    _intent.backed,
                    keccak256(abi.encode(_intent.backingList)),
                    keccak256(abi.encode(_intent.callList))
                )
            )
        );
        IntentLib.verifyRegisteredTokenAndCap(registerModule, _intent.header.feeToken, _intent.header.fee);
        address _route = accountModule.predictDepositRoute(_intent.header.user);
        uint _tokens = _intent.creditList.length;
        uint[] memory _amountList = new uint[](_tokens);
        IAccount.Call[] memory _pays = new IAccount.Call[](_tokens);
        uint _paid;
        for (uint _i; _i < _tokens; ++_i) {
            address _token = _intent.creditList[_i];
            if (_i > 0 && uint160(_token) <= uint160(_intent.creditList[_i - 1])) {
                revert Error.Credit__ListNotSorted(_intent.creditList[_i - 1], _token);
            }
            if (registerModule.capMap(_token) == 0) revert Error.Intent__TokenNotValuable(_token);
            uint _amount = BalanceLib.balanceOf(_token, _route);
            _amountList[_i] = _amount;
            if (_amount > 0) {
                _pays[_paid] = CallLib.pay(_token, _master, _amount, transferGasLimit);
                ++_paid;
            }
        }
        assembly ("memory-safe") {
            mstore(_pays, _paid)
        }

        uint _len = _intent.backingList.length;
        if (_len > maxCohortSize) revert Error.Operate__BackingListTooLong(_len, maxCohortSize);
        bytes32 _tokenId = registerModule.tokenIdMap(_intent.token);
        if (_tokenId == bytes32(0)) revert Error.Intent__TokenNotValuable(_intent.token);
        uint _backed = _intent.backed;
        for (uint _i; _i < _len; ++_i) {
            AccountLib.Backing calldata _row = _intent.backingList[_i];
            if (_i > 0 && uint160(_row.puppet) <= uint160(_intent.backingList[_i - 1].puppet)) {
                revert Error.Operate__BackingListNotSorted(_intent.backingList[_i - 1].puppet, _row.puppet);
            }
            bytes32 _mandateDigest = _verifyMandate(_master, _row.puppet, _row.mandate);
            if (block.timestamp > _row.mandate.expiry) revert Error.Mandate__Expired(_row.mandate.expiry);
            if (!AccountLib.listsToken(_row.mandate, _tokenId)) {
                revert Error.Mandate__TokenNotListed(_row.puppet, _intent.token);
            }
            if (_row.mandate.skin > RATE_PRECISION) {
                revert Error.Gate__InvalidAllocationRate(_row.mandate.skin);
            }
            uint _cap = Math.mulDiv(_intent.collateral, _row.mandate.skin, RATE_PRECISION);
            uint _rateCap = Math.mulDiv(_row.matchable, _row.mandate.allocationRate, RATE_PRECISION);
            if (_rateCap < _cap) _cap = _rateCap;
            if (_row.stake == 0 || _row.stake > _cap) {
                revert Error.Operate__BackingExceedsCap(_row.puppet, _row.stake, _cap);
            }
            _backed += _row.stake;
            accountModule.record(_row.puppet, _mandateDigest, abi.encode(msg.sig, _master, _intent.cycle, _row.stake));
        }
        if (_intent.skin > RATE_PRECISION) revert Error.Gate__InvalidAllocationRate(_intent.skin);
        if (_backed > Math.mulDiv(_intent.collateral, _intent.skin, RATE_PRECISION)) {
            revert Error.Operate__SkinExceeded(_backed, _intent.collateral);
        }

        uint _called = _intent.callList.length;
        uint _credits = _paid > 0 ? 1 : 0;
        IAccount.Call[] memory _legs = new IAccount.Call[](_called + _credits + 1);
        if (_credits > 0) {
            _legs[0] = IAccount.Call({
                target: _route, value: 0, gasLimit: 0, callData: abi.encodeCall(DepositRoute.execute, (_pays))
            });
        }
        for (uint _i; _i < _called; ++_i) {
            _legs[_credits + _i] = _intent.callList[_i];
        }
        _legs[_legs.length - 1] = _feeLeg(_intent.header);

        accountModule.dispatch(
            IAccount(_master),
            attestor,
            _digest,
            _intentSignature,
            abi.encode(
                msg.sig,
                _intent.creditList,
                _amountList,
                _intent.cycle,
                _intent.token,
                _intent.value,
                _intent.collateral,
                _intent.skin,
                _backed
            ),
            _legs
        );
    }

    function settle(
        SettleIntent calldata _intent,
        bytes calldata _intentSignature
    ) external {
        address _master = _intent.header.account;
        _existingAccount(_master, _intent.header.user);
        bytes32 _digest = _authorize(
            _intent.header,
            keccak256(
                abi.encode(
                    SETTLE_INTENT_TYPEHASH,
                    AccountLib.hashHeader(_intent.header),
                    _intent.cycle,
                    _intent.token,
                    _intent.value,
                    keccak256(abi.encode(_intent.gainList))
                )
            )
        );
        IntentLib.verifyRegisteredTokenAndCap(registerModule, _intent.header.feeToken, _intent.header.fee);

        uint _gains = _intent.gainList.length;
        if (_gains > maxCohortSize) revert Error.Gate__ListTooLong(_gains, maxCohortSize);
        bytes32 _tokenId = registerModule.tokenIdMap(_intent.token);
        if (_tokenId == bytes32(0)) revert Error.Intent__TokenNotValuable(_intent.token);
        IAccount.Call[] memory _legs = new IAccount.Call[](_gains + 1);
        for (uint _i; _i < _gains; ++_i) {
            Outcome calldata _g = _intent.gainList[_i];
            if (_i > 0 && uint160(_g.puppet) <= uint160(_intent.gainList[_i - 1].puppet)) {
                revert Error.Settle__RowsNotSorted(_intent.gainList[_i - 1].puppet, _g.puppet);
            }
            bytes32 _mandateDigest = _verifyMandate(_master, _g.puppet, _g.mandate);
            if (!AccountLib.listsToken(_g.mandate, _tokenId)) {
                revert Error.Mandate__TokenNotListed(_g.puppet, _intent.token);
            }
            uint _fee = Math.mulDiv(_g.amount, performanceFee, RATE_PRECISION);
            _legs[_i] = CallLib.pay(_intent.token, _g.puppet, _g.amount - _fee, transferGasLimit);
            accountModule.record(
                _g.puppet, _mandateDigest, abi.encode(msg.sig, _master, _intent.cycle, _intent.token, _g.amount, _g.amount - _fee)
            );
        }

        _legs[_gains] = _feeLeg(_intent.header);
        accountModule.dispatch(
            IAccount(_master),
            attestor,
            _digest,
            _intentSignature,
            abi.encode(msg.sig, _intent.cycle, _intent.token, _intent.value),
            _legs
        );
    }

    function _verifyMandate(
        address _master,
        address _puppet,
        AccountLib.Mandate calldata _mandate
    ) internal pure returns (bytes32 digest_) {
        if (_puppet == _master) revert Error.Gate__MasterAsPuppet(_master);
        if (_mandate.master != _master) revert Error.Mandate__Mismatch(_puppet, bytes32(0));
        digest_ = AccountLib.mandateDigest(_puppet, _mandate);
    }
}
