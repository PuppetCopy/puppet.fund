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

import {AccountModule, CREATE_MASTER_ACCOUNT_INTENT_TYPEHASH} from "./core/module/AccountModule.sol";
import {BridgeModule} from "./core/module/BridgeModule.sol";
import {WalletDepositModule} from "./core/module/WalletDepositModule.sol";
import {MasterAccount} from "./core/MasterAccount.sol";
import {TransientRoute} from "./core/TransientRoute.sol";
import {IAccount} from "./core/interface/IAccount.sol";
import {RegisterModule} from "./core/module/RegisterModule.sol";

bytes32 constant RECOGNIZE_INTENT_TYPEHASH = keccak256(
    "RecognizeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bool fromTransientRoute,uint256 amount)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant OPERATE_INTENT_TYPEHASH = keccak256(
    "OperateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,address baseToken,bytes32 callListHash,uint256 amountIn,uint256 amountOut)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant BRIDGE_INTENT_TYPEHASH = keccak256(
    "BridgeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bool fromTransientRoute,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address provider,bytes providerCallData,uint32 expires,uint32 fillDeadline)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

contract MasterGate is BaseAccountGate, EIP712 {
    struct RecognizeIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        bool fromTransientRoute;
        uint amount;
    }

    struct OperateIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        IERC20 baseToken;
        IAccount.Call[] callList;
        uint amountIn;
        uint amountOut;
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
    ) BaseAccountGate(_authority, _accountGate, _bridge, _walletDeposit, _register, _hubChainId, _config) EIP712("MasterGate", "1") {}

    function createMasterAccount(
        AccountModule.CreateMasterAccountIntent calldata _intent,
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

        (MasterAccount _masterAccount, address _transientRoute,) =
            accountModule.createMasterAccount(_intent.params, _userDeploySig, _signerProof);

        IAccount.Call[] memory _trCalls = new IAccount.Call[](1);
        _trCalls[0] =
            _erc20TransferCall(_feeToken, address(_masterAccount), _intent.initialDepositAmount, transferGasLimit);
        IAccount.Call[] memory _calls = new IAccount.Call[](1);
        _calls[0] = IAccount.Call({
            target: _transientRoute, value: 0, gasLimit: 0, callData: abi.encodeCall(TransientRoute.execute, (_trCalls))
        });

        accountModule.dispatch(
            _masterAccount,
            _calls,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        CREATE_MASTER_ACCOUNT_INTENT_TYPEHASH,
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
        address _account = accountModule.predictMasterAccount(_params);
        IERC20 _token = IntentLib.verifyTokenAndCap(registerModule, _params.baseTokenId, address(0), _amount);
        walletDepositModule.deposit(
            msg.sender, accountModule.predictDepositRoute(_account), _token, _amount, transferGasLimit
        );
    }

    function depositWnt(
        AccountLib.AccountInitParams calldata _params
    ) external payable {
        address _account = accountModule.predictMasterAccount(_params);
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

        MasterAccount _account = accountModule.verifyMasterAccount(_intent.params);
        address _route =
            _intent.fromTransientRoute ? accountModule.predictTransientRoute(address(_account)) : address(0);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _account.signedBalance() + _intent.amount, maxRelayFeeBps);

        IAccount.Call[] memory _calls;
        if (_route != address(0)) {
            uint _routeBalance = _token.balanceOf(_route);
            if (_routeBalance < _intent.amount) {
                revert Error.Deposit__InsufficientBalance(_routeBalance, _intent.amount);
            }
            IAccount.Call[] memory _trCalls = new IAccount.Call[](1);
            _trCalls[0] = _erc20TransferCall(_token, address(_account), _intent.amount, transferGasLimit);
            _calls = new IAccount.Call[](1);
            _calls[0] = IAccount.Call({
                target: _route, value: 0, gasLimit: 0, callData: abi.encodeCall(TransientRoute.execute, (_trCalls))
            });
        } else {
            _calls = new IAccount.Call[](0);
        }

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
                        _intent.fromTransientRoute,
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

    function operate(
        OperateIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external payable returns (bytes[] memory returnCallData_) {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyTokenAndCap(
            registerModule, _intent.params.baseTokenId, address(_intent.baseToken), _intent.amountIn
        );
        address _masterAccount = address(accountModule.verifyMasterAccount(_intent.params));

        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    OPERATE_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    keccak256(abi.encode(_intent.callList)),
                    _intent.amountIn,
                    _intent.amountOut
                )
            )
        );

        IntentLib.verifyRelayFeeRatio(
            _actualRelayFee, IAccount(_masterAccount).signedBalance() + _intent.amountIn, maxRelayFeeBps
        );
        (,, returnCallData_) = accountModule.dispatch{value: msg.value}(
            IAccount(_masterAccount),
            _intent.callList,
            _digest,
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce,
            _intent.baseToken,
            _intent.amountIn,
            _intent.amountOut,
            _actualRelayFee,
            feeReceiver,
            transferGasLimit
        );

        _logEvent("Operate", abi.encode(_intent, _masterAccount, msg.sender, returnCallData_));
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

        if (_intent.destinationChainId == block.chainid) {
            revert Error.Deposit__SameChainBridge(_intent.destinationChainId);
        }
        MasterAccount _account = accountModule.verifyMasterAccount(_intent.params);
        address _transientRoute = accountModule.predictTransientRoute(address(_account));

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
        uint _settlerInputAmount = _intent.inputAmount - _actualRelayFee;

        IAccount.Call[] memory _bridgeCalls =
            new IAccount.Call[](_intent.fromTransientRoute && _actualRelayFee > 0 ? 4 : 3);
        _bridgeCalls[0] = _approveCall(_intent.inputToken, _intent.provider, _settlerInputAmount);
        _bridgeCalls[1] =
            IAccount.Call({target: _intent.provider, value: 0, gasLimit: 0, callData: _intent.providerCallData});
        _bridgeCalls[2] = _approveCall(_intent.inputToken, _intent.provider, 0);

        IAccount.Call[] memory _calls;
        uint _amountOut;
        uint _dispatchRelayFee;
        address _dispatchFeeReceiver;
        if (_intent.fromTransientRoute) {
            if (_actualRelayFee > 0) {
                _bridgeCalls[3] = _erc20TransferCall(_intent.inputToken, feeReceiver, _actualRelayFee, transferGasLimit);
            }
            _calls = new IAccount.Call[](1);
            _calls[0] = IAccount.Call({
                target: _transientRoute,
                value: 0,
                gasLimit: 0,
                callData: abi.encodeCall(TransientRoute.execute, (_bridgeCalls))
            });
        } else {
            _calls = _bridgeCalls;
            _amountOut = _settlerInputAmount;
            _dispatchRelayFee = _actualRelayFee;
            _dispatchFeeReceiver = feeReceiver;
        }

        accountModule.dispatch(
            IAccount(address(_account)),
            _calls,
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
            _intent.nonce,
            _intent.fromTransientRoute ? IERC20(address(0)) : _intent.inputToken,
            0,
            _amountOut,
            _dispatchRelayFee,
            _dispatchFeeReceiver,
            transferGasLimit
        );

        _logEvent("Bridge", abi.encode(_intent, address(_account)));
    }
}
