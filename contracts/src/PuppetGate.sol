// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseGate} from "./utils/BaseGate.sol";
import {CallLib} from "./utils/CallLib.sol";
import {NATIVE_TOKEN} from "./utils/Native.sol";
import {SignLib} from "./utils/SignLib.sol";
import {Error} from "./utils/Error.sol";
import {IntentLib} from "./utils/IntentLib.sol";
import {AccountLib} from "./utils/AccountLib.sol";
import {SwapLib} from "./utils/SwapLib.sol";
import {IAuthority} from "./utils/interfaces/IAuthority.sol";

import {Account} from "./core/Account.sol";
import {Deposit} from "./core/Deposit.sol";
import {Register} from "./core/Register.sol";
import {PuppetAccount} from "./core/PuppetAccount.sol";
import {IAccount} from "./utils/interfaces/IAccount.sol";

bytes32 constant RECOGNIZE_INTENT_TYPEHASH = keccak256(
    "RecognizeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,address token,uint256 amount)AccountInitParams(address user,address signer)"
);

bytes32 constant SWAP_INTENT_TYPEHASH = keccak256(
    "SwapIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,SwapParams swap,uint256 destinationChainId)AccountInitParams(address user,address signer)SwapParams(address inputToken,address outputToken,address provider,bytes providerCallData,uint256 inputAmount,uint256 outputAmount)"
);

contract PuppetGate is BaseGate, EIP712 {
    struct RecognizeIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        address token;
        uint amount;
    }

    struct SwapIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        SwapLib.SwapParams swap;
        uint destinationChainId;
    }

    Deposit internal immutable walletDepositModule;

    constructor(
        IAuthority _authority,
        Account _accountModule,
        Deposit _walletDeposit,
        Register _register,
        Config memory _config
    ) BaseGate(_authority, _accountModule, _register, _config) EIP712("PuppetGate", "1") {
        if (address(_walletDeposit) == address(0)) revert Error.Gate__InvalidModule();
        walletDepositModule = _walletDeposit;
    }

    function deposit(
        AccountLib.AccountInitParams calldata _params,
        address _token,
        uint _amount
    ) external {
        address _account = accountModule.predictPuppetAccount(_params);
        IntentLib.verifyTokenAndCap(registerModule, _token, _amount);
        walletDepositModule.deposit(msg.sender, accountModule.predictRoute(_account), IERC20(_token), _amount, transferGasLimit);
    }

    function depositWnt(
        AccountLib.AccountInitParams calldata _params
    ) external payable {
        address _account = accountModule.predictPuppetAccount(_params);
        IntentLib.verifyTokenAndCap(registerModule, registerModule.wntToken(), msg.value);
        walletDepositModule.depositWnt{value: msg.value}(
            msg.sender, accountModule.predictRoute(_account), registerModule.getWnt(), transferGasLimit
        );
    }

    function recognize(
        RecognizeIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        _recognize(
            _intent, accountModule.verifyPuppetAccount(_intent.params), _userSignature, _attestorSignature, _actualRelayFee
        );
    }

    function recognize(
        RecognizeIntent calldata _intent,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        address _predicted = accountModule.predictPuppetAccount(_intent.params);
        PuppetAccount _account = PuppetAccount(payable(_predicted));
        if (_predicted.code.length == 0) {
            (_account,) = accountModule.createPuppetAccount(_intent.params, _userDeploySig, _signerProof);
        }
        _recognize(_intent, _account, _userSignature, _attestorSignature, _actualRelayFee);
    }

    function _recognize(
        RecognizeIntent calldata _intent,
        PuppetAccount _account,
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

        address _route = accountModule.predictRoute(address(_account));
        IntentLib.verifyRelayFeeRatio(
            _actualRelayFee, _account.signedBalanceOf(_token) + _intent.amount, maxRelayFeeBps
        );

        uint _routeBalance = _token == NATIVE_TOKEN ? _route.balance : IERC20(_token).balanceOf(_route);
        if (_routeBalance < _intent.amount) revert Error.Balance__InsufficientBalance(_routeBalance, _intent.amount);

        IAccount.Call memory _deposit = CallLib.routeExecute(
            _route, CallLib.compose(CallLib.payout(_token, address(_account), _intent.amount, transferGasLimit))
        );
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


    function swap(
        SwapIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        _swap(_intent, accountModule.verifyPuppetAccount(_intent.params), _userSignature, _attestorSignature, _actualRelayFee);
    }

    function swap(
        SwapIntent calldata _intent,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        address _predicted = accountModule.predictPuppetAccount(_intent.params);
        PuppetAccount _account = PuppetAccount(payable(_predicted));
        if (_predicted.code.length == 0) {
            (_account,) = accountModule.createPuppetAccount(_intent.params, _userDeploySig, _signerProof);
        }
        _swap(_intent, _account, _userSignature, _attestorSignature, _actualRelayFee);
    }

    function _swap(
        SwapIntent calldata _intent,
        PuppetAccount _account,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) internal {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);

        bool _local = _intent.destinationChainId == block.chainid;

        SwapLib.SwapParams calldata _swap = _intent.swap;
        address _inputToken = SwapLib.verify(registerModule, maxRelayFeeBps, _swap, _actualRelayFee);
        address _route = accountModule.predictRoute(address(_account));
        uint _routeBalance = IERC20(_inputToken).balanceOf(_route);
        if (_routeBalance < _swap.inputAmount) revert Error.Balance__InsufficientBalance(_routeBalance, _swap.inputAmount);

        IAccount.Call memory _approve =
            CallLib.approve(_inputToken, _swap.provider, _swap.inputAmount - _actualRelayFee, transferGasLimit);
        IAccount.Call memory _dex =
            IAccount.Call({target: _swap.provider, value: 0, gasLimit: 0, callData: _swap.providerCallData});
        IAccount.Call memory _reset = CallLib.approve(_inputToken, _swap.provider, 0, transferGasLimit);

        IAccount.Call[] memory _legs;
        IAccount.SignTransfer[] memory _transferList;
        if (_local) {
            IntentLib.verifyTokenAndCap(registerModule, _swap.outputToken, _swap.outputAmount);
            address _outputToken = _swap.outputToken;
            IAccount.Call memory _forward =
                CallLib.payout(_outputToken, address(_account), _swap.outputAmount, transferGasLimit);
            _legs = _actualRelayFee > 0
                ? CallLib.compose(
                    _approve, _dex, _reset, CallLib.fee(_inputToken, feeReceiver, _actualRelayFee, transferGasLimit), _forward
                )
                : CallLib.compose(_approve, _dex, _reset, _forward);
            _transferList = SignLib.transfer(_outputToken, _swap.outputAmount, 0);
        } else {
            _legs = _actualRelayFee > 0
                ? CallLib.compose(
                    _approve, _dex, _reset, CallLib.fee(_inputToken, feeReceiver, _actualRelayFee, transferGasLimit)
                )
                : CallLib.compose(_approve, _dex, _reset);
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

        _logEvent("Swap", abi.encode(_intent, _actualRelayFee, address(_account)));
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
                    _intent.token,
                    _intent.amount
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
                    SwapLib.hashSwap(_intent.swap),
                    _intent.destinationChainId
                )
            )
        );
    }

}
