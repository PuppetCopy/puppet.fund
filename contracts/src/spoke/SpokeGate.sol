// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Permission} from "../utils/auth/Permission.sol";
import {Error} from "../utils/Error.sol";
import {IntentLib} from "../utils/IntentLib.sol";
import {AccountLib} from "../core/AccountLib.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";

import {AccountModule, CREATE_MASTER_ACCOUNT_INTENT_TYPEHASH} from "../core/module/AccountModule.sol";
import {PuppetAccount} from "../core/PuppetAccount.sol";
import {MasterAccount} from "../core/MasterAccount.sol";
import {TransientRoute} from "../core/TransientRoute.sol";
import {IAccount} from "../core/interface/IAccount.sol";
import {RegisterModule} from "../core/module/RegisterModule.sol";
import {IAcrossSpokePool} from "../utils/interfaces/IAcrossSpokePool.sol";
import {IArbSys} from "../utils/interfaces/IArbSys.sol";

bytes32 constant BRIDGE_HUB_INTENT_TYPEHASH = keccak256(
    "BridgeHubIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bool fromTransientRoute,address inputToken,address outputToken,uint256 inputAmount,uint256 bridgeFee,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant OPERATE_INTENT_TYPEHASH = keccak256(
    "OperateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,address baseToken,bytes32 callListHash,uint256 amountIn,uint256 amountOut)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant BRIDGE_INTENT_TYPEHASH = keccak256(
    "BridgeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bool fromTransientRoute,address inputToken,address outputToken,uint256 inputAmount,uint256 bridgeFee,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant MASTER_SIGN_RECORDED_BALANCE_INTENT_TYPEHASH = keccak256(
    "MasterSignRecordedBalanceIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bool fromTransientRoute,uint256 amount)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

contract SpokeGate is Permission, EIP712 {
    struct Config {
        address attestor;
        address feeReceiver;
        uint transferGasLimit;
        uint maxBlockDelay;
        address acrossSpokePool;
        uint maxRelayFeeBps;
    }

    struct BridgeHubIntent {
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
        uint bridgeFee;
        uint destinationChainId;
        address exclusiveRelayer;
        uint32 quoteTimestamp;
        uint32 fillDeadline;
        uint32 exclusivityDeadline;
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
        uint bridgeFee;
        uint destinationChainId;
        address exclusiveRelayer;
        uint32 quoteTimestamp;
        uint32 fillDeadline;
        uint32 exclusivityDeadline;
    }

    struct MasterSignRecordedBalanceIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        bool fromTransientRoute;
        uint amount;
    }

    IArbSys internal constant arbSys = IArbSys(address(100));

    AccountModule internal immutable accountModule;
    RegisterModule internal immutable registerModule;

    address internal immutable attestor;
    address internal immutable feeReceiver;
    uint internal immutable transferGasLimit;
    uint internal immutable maxBlockDelay;
    address internal immutable acrossSpokePool;
    uint internal immutable hubChainId;
    uint internal immutable maxRelayFeeBps;

    constructor(
        IAuthority _authority,
        AccountModule _accountGate,
        RegisterModule _register,
        uint _hubChainId,
        Config memory _config
    ) Permission(_authority) EIP712("SpokeGate", "1") {
        if (address(_accountGate) == address(0) || address(_register) == address(0)) {
            revert Error.Gate__InvalidModule();
        }
        accountModule = _accountGate;
        registerModule = _register;
        hubChainId = _hubChainId;
        attestor = _config.attestor;
        feeReceiver = _config.feeReceiver;
        transferGasLimit = _config.transferGasLimit;
        maxBlockDelay = _config.maxBlockDelay;
        acrossSpokePool = _config.acrossSpokePool;
        maxRelayFeeBps = _config.maxRelayFeeBps;
    }

    function getConfig() external view returns (Config memory) {
        return Config({
            attestor: attestor,
            feeReceiver: feeReceiver,
            transferGasLimit: transferGasLimit,
            maxBlockDelay: maxBlockDelay,
            acrossSpokePool: acrossSpokePool,
            maxRelayFeeBps: maxRelayFeeBps
        });
    }

    function bridgeHub(
        BridgeHubIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.inputAmount == 0) revert Error.Deposit__NothingToBridge();
        if (_intent.destinationChainId != hubChainId) {
            revert Error.Deposit__InvalidDestinationChain(hubChainId, _intent.destinationChainId);
        }
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, block.number, maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyTokenAndCap(
            registerModule, _intent.params.baseTokenId, address(_intent.inputToken), _intent.inputAmount
        );
        address _hubToken = registerModule.getTokenInfo(_intent.params.baseTokenId).hubToken;
        if (address(_intent.outputToken) != _hubToken) {
            revert Error.Deposit__BaseTokenMismatch(
                _intent.params.baseTokenId, _hubToken, address(_intent.outputToken)
            );
        }

        PuppetAccount _puppetAccount = accountModule.verifyPuppetAccount(_intent.params);
        address _transientRoute = accountModule.predictTransientRoute(address(_puppetAccount));

        if (_intent.fromTransientRoute) {
            uint _trBalance = _intent.inputToken.balanceOf(_transientRoute);
            if (_trBalance < _intent.inputAmount) {
                revert Error.Deposit__InsufficientBalance(_trBalance, _intent.inputAmount);
            }
        } else {
            uint _signed = _puppetAccount.signedBalance();
            if (_signed < _intent.inputAmount) revert Error.Deposit__InsufficientBalance(_signed, _intent.inputAmount);
        }
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.inputAmount, maxRelayFeeBps);
        if (_actualRelayFee >= _intent.inputAmount) {
            revert Error.Deposit__InsufficientBalance(_intent.inputAmount, _actualRelayFee);
        }
        uint _acrossInputAmount = _intent.inputAmount - _actualRelayFee;
        if (_intent.bridgeFee >= _acrossInputAmount) {
            revert Error.Deposit__BridgeFeeExceedsInput(_intent.bridgeFee, _acrossInputAmount);
        }

        address _depositor = _intent.fromTransientRoute ? _transientRoute : address(_puppetAccount);
        IAccount.Call[] memory _bridgeCalls = new IAccount.Call[](_intent.fromTransientRoute && _actualRelayFee > 0 ? 3 : 2);
        _bridgeCalls[0] = IAccount.Call({
            target: address(_intent.inputToken),
            value: 0,
            gasLimit: transferGasLimit,
            callData: abi.encodeCall(IERC20.approve, (acrossSpokePool, _acrossInputAmount))
        });
        _bridgeCalls[1] = IAccount.Call({
            target: acrossSpokePool,
            value: 0,
            gasLimit: 0,
            callData: abi.encodeCall(
                IAcrossSpokePool.depositV3,
                (
                    _depositor,
                    _transientRoute,
                    address(_intent.inputToken),
                    address(_intent.outputToken),
                    _acrossInputAmount,
                    _acrossInputAmount - _intent.bridgeFee,
                    _intent.destinationChainId,
                    _intent.exclusiveRelayer,
                    _intent.quoteTimestamp,
                    _intent.fillDeadline,
                    _intent.exclusivityDeadline,
                    ""
                )
            )
        });

        IAccount.Call[] memory _calls;
        uint _amountOut;
        uint _dispatchRelayFee;
        address _dispatchFeeReceiver;
        if (_intent.fromTransientRoute) {
            if (_actualRelayFee > 0) {
                _bridgeCalls[2] = IAccount.Call({
                    target: address(_intent.inputToken),
                    value: 0,
                    gasLimit: transferGasLimit,
                    callData: abi.encodeCall(IERC20.transfer, (feeReceiver, _actualRelayFee))
                });
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
            _amountOut = _acrossInputAmount;
            _dispatchRelayFee = _actualRelayFee;
            _dispatchFeeReceiver = feeReceiver;
        }

        accountModule.dispatch(
            _puppetAccount,
            _calls,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        BRIDGE_HUB_INTENT_TYPEHASH,
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
                        _intent.bridgeFee,
                        _intent.destinationChainId,
                        _intent.exclusiveRelayer,
                        _intent.quoteTimestamp,
                        _intent.fillDeadline,
                        _intent.exclusivityDeadline
                    )
                )
            ),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce,
            _intent.inputToken,
            0,
            _amountOut,
            _dispatchRelayFee,
            _dispatchFeeReceiver,
            transferGasLimit
        );

        _logEvent("BridgeHub", abi.encode(_intent, _puppetAccount));
    }

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

        (MasterAccount _masterAccount, address _transientRoute) =
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
        if (_intent.destinationChainId == block.chainid) {
            revert Error.Deposit__SameChainBridge(_intent.destinationChainId);
        }
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyTokenAndCap(
            registerModule, _intent.params.baseTokenId, address(_intent.inputToken), _intent.inputAmount
        );

        address _masterAccount = address(accountModule.verifyMasterAccount(_intent.params));
        address _transientRoute = accountModule.predictTransientRoute(_masterAccount);

        if (!_intent.fromTransientRoute) {
            uint _signed = IAccount(_masterAccount).signedBalance();
            if (_signed < _intent.inputAmount) revert Error.Deposit__InsufficientBalance(_signed, _intent.inputAmount);
        }
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.inputAmount, maxRelayFeeBps);
        if (_actualRelayFee >= _intent.inputAmount) {
            revert Error.Deposit__InsufficientBalance(_intent.inputAmount, _actualRelayFee);
        }
        uint _acrossInputAmount = _intent.inputAmount - _actualRelayFee;
        if (_intent.bridgeFee >= _acrossInputAmount) {
            revert Error.Deposit__BridgeFeeExceedsInput(_intent.bridgeFee, _acrossInputAmount);
        }

        address _depositor = _intent.fromTransientRoute ? _transientRoute : _masterAccount;
        IAccount.Call[] memory _bridgeCalls =
            new IAccount.Call[](_intent.fromTransientRoute && _actualRelayFee > 0 ? 3 : 2);
        _bridgeCalls[0] = IAccount.Call({
            target: address(_intent.inputToken),
            value: 0,
            gasLimit: transferGasLimit,
            callData: abi.encodeCall(IERC20.approve, (acrossSpokePool, _acrossInputAmount))
        });
        _bridgeCalls[1] = IAccount.Call({
            target: acrossSpokePool,
            value: 0,
            gasLimit: 0,
            callData: abi.encodeCall(
                IAcrossSpokePool.depositV3,
                (
                    _depositor,
                    _transientRoute,
                    address(_intent.inputToken),
                    address(_intent.outputToken),
                    _acrossInputAmount,
                    _acrossInputAmount - _intent.bridgeFee,
                    _intent.destinationChainId,
                    _intent.exclusiveRelayer,
                    _intent.quoteTimestamp,
                    _intent.fillDeadline,
                    _intent.exclusivityDeadline,
                    ""
                )
            )
        });

        IAccount.Call[] memory _calls;
        uint _amountOut;
        uint _dispatchRelayFee;
        address _dispatchFeeReceiver;
        if (_intent.fromTransientRoute) {
            if (_actualRelayFee > 0) {
                _bridgeCalls[2] = _erc20TransferCall(_intent.inputToken, feeReceiver, _actualRelayFee, transferGasLimit);
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
            _amountOut = _acrossInputAmount;
            _dispatchRelayFee = _actualRelayFee;
            _dispatchFeeReceiver = feeReceiver;
        }

        accountModule.dispatch(
            IAccount(_masterAccount),
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
                        _intent.bridgeFee,
                        _intent.destinationChainId,
                        _intent.exclusiveRelayer,
                        _intent.quoteTimestamp,
                        _intent.fillDeadline,
                        _intent.exclusivityDeadline
                    )
                )
            ),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce,
            _intent.inputToken,
            0,
            _amountOut,
            _dispatchRelayFee,
            _dispatchFeeReceiver,
            transferGasLimit
        );

        _logEvent("Bridge", abi.encode(_intent, _masterAccount));
    }

    function signRecordedBalance(
        MasterSignRecordedBalanceIntent calldata _intent,
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

        address _masterAccount = address(accountModule.verifyMasterAccount(_intent.params));

        IntentLib.verifyRelayFeeRatio(
            _actualRelayFee, IAccount(_masterAccount).signedBalance() + _intent.amount, maxRelayFeeBps
        );

        IAccount.Call[] memory _calls;
        if (_intent.fromTransientRoute) {
            IAccount.Call[] memory _trCalls = new IAccount.Call[](1);
            _trCalls[0] = _erc20TransferCall(_token, _masterAccount, _intent.amount, transferGasLimit);
            _calls = new IAccount.Call[](1);
            _calls[0] = IAccount.Call({
                target: accountModule.predictTransientRoute(_masterAccount),
                value: 0,
                gasLimit: 0,
                callData: abi.encodeCall(TransientRoute.execute, (_trCalls))
            });
        } else {
            _calls = new IAccount.Call[](0);
        }

        accountModule.dispatch(
            IAccount(_masterAccount),
            _calls,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        MASTER_SIGN_RECORDED_BALANCE_INTENT_TYPEHASH,
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

        _logEvent("SignRecordedBalance", abi.encode(_intent, _masterAccount));
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

    function _blockNumber() internal view returns (uint) {
        return address(arbSys).code.length > 0 ? arbSys.arbBlockNumber() : block.number;
    }
}
