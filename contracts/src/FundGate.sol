// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseGate} from "./utils/BaseGate.sol";
import {CallLib} from "./utils/CallLib.sol";
import {NATIVE_TOKEN} from "./utils/Native.sol";
import {SignLib} from "./utils/SignLib.sol";
import {IntentLib} from "./utils/IntentLib.sol";
import {AccountLib} from "./utils/AccountLib.sol";
import {FundAccountLib} from "./utils/FundAccountLib.sol";
import {SwapLib} from "./utils/SwapLib.sol";
import {Error} from "./utils/Error.sol";
import {IAuthority} from "./utils/interfaces/IAuthority.sol";

import {Account} from "./core/Account.sol";
import {Register} from "./core/Register.sol";
import {FundAccount} from "./core/FundAccount.sol";
import {IAccount} from "./utils/interfaces/IAccount.sol";

bytes32 constant OPERATE_INTENT_TYPEHASH = keccak256(
    "OperateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,FundAccountInitParams fundParams,bytes32 callListHash,bytes32 transferListHash)AccountInitParams(address user,address signer)FundAccountInitParams(address master,address baseToken,bytes32 name)"
);

bytes32 constant RECOGNIZE_INTENT_TYPEHASH = keccak256(
    "RecognizeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,FundAccountInitParams fundParams,address token,uint256 amount)AccountInitParams(address user,address signer)FundAccountInitParams(address master,address baseToken,bytes32 name)"
);

bytes32 constant SWAP_INTENT_TYPEHASH = keccak256(
    "SwapIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,FundAccountInitParams fundParams,SwapParams swap,uint256 destinationChainId,bool fromRoute)AccountInitParams(address user,address signer)FundAccountInitParams(address master,address baseToken,bytes32 name)SwapParams(address inputToken,address outputToken,address provider,bytes providerCallData,uint256 inputAmount,uint256 outputAmount)"
);

bytes32 constant WRAP_INTENT_TYPEHASH = keccak256(
    "WrapIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,FundAccountInitParams fundParams,uint256 amount,bool unwrap)AccountInitParams(address user,address signer)FundAccountInitParams(address master,address baseToken,bytes32 name)"
);

contract FundGate is BaseGate, EIP712 {
    struct OperateIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        FundAccountLib.FundAccountInitParams fundParams;
        IAccount.Call[] callList;
        IAccount.SignTransfer[] transferList;
    }

    struct SwapIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        FundAccountLib.FundAccountInitParams fundParams;
        SwapLib.SwapParams swap;
        uint destinationChainId;
        bool fromRoute;
    }

    struct RecognizeIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        FundAccountLib.FundAccountInitParams fundParams;
        address token;
        uint amount;
    }

    // Atomic native <-> wrapped-native conversion of a fund's signed balance (native accrues from GMX execution-fee
    // refunds). A fixed WNT.deposit/withdraw call + a 1:1 signed-domain re-key — no DEX, no provider calldata to
    // screen, deterministic. `unwrap` false: native -> WNT; true: WNT -> native.
    struct WrapIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        FundAccountLib.FundAccountInitParams fundParams;
        uint amount;
        bool unwrap;
    }

    constructor(
        IAuthority _authority,
        Account _accountModule,
        Register _register,
        Config memory _config
    ) BaseGate(_authority, _accountModule, _register, _config) EIP712("FundGate", "1") {}

    function operate(
        OperateIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external payable returns (bytes[] memory result_) {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);

        address _master = address(accountModule.verifyPuppetAccount(_intent.params));
        if (_master != _intent.fundParams.master) revert Error.Share__MasterMismatch(_master, _intent.fundParams.master);
        address _fundAddr = accountModule.predictFundAccount(_intent.fundParams);
        if (_fundAddr.code.length == 0) accountModule.createFundAccount(_intent.params.user, _intent.fundParams);
        FundAccount _account = FundAccount(payable(_fundAddr));

        (,, result_) = accountModule.dispatch{value: msg.value}(
            IAccount(address(_account)),
            _intent.callList,
            _intent.transferList,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        OPERATE_INTENT_TYPEHASH,
                        AccountLib.hashAccount(_intent.params),
                        _intent.blockNumber,
                        _intent.deadline,
                        _intent.acceptableRelayFee,
                        _intent.nonce,
                        _intent.chainId,
                        FundAccountLib.hashFundAccount(_intent.fundParams),
                        keccak256(abi.encode(_intent.callList)),
                        keccak256(abi.encode(_intent.transferList))
                    )
                )
            ),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );

        _logEvent("Operate", abi.encode(_intent, _actualRelayFee, address(_account), result_));
    }

    function swap(
        SwapIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);

        address _master = address(accountModule.verifyPuppetAccount(_intent.params));
        if (_master != _intent.fundParams.master) revert Error.Share__MasterMismatch(_master, _intent.fundParams.master);

        address _fundAddr = accountModule.predictFundAccount(_intent.fundParams);
        FundAccount _account = FundAccount(payable(_fundAddr));
        if (_fundAddr.code.length == 0) {
            (_account,) = accountModule.createFundAccount(_intent.params.user, _intent.fundParams);
        }

        bool _local = _intent.destinationChainId == block.chainid;

        SwapLib.SwapParams calldata _swap = _intent.swap;
        address _inputToken = SwapLib.verify(registerModule, maxRelayFeeBps, _swap, _actualRelayFee);

        if (_intent.fromRoute) {
            address _route = accountModule.predictRoute(_fundAddr);
            // A route can hold NATIVE (anyone can send the gas coin to the deposit address): wrap it INSIDE the route's
            // own leg batch (WNT.deposit{value} first), then run the sandwich on the wrapped twin — the mirror of the
            // signed-balance branch below.
            bool _nativeIn = _inputToken == NATIVE_TOKEN;
            address _swapIn = _nativeIn ? address(registerModule.getWnt()) : _inputToken;
            uint _routeBalance = _nativeIn ? _route.balance : IERC20(_inputToken).balanceOf(_route);
            if (_routeBalance < _swap.inputAmount) {
                revert Error.Balance__InsufficientBalance(_routeBalance, _swap.inputAmount);
            }

            IAccount.Call memory _wrap = IAccount.Call({
                target: _swapIn,
                value: _swap.inputAmount,
                gasLimit: transferGasLimit,
                callData: abi.encodeWithSignature("deposit()")
            });
            IAccount.Call memory _approve =
                CallLib.approve(_swapIn, _swap.provider, _swap.inputAmount - _actualRelayFee, transferGasLimit);
            IAccount.Call memory _dex =
                IAccount.Call({target: _swap.provider, value: 0, gasLimit: 0, callData: _swap.providerCallData});
            IAccount.Call memory _reset = CallLib.approve(_swapIn, _swap.provider, 0, transferGasLimit);

            IAccount.Call[] memory _legs;
            IAccount.SignTransfer[] memory _transferList;
            if (_local) {
                IntentLib.verifyTokenAndCap(registerModule, _swap.outputToken, _swap.outputAmount);
                address _outputToken = _swap.outputToken;
                IAccount.Call memory _forward = CallLib.payout(_outputToken, _fundAddr, _swap.outputAmount, transferGasLimit);
                if (_actualRelayFee > 0) {
                    IAccount.Call memory _fee = CallLib.fee(_swapIn, feeReceiver, _actualRelayFee, transferGasLimit);
                    _legs = _nativeIn
                        ? CallLib.compose(_wrap, _approve, _dex, _reset, _fee, _forward)
                        : CallLib.compose(_approve, _dex, _reset, _fee, _forward);
                } else {
                    _legs = _nativeIn
                        ? CallLib.compose(_wrap, _approve, _dex, _reset, _forward)
                        : CallLib.compose(_approve, _dex, _reset, _forward);
                }
                _transferList = SignLib.transfer(_outputToken, _swap.outputAmount, 0);
            } else {
                if (_actualRelayFee > 0) {
                    IAccount.Call memory _fee = CallLib.fee(_swapIn, feeReceiver, _actualRelayFee, transferGasLimit);
                    _legs = _nativeIn
                        ? CallLib.compose(_wrap, _approve, _dex, _reset, _fee)
                        : CallLib.compose(_approve, _dex, _reset, _fee);
                } else {
                    _legs = _nativeIn ? CallLib.compose(_wrap, _approve, _dex, _reset) : CallLib.compose(_approve, _dex, _reset);
                }
                _transferList = SignLib.none();
            }

            accountModule.dispatch(
                IAccount(address(_account)),
                CallLib.compose(CallLib.routeExecute(_route, _legs)),
                _transferList,
                _hashSwap(_intent),
                _userSignature,
                _attestorSignature,
                attestor,
                _intent.nonce
            );
        } else {
            // Native input wraps INSIDE the same dispatch: WNT.deposit{value: inputAmount} precedes the sandwich, the
            // approvals/fee run on the wrapped twin, and the signed leg still debits the NATIVE balance (1:1 with the
            // wrap), so a native swap is ONE action instead of a wrap step followed by a swap step.
            bool _nativeIn = _inputToken == NATIVE_TOKEN;
            address _swapIn = _nativeIn ? address(registerModule.getWnt()) : _inputToken;
            IAccount.Call memory _approve =
                CallLib.approve(_swapIn, _swap.provider, _swap.inputAmount - _actualRelayFee, transferGasLimit);
            IAccount.Call memory _dex =
                IAccount.Call({target: _swap.provider, value: 0, gasLimit: 0, callData: _swap.providerCallData});
            IAccount.Call memory _reset = CallLib.approve(_swapIn, _swap.provider, 0, transferGasLimit);
            IAccount.Call memory _last = _actualRelayFee > 0
                ? CallLib.fee(_swapIn, feeReceiver, _actualRelayFee, transferGasLimit)
                : _reset;
            IAccount.Call[] memory _legs;
            if (_nativeIn) {
                IAccount.Call memory _wrap = IAccount.Call({
                    target: _swapIn,
                    value: _swap.inputAmount,
                    gasLimit: transferGasLimit,
                    callData: abi.encodeWithSignature("deposit()")
                });
                _legs = _actualRelayFee > 0
                    ? CallLib.compose(_wrap, _approve, _dex, _reset, _last)
                    : CallLib.compose(_wrap, _approve, _dex, _reset);
            } else {
                _legs = _actualRelayFee > 0
                    ? CallLib.compose(_approve, _dex, _reset, _last)
                    : CallLib.compose(_approve, _dex, _reset);
            }

            IAccount.SignTransfer[] memory _transferList;
            if (_local) {
                IntentLib.verifyTokenAndCap(registerModule, _swap.outputToken, _swap.outputAmount);
                address _outputToken = _swap.outputToken;
                _transferList = SignLib.transfer(
                    _inputToken, 0, _swap.inputAmount, _outputToken, _swap.outputAmount, 0
                );
            } else {
                _transferList = SignLib.transfer(_inputToken, 0, _swap.inputAmount);
            }

            accountModule.dispatch(
                IAccount(address(_account)),
                _legs,
                _transferList,
                _hashSwap(_intent),
                _userSignature,
                _attestorSignature,
                attestor,
                _intent.nonce
            );
        }

        _logEvent("Swap", abi.encode(_intent, _actualRelayFee, address(_account)));
    }

    function recognize(
        RecognizeIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        _recognize(_intent, _userSignature, _attestorSignature, _actualRelayFee);
    }

    function recognize(
        RecognizeIntent calldata _intent,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        address _master = accountModule.predictPuppetAccount(_intent.params);
        if (_master.code.length == 0) {
            accountModule.createPuppetAccount(_intent.params, _userDeploySig, _signerProof);
        }
        _recognize(_intent, _userSignature, _attestorSignature, _actualRelayFee);
    }

    function _recognize(
        RecognizeIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) internal {
        if (_intent.amount == 0) revert Error.Balance__NothingToRecord();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        address _token = _intent.token;
        IntentLib.verifyTokenAndCap(registerModule, _token, _intent.amount);

        address _master = address(accountModule.verifyPuppetAccount(_intent.params));
        if (_master != _intent.fundParams.master) revert Error.Share__MasterMismatch(_master, _intent.fundParams.master);

        address _fundAddr = accountModule.predictFundAccount(_intent.fundParams);
        FundAccount _account = FundAccount(payable(_fundAddr));
        if (_fundAddr.code.length == 0) {
            (_account,) = accountModule.createFundAccount(_intent.params.user, _intent.fundParams);
        }

        address _route = accountModule.predictRoute(_fundAddr);
        IntentLib.verifyRelayFeeRatio(
            _actualRelayFee, _account.signedBalanceOf(_token) + _intent.amount, maxRelayFeeBps
        );
        uint _routeBalance = _token == NATIVE_TOKEN ? _route.balance : IERC20(_token).balanceOf(_route);
        if (_routeBalance < _intent.amount) revert Error.Balance__InsufficientBalance(_routeBalance, _intent.amount);

        IAccount.Call memory _deposit =
            CallLib.routeExecute(_route, CallLib.compose(CallLib.payout(_token, _fundAddr, _intent.amount, transferGasLimit)));
        IAccount.Call[] memory _callList = _actualRelayFee > 0
            ? CallLib.compose(_deposit, CallLib.fee(_token, feeReceiver, _actualRelayFee, transferGasLimit))
            : CallLib.compose(_deposit);

        accountModule.dispatch(
            IAccount(address(_account)),
            _callList,
            SignLib.transfer(_token, _intent.amount, _actualRelayFee),
            _hashRecognize(_intent),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );

        _logEvent("Recognize", abi.encode(_intent, _actualRelayFee, address(_account)));
    }

    function _hashRecognize(
        RecognizeIntent calldata _intent
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECOGNIZE_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    FundAccountLib.hashFundAccount(_intent.fundParams),
                    _intent.token,
                    _intent.amount
                )
            )
        );
    }

    function wrap(
        WrapIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.amount == 0) revert Error.Balance__NothingToRecord();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);

        address _master = address(accountModule.verifyPuppetAccount(_intent.params));
        if (_master != _intent.fundParams.master) revert Error.Share__MasterMismatch(_master, _intent.fundParams.master);
        address _fundAddr = accountModule.predictFundAccount(_intent.fundParams);
        if (_fundAddr.code.length == 0) revert Error.Account__NotDeployed(_fundAddr);
        FundAccount _account = FundAccount(payable(_fundAddr));

        address _wnt = address(registerModule.getWnt());
        // The wrapped-native token must be a registered, capped token (a valid signed asset); the native marker needs
        // no registration (its signed balance is the account's own native holding).
        IntentLib.verifyTokenAndCap(registerModule, _wnt, _intent.amount);

        IAccount.Call[] memory _callList = new IAccount.Call[](1);
        IAccount.SignTransfer[] memory _transferList = new IAccount.SignTransfer[](2);
        if (_intent.unwrap) {
            // WNT -> native: withdraw burns WNT and returns native to the fund; credit signed native, debit signed WNT.
            _callList[0] = IAccount.Call({
                target: _wnt,
                value: 0,
                gasLimit: 0,
                callData: abi.encodeWithSignature("withdraw(uint256)", _intent.amount)
            });
            _transferList[0] = IAccount.SignTransfer({token: NATIVE_TOKEN, amountIn: _intent.amount, amountOut: 0});
            _transferList[1] = IAccount.SignTransfer({token: _wnt, amountIn: 0, amountOut: _intent.amount});
        } else {
            // native -> WNT: deposit mints WNT 1:1 to the fund; credit signed WNT, debit signed native.
            _callList[0] = IAccount.Call({
                target: _wnt,
                value: _intent.amount,
                gasLimit: 0,
                callData: abi.encodeWithSignature("deposit()")
            });
            _transferList[0] = IAccount.SignTransfer({token: _wnt, amountIn: _intent.amount, amountOut: 0});
            _transferList[1] = IAccount.SignTransfer({token: NATIVE_TOKEN, amountIn: 0, amountOut: _intent.amount});
        }

        // The on-chain shortfall check (address(this).balance for NATIVE, balanceOf(WNT) for the wrapped) makes the
        // 1:1 re-key EXACT: the fund must actually hold the produced side, so nothing can be skimmed.
        accountModule.dispatch(
            IAccount(address(_account)),
            _callList,
            _transferList,
            _hashWrap(_intent),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );

        _logEvent("Wrap", abi.encode(_intent, _actualRelayFee, address(_account)));
    }

    function _hashWrap(
        WrapIntent calldata _intent
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    WRAP_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    FundAccountLib.hashFundAccount(_intent.fundParams),
                    _intent.amount,
                    _intent.unwrap
                )
            )
        );
    }

    function _hashSwap(
        SwapIntent calldata _intent
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SWAP_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    FundAccountLib.hashFundAccount(_intent.fundParams),
                    SwapLib.hashSwap(_intent.swap),
                    _intent.destinationChainId,
                    _intent.fromRoute
                )
            )
        );
    }
}
