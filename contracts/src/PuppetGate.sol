// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseAccountGate} from "./utils/BaseAccountGate.sol";
import {CallLib} from "./utils/CallLib.sol";
import {Error} from "./utils/Error.sol";
import {IntentLib} from "./utils/IntentLib.sol";
import {AccountLib} from "./core/AccountLib.sol";
import {IAuthority} from "./utils/interfaces/IAuthority.sol";
import {IWNT} from "./utils/interfaces/IWNT.sol";

import {AccountModule, CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH} from "./core/module/AccountModule.sol";
import {BridgeModule} from "./core/module/BridgeModule.sol";
import {WalletDepositModule} from "./core/module/WalletDepositModule.sol";
import {PuppetAccount} from "./core/PuppetAccount.sol";
import {TransientRoute} from "./core/TransientRoute.sol";
import {IAccount} from "./core/interface/IAccount.sol";
import {RegisterModule} from "./core/module/RegisterModule.sol";

bytes32 constant WITHDRAW_INTENT_TYPEHASH = keccak256(
    "WithdrawIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,uint256 amount)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant RECOGNIZE_INTENT_TYPEHASH = keccak256(
    "RecognizeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,uint256 amount)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant BRIDGE_INTENT_TYPEHASH = keccak256(
    "BridgeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bool fromTransientRoute,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address provider,bytes providerCallData,uint32 expires,uint32 fillDeadline)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

contract PuppetGate is BaseAccountGate, EIP712 {
    struct WithdrawIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        uint amount;
    }

    struct RecognizeIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        uint amount;
    }

    struct BridgeIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        bool fromTransientRoute;
        IERC20 inputToken;
        IERC20 outputToken;
        uint inputAmount;
        uint outputAmount;
        uint destinationChainId;
        address provider;
        bytes providerCallData;
        uint32 expires;
        uint32 fillDeadline;
    }

    constructor(
        IAuthority _authority,
        AccountModule _accountGate,
        BridgeModule _bridge,
        WalletDepositModule _walletDeposit,
        RegisterModule _register,
        uint _hubChainId,
        Config memory _config
    ) BaseAccountGate(_authority, _accountGate, _bridge, _walletDeposit, _register, _hubChainId, _config) EIP712("PuppetGate", "1") {}

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
            CallLib.transferCall(_feeToken, address(_puppetAccount), _intent.initialDepositAmount, transferGasLimit);
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

    function deposit(
        AccountLib.AccountInitParams calldata _params,
        uint _amount
    ) external {
        address _account = accountModule.predictPuppetAccount(_params);
        IERC20 _token = IntentLib.verifyTokenAndCap(registerModule, _params.baseTokenId, address(0), _amount);
        walletDepositModule.deposit(
            msg.sender, accountModule.predictDepositRoute(_account), _token, _amount, transferGasLimit
        );
    }

    function depositWnt(
        AccountLib.AccountInitParams calldata _params
    ) external payable {
        address _account = accountModule.predictPuppetAccount(_params);
        walletDepositModule.depositWnt{value: msg.value}(
            msg.sender, accountModule.predictDepositRoute(_account), registerModule.getWnt(), transferGasLimit
        );
    }

    function recognize(
        RecognizeIntent calldata _intent,
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

        PuppetAccount _account = accountModule.verifyPuppetAccount(_intent.params);
        address _route = accountModule.predictDepositRoute(address(_account));
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _account.signedBalance() + _intent.amount, maxRelayFeeBps);

        uint _routeBalance = _token.balanceOf(_route);
        if (_routeBalance < _intent.amount) revert Error.Deposit__InsufficientBalance(_routeBalance, _intent.amount);
        IAccount.Call[] memory _trCalls = new IAccount.Call[](1);
        _trCalls[0] = CallLib.transferCall(_token, address(_account), _intent.amount, transferGasLimit);
        IAccount.Call[] memory _calls = new IAccount.Call[](1);
        _calls[0] = IAccount.Call({
            target: _route, value: 0, gasLimit: 0, callData: abi.encodeCall(TransientRoute.execute, (_trCalls))
        });

        accountModule.dispatch(
            IAccount(address(_account)),
            _calls,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        RECOGNIZE_INTENT_TYPEHASH,
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

        _logEvent("Recognize", abi.encode(_intent, address(_account)));
    }

    function bridge(
        BridgeIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.inputAmount == 0) revert Error.Deposit__NothingToBridge();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyTokenAndCap(
            registerModule,
            _intent.params.baseTokenId,
            _intent.fromTransientRoute ? address(0) : address(_intent.inputToken),
            _intent.inputAmount
        );

        if (_intent.destinationChainId != hubChainId) {
            revert Error.Deposit__InvalidDestinationChain(hubChainId, _intent.destinationChainId);
        }
        address _hubToken = registerModule.getTokenInfo(_intent.params.baseTokenId).hubToken;
        if (address(_intent.outputToken) != _hubToken) {
            revert Error.Deposit__BaseTokenMismatch(_intent.params.baseTokenId, _hubToken, address(_intent.outputToken));
        }
        PuppetAccount _account = accountModule.verifyPuppetAccount(_intent.params);
        address _transientRoute = accountModule.predictDepositRoute(address(_account));

        if (_intent.fromTransientRoute) {
            uint _trBalance = _intent.inputToken.balanceOf(_transientRoute);
            if (_trBalance < _intent.inputAmount) {
                revert Error.Deposit__InsufficientBalance(_trBalance, _intent.inputAmount);
            }
        } else {
            uint _signed = _account.signedBalance();
            if (_signed < _intent.inputAmount) revert Error.Deposit__InsufficientBalance(_signed, _intent.inputAmount);
        }
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.inputAmount, maxRelayFeeBps);
        if (_actualRelayFee >= _intent.inputAmount) {
            revert Error.Deposit__InsufficientBalance(_intent.inputAmount, _actualRelayFee);
        }
        if (_intent.outputAmount == 0) revert Error.Deposit__ZeroBridgeOutput();

        BridgeModule.BridgeCall memory _bridgeCall = BridgeModule.BridgeCall({
            account: IAccount(address(_account)),
            transientRoute: _transientRoute,
            inputToken: _intent.inputToken,
            provider: _intent.provider,
            providerCallData: _intent.providerCallData,
            inputAmount: _intent.inputAmount,
            actualRelayFee: _actualRelayFee,
            fromTransientRoute: _intent.fromTransientRoute,
            nonce: _intent.nonce
        });
        bridgeModule.bridge(
            _bridgeCall,
            accountModule,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        BRIDGE_INTENT_TYPEHASH,
                        AccountLib.hashAccount(_intent.params),
                        _intent.blockNumber,
                        _intent.deadline,
                        _intent.acceptableRelayFee,
                        _intent.nonce,
                        _intent.chainId,
                        _intent.fromTransientRoute,
                        _intent.inputToken,
                        _intent.outputToken,
                        _intent.inputAmount,
                        _intent.outputAmount,
                        _intent.destinationChainId,
                        _intent.provider,
                        keccak256(_intent.providerCallData),
                        _intent.expires,
                        _intent.fillDeadline
                    )
                )
            ),
            _userSignature,
            _attestorSignature,
            attestor,
            feeReceiver,
            transferGasLimit
        );

        _logEvent("Bridge", abi.encode(_intent, address(_account)));
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
        _calls[0] = CallLib.transferCall(_token, _intent.params.user, _receiverAmount, transferGasLimit);

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
        IWNT _wnt = registerModule.getWnt();
        IntentLib.verifyTokenAndCap(registerModule, _intent.params.baseTokenId, address(_wnt), _intent.amount);
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
}
