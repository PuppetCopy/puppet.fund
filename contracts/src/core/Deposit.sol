// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AccountModule} from "./AccountModule.sol";
import {Register} from "./Register.sol";
import {GateConfig} from "../utils/GateConfig.sol";
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

contract Deposit is Access {
    struct SwapIntent {
        AccountLib.IntentHeader header;
        uint destinationChainId;
        SwapLib.SwapParams swap;
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

    function depositEscrow(
        address _store,
        address _account,
        address _user,
        address _master,
        address _token,
        uint _amount,
        GateConfig calldata _config
    ) external payable auth {
        accountModule.record(
            _account, bytes32(0), abi.encode(msg.sig, _master, _token, _amount), new address[](0)
        );
        if (_token == NATIVE_TOKEN) {
            if (msg.value != _amount) revert Error.Balance__ValueMismatch(msg.value, _amount);
            TransferUtils.transferStrictly(NATIVE_TOKEN, _store, _amount, _config.transferGasLimit);
        } else {
            if (msg.value != 0) revert Error.Balance__ValueMismatch(msg.value, 0);
            TransferUtils.transferStrictlyFrom(IERC20(_token), _user, _store, _amount, _config.transferGasLimit);
        }
    }

    function deposit(
        address _account,
        address _user,
        address _token,
        uint _amount,
        GateConfig calldata _config
    ) external payable auth {
        if (_amount == 0) revert Error.Balance__ZeroAmount();
        IntentLib.verifyRegistered(registerModule, _token);
        uint _attachable = _token == NATIVE_TOKEN || _token == address(wnt) ? _amount : 0;
        if (msg.value > _attachable) revert Error.Balance__ValueMismatch(msg.value, _attachable);
        uint _pull = _amount - msg.value;
        if (_token == NATIVE_TOKEN) {
            if (msg.value > 0) TransferUtils.transferStrictly(NATIVE_TOKEN, _account, msg.value, _config.transferGasLimit);
            if (_pull > 0) TransferUtils.transferStrictlyFrom(wnt, _user, _account, _pull, _config.transferGasLimit);
        } else {
            if (msg.value > 0) {
                wnt.deposit{value: msg.value}();
                TransferUtils.transferStrictly(address(wnt), _account, msg.value, _config.transferGasLimit);
            }
            if (_pull > 0) TransferUtils.transferStrictlyFrom(IERC20(_token), _user, _account, _pull, _config.transferGasLimit);
        }
        accountModule.record(
            _account,
            bytes32(0),
            abi.encode(msg.sig, _user, _token, _amount, msg.value),
            _token == NATIVE_TOKEN || msg.value > 0 ? BalanceLib.list(_token, address(wnt)) : BalanceLib.list(_token)
        );
    }

    function depositAcross(
        address _account,
        SwapIntent calldata _intent,
        bytes32 _structHash,
        bytes calldata _coSig,
        GateConfig calldata _config
    ) external auth {
        SwapLib.SwapParams calldata _swap = _intent.swap;
        address _inputToken = _swap.inputToken;
        uint _fee = _intent.header.fee;
        if (_intent.header.feeToken != _inputToken) revert Error.Intent__FeeTokenMismatch(_intent.header.feeToken, _inputToken);
        SwapLib.verify(_swap, _fee, _config.maxRelayFeeBps);

        bool _local = _intent.destinationChainId == block.chainid;
        bool _fused = _inputToken == NATIVE_TOKEN || _inputToken == address(wnt);
        if (_local) {
            if (
                _swap.outputToken == _inputToken
                    || (_fused && (_swap.outputToken == NATIVE_TOKEN || _swap.outputToken == address(wnt)))
            ) {
                revert Error.Balance__InvalidDeposit();
            }
            IntentLib.verifyRegistered(registerModule, _swap.outputToken);
        }

        uint _convert;
        if (_fused) {
            uint _wrapped = BalanceLib.balanceOf(address(wnt), _account);
            uint _native = BalanceLib.balanceOf(NATIVE_TOKEN, _account);
            if (_wrapped + _native < _swap.inputAmount) {
                revert Error.Balance__InsufficientBalance(_wrapped + _native, _swap.inputAmount);
            }
            uint _heldForm = _inputToken == NATIVE_TOKEN ? _native : _wrapped;
            if (_heldForm < _swap.inputAmount) _convert = _swap.inputAmount - _heldForm;
        } else {
            uint _held = BalanceLib.balanceOf(_inputToken, _account);
            if (_held < _swap.inputAmount) revert Error.Balance__InsufficientBalance(_held, _swap.inputAmount);
        }

        IAccount.Call[] memory _calls = SwapLib.calls(
            _inputToken, _swap.inputAmount, _config.feeReceiver, _fee, _swap.provider, _swap.providerCallData, _config.transferGasLimit
        );
        uint _n = _convert > 0 ? 1 : 0;
        IAccount.Call[] memory _legs = new IAccount.Call[](_calls.length + _n);
        if (_convert > 0) {
            _legs[0] = _inputToken == address(wnt)
                ? IAccount.Call({
                    target: address(wnt),
                    value: _convert,
                    gasLimit: _config.transferGasLimit,
                    callData: abi.encodeCall(IWNT.deposit, ())
                })
                : IAccount.Call({
                    target: address(wnt),
                    value: 0,
                    gasLimit: _config.transferGasLimit,
                    callData: abi.encodeCall(IWNT.withdraw, (_convert))
                });
        }
        for (uint _i; _i < _calls.length; ++_i) {
            _legs[_n + _i] = _calls[_i];
        }
        address[] memory _tokenList = new address[]((_fused ? 2 : 1) + (_local ? 1 : 0));
        _tokenList[0] = _inputToken;
        if (_fused) _tokenList[1] = _inputToken == NATIVE_TOKEN ? address(wnt) : NATIVE_TOKEN;
        if (_local) _tokenList[_tokenList.length - 1] = _swap.outputToken;
        uint _outputBefore = _local ? BalanceLib.balanceOf(_swap.outputToken, _account) : 0;
        accountModule.dispatch(
            IAccount(_account),
            _config.attestor,
            _structHash,
            _coSig,
            abi.encode(
                msg.sig,
                _intent.destinationChainId,
                _inputToken,
                _swap.inputAmount,
                _swap.outputToken,
                _swap.outputAmount,
                _intent.header.feeToken,
                _fee
            ),
            _legs,
            _tokenList
        );
        if (_local) {
            uint _received = BalanceLib.balanceOf(_swap.outputToken, _account) - _outputBefore;
            if (_received < _swap.outputAmount) {
                revert Error.Balance__DepositNotReceived(_swap.outputToken, _received, _swap.outputAmount);
            }
        }
    }

    function fundSwap(
        address _account,
        SwapIntent calldata _intent,
        bytes32 _structHash,
        bytes calldata _coSig,
        GateConfig calldata _config
    ) external auth {
        SwapLib.SwapParams calldata _swap = _intent.swap;
        address _inputToken = _swap.inputToken;
        if (_intent.header.feeToken != _inputToken) revert Error.Intent__FeeTokenMismatch(_intent.header.feeToken, _inputToken);
        SwapLib.verify(_swap, _intent.header.fee, _config.maxRelayFeeBps);
        bool _local = _intent.destinationChainId == block.chainid;
        if (_local) {
            if (_swap.outputToken == _inputToken) revert Error.Balance__InvalidSwap();
            IntentLib.verifyRegistered(registerModule, _swap.outputToken);
        }
        uint _outputBefore = _local ? BalanceLib.balanceOf(_swap.outputToken, _account) : 0;
        accountModule.dispatch(
            IAccount(_account),
            _config.attestor,
            _structHash,
            _coSig,
            abi.encode(
                msg.sig,
                _intent.destinationChainId,
                _inputToken,
                _swap.inputAmount,
                _swap.outputToken,
                _swap.outputAmount,
                _intent.header.feeToken,
                _intent.header.fee
            ),
            SwapLib.calls(
                _inputToken,
                _swap.inputAmount,
                _config.feeReceiver,
                _intent.header.fee,
                _swap.provider,
                _swap.providerCallData,
                _config.transferGasLimit
            ),
            _local ? BalanceLib.list(_inputToken, _swap.outputToken) : BalanceLib.list(_inputToken)
        );
        if (_local) {
            uint _received = BalanceLib.balanceOf(_swap.outputToken, _account) - _outputBefore;
            if (_received < _swap.outputAmount) {
                revert Error.Balance__SwapOutputNotReceived(_swap.outputToken, _received, _swap.outputAmount);
            }
        }
    }

    function withdraw(
        address _account,
        SwapIntent calldata _intent,
        bytes32 _structHash,
        bytes calldata _coSig,
        GateConfig calldata _config
    ) external auth {
        SwapLib.SwapParams calldata _swap = _intent.swap;
        if (_intent.header.feeToken != _swap.inputToken) {
            revert Error.Intent__FeeTokenMismatch(_intent.header.feeToken, _swap.inputToken);
        }
        if (_swap.inputAmount == 0) revert Error.Balance__NothingToWithdraw();
        uint _held = BalanceLib.balanceOf(_swap.inputToken, _account);
        if (_held < _swap.inputAmount) revert Error.Balance__InsufficientBalance(_held, _swap.inputAmount);

        IAccount.Call[] memory _spend;
        if (_swap.provider == address(0)) {
            IntentLib.verifyRelayFeeRatio(_intent.header.fee, _swap.inputAmount, _config.maxRelayFeeBps);
            if (
                _intent.destinationChainId != block.chainid || _swap.inputToken != _swap.outputToken
                    || _swap.outputAmount != _swap.inputAmount - _intent.header.fee
            ) {
                revert Error.Balance__InvalidWithdraw();
            }
            _spend = new IAccount.Call[](2);
            _spend[0] = CallLib.pay(_swap.inputToken, _intent.header.user, _swap.outputAmount, _config.transferGasLimit);
            _spend[1] = CallLib.pay(_swap.inputToken, _config.feeReceiver, _intent.header.fee, _config.transferGasLimit);
        } else {
            SwapLib.verify(_swap, _intent.header.fee, _config.maxRelayFeeBps);
            _spend = SwapLib.calls(
                _swap.inputToken,
                _swap.inputAmount,
                _config.feeReceiver,
                _intent.header.fee,
                _swap.provider,
                _swap.providerCallData,
                _config.transferGasLimit
            );
        }
        bool _measurable = _swap.provider != address(0) && _intent.destinationChainId == block.chainid;
        uint _outputBefore = _measurable ? BalanceLib.balanceOf(_swap.outputToken, _intent.header.user) : 0;
        accountModule.dispatch(
            IAccount(_account),
            _config.attestor,
            _structHash,
            _coSig,
            abi.encode(
                msg.sig,
                _intent.destinationChainId,
                _swap.inputToken,
                _swap.inputAmount,
                _swap.outputToken,
                _swap.outputAmount,
                _intent.header.feeToken,
                _intent.header.fee
            ),
            _spend,
            BalanceLib.list(_swap.inputToken)
        );
        if (_measurable) {
            uint _received = BalanceLib.balanceOf(_swap.outputToken, _intent.header.user) - _outputBefore;
            if (_received < _swap.outputAmount) {
                revert Error.Balance__SwapOutputNotReceived(_swap.outputToken, _received, _swap.outputAmount);
            }
        }
    }
}
