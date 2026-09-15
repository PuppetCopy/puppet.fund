// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AccountModule} from "./AccountModule.sol";
import {DepositRoute} from "./DepositRoute.sol";
import {Register} from "./Register.sol";
import {Access} from "../utils/auth/Access.sol";
import {AccountLib} from "../utils/AccountLib.sol";
import {BalanceLib} from "../utils/BalanceLib.sol";
import {CallLib} from "../utils/CallLib.sol";
import {Error} from "../utils/Error.sol";
import {IntentLib} from "../utils/IntentLib.sol";
import {SwapLib} from "../utils/SwapLib.sol";
import {TransferUtils} from "../utils/TransferUtils.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";
import {IWNT} from "../utils/interfaces/IWNT.sol";
import {NATIVE_TOKEN} from "../utils/Native.sol";

bytes32 constant SCHEDULED_CREDIT_TYPEHASH =
    keccak256("ScheduledCredit(address token,uint256 amount,uint256 expiry,uint256 fee)");

contract Deposit is Access {
    struct ScheduledCredit {
        address token;
        uint amount;
        uint expiry;
        uint fee;
    }

    struct DepositSwap {
        AccountLib.IntentHeader header;
        SwapLib.SwapParams swap;
        uint destinationChainId;
    }

    AccountModule public immutable accountModule;
    Register internal immutable registerModule;
    IWNT internal immutable wnt;

    constructor(
        address _authority,
        AccountModule _accountModule,
        Register _register,
        IWNT _wnt
    ) Access(_authority) {
        if (address(_accountModule) == address(0) || address(_register) == address(0) || address(_wnt) == address(0)) {
            revert Error.Gate__InvalidModule();
        }
        accountModule = _accountModule;
        registerModule = _register;
        wnt = _wnt;
    }

    function deposit(
        address _user,
        address _to,
        address _token,
        uint _amount,
        uint _gasLimit
    ) external payable auth {
        if (_amount == 0) revert Error.Balance__ZeroAmount();
        IntentLib.verifyRegisteredTokenAndCap(registerModule, _token, _amount);
        uint _attachable = _token == NATIVE_TOKEN || _token == address(wnt) ? _amount : 0;
        if (msg.value > _attachable) revert Error.Balance__ValueMismatch(msg.value, _attachable);
        uint _pull = _amount - msg.value;
        if (_token == NATIVE_TOKEN) {
            if (_pull > 0) {
                TransferUtils.transferStrictlyFrom(wnt, _user, address(this), _pull, _gasLimit);
                wnt.withdraw(_pull);
            }
            TransferUtils.transferStrictly(NATIVE_TOKEN, _to, _amount, _gasLimit);
        } else {
            if (msg.value > 0) {
                wnt.deposit{value: msg.value}();
                TransferUtils.transferStrictly(address(wnt), _to, msg.value, _gasLimit);
            }
            if (_pull > 0) TransferUtils.transferStrictlyFrom(IERC20(_token), _user, _to, _pull, _gasLimit);
        }
    }

    function depositAcross(
        address _account,
        DepositSwap calldata _intent,
        bytes32 _digest,
        bytes calldata _intentSignature,
        address _attestor,
        address _feeReceiver,
        uint _maxRelayFeeBps,
        uint _gasLimit
    ) external auth {
        SwapLib.SwapParams calldata _swap = _intent.swap;
        address _input = _swap.inputToken;
        uint _fee = _intent.header.fee;
        if (_intent.header.feeToken != _input) revert Error.Intent__FeeTokenMismatch(_intent.header.feeToken, _input);
        SwapLib.verify(registerModule, _swap, _fee, _maxRelayFeeBps);

        bool _local = _intent.destinationChainId == block.chainid;
        bool _fused = _input == NATIVE_TOKEN || _input == address(wnt);
        if (_local) {
            if (
                _swap.outputToken == _input
                    || (_fused && (_swap.outputToken == NATIVE_TOKEN || _swap.outputToken == address(wnt)))
            ) {
                revert Error.Balance__InvalidDeposit();
            }
            IntentLib.verifyRegisteredTokenAndCap(registerModule, _swap.outputToken, _swap.outputAmount);
        }

        address _route = accountModule.predictDepositRoute(_intent.header.user);
        uint _convert;
        if (_fused) {
            uint _wrapped = BalanceLib.balanceOf(address(wnt), _route);
            uint _held = _wrapped + BalanceLib.balanceOf(NATIVE_TOKEN, _route);
            if (_held < _swap.inputAmount) revert Error.Balance__InsufficientBalance(_held, _swap.inputAmount);
            if (_input == NATIVE_TOKEN) {
                _convert = _wrapped < _swap.inputAmount ? _wrapped : _swap.inputAmount;
            } else if (_wrapped < _swap.inputAmount) {
                _convert = _swap.inputAmount - _wrapped;
            }
        } else {
            uint _held = BalanceLib.balanceOf(_input, _route);
            if (_held < _swap.inputAmount) revert Error.Balance__InsufficientBalance(_held, _swap.inputAmount);
        }

        IAccount.Call[] memory _calls = SwapLib.calls(
            _input, _swap.inputAmount, _feeReceiver, _fee, _swap.provider, _swap.providerCallData, _gasLimit
        );
        uint _n = _convert > 0 ? 1 : 0;
        IAccount.Call[] memory _legs = new IAccount.Call[](_calls.length + _n);
        if (_convert > 0) {
            _legs[0] = _input == address(wnt)
                ? IAccount.Call({
                    target: address(wnt),
                    value: _convert,
                    gasLimit: _gasLimit,
                    callData: abi.encodeCall(IWNT.deposit, ())
                })
                : IAccount.Call({
                    target: address(wnt),
                    value: 0,
                    gasLimit: _gasLimit,
                    callData: abi.encodeCall(IWNT.withdraw, (_convert))
                });
        }
        for (uint _i; _i < _calls.length; ++_i) {
            _legs[_n + _i] = _calls[_i];
        }
        IAccount.Call[] memory _outer = new IAccount.Call[](1);
        _outer[0] = IAccount.Call({
            target: _route, value: 0, gasLimit: 0, callData: abi.encodeCall(DepositRoute.execute, (_legs))
        });

        uint _outputFloor = _local ? _swap.outputAmount : 0;
        uint _outputBefore = _local ? BalanceLib.balanceOf(_swap.outputToken, _route) : 0;
        accountModule.dispatch(
            IAccount(_account),
            _attestor,
            _digest,
            _intentSignature,
            abi.encode(
                msg.sig,
                _intent.destinationChainId,
                _input,
                _swap.inputAmount,
                _swap.outputToken,
                _outputFloor
            ),
            _outer
        );
        if (_local) {
            uint _received = BalanceLib.balanceOf(_swap.outputToken, _route) - _outputBefore;
            if (_received < _swap.outputAmount) {
                revert Error.Balance__DepositNotReceived(_swap.outputToken, _received, _swap.outputAmount);
            }
        }
    }

    function settleCredit(
        address _account,
        address _user,
        ScheduledCredit calldata _claim,
        bytes32 _digest,
        bytes calldata _signature,
        address _attestor,
        address _feeReceiver,
        uint _maxRelayFeeBps,
        uint _gasLimit
    ) external auth {
        if (block.timestamp > _claim.expiry) revert Error.Schedule__Expired(_claim.expiry, block.timestamp);
        if (_claim.fee == 0) revert Error.Intent__ZeroRelayFee(_account);
        accountModule.markConsumed(_digest);
        address _route = accountModule.predictDepositRoute(_user);
        address _token = _claim.token;
        bool _fused = _token == NATIVE_TOKEN || _token == address(wnt);
        uint _convert =
            _fused ? BalanceLib.balanceOf(_token == address(wnt) ? NATIVE_TOKEN : address(wnt), _route) : 0;
        uint _arrived = BalanceLib.balanceOf(_token, _route) + _convert;
        if (_arrived < _claim.amount) revert Error.Schedule__NotArrived(_token, _arrived, _claim.amount);
        IntentLib.verifyRegisteredTokenAndCap(registerModule, _token, _claim.amount);
        IntentLib.verifyRelayFeeRatio(_claim.fee, _arrived, _maxRelayFeeBps);

        IAccount.Call[] memory _pays = new IAccount.Call[](_convert > 0 ? 2 : 1);
        uint _n;
        if (_convert > 0) {
            _pays[0] = _token == address(wnt)
                ? IAccount.Call({
                    target: address(wnt),
                    value: _convert,
                    gasLimit: _gasLimit,
                    callData: abi.encodeCall(IWNT.deposit, ())
                })
                : IAccount.Call({
                    target: address(wnt),
                    value: 0,
                    gasLimit: _gasLimit,
                    callData: abi.encodeCall(IWNT.withdraw, (_convert))
                });
            _n = 1;
        }
        _pays[_n] = CallLib.pay(_token, _account, _arrived, _gasLimit);
        IAccount.Call[] memory _legs = new IAccount.Call[](2);
        _legs[0] = IAccount.Call({
            target: _route, value: 0, gasLimit: 0, callData: abi.encodeCall(DepositRoute.execute, (_pays))
        });
        _legs[1] = CallLib.pay(_token, _feeReceiver, _claim.fee, _gasLimit);
        accountModule.dispatch(
            IAccount(_account),
            _attestor,
            _digest,
            _signature,
            abi.encode(msg.sig, _token, _claim.amount, _claim.expiry, _claim.fee, _arrived),
            _legs
        );
    }

    receive() external payable {
        if (msg.sender != address(wnt)) revert Error.Access__Unauthorized();
    }
}
