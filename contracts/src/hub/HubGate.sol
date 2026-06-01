// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Permission} from "../utils/auth/Permission.sol";
import {Error} from "../utils/Error.sol";
import {IntentLib} from "../utils/IntentLib.sol";
import {AccountLib} from "../core/AccountLib.sol";
import {RuleLib} from "./RuleLib.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {IArbSys} from "../utils/interfaces/IArbSys.sol";

import {AccountModule} from "../core/module/AccountModule.sol";
import {PuppetAccount} from "../core/PuppetAccount.sol";
import {MasterAccount} from "../core/MasterAccount.sol";
import {IAccount} from "../core/interface/IAccount.sol";
import {ShareModule} from "./ShareModule.sol";
import {ShareToken} from "./ShareToken.sol";
import {AllocateModule, ALLOCATE_INTENT_TYPEHASH} from "./module/AllocateModule.sol";
import {AllocateStore} from "./AllocateStore.sol";
import {SubscribeModule, SUBSCRIBE_INTENT_TYPEHASH} from "./module/SubscribeModule.sol";
import {RedeemModule, SELL_INTENT_TYPEHASH, CLAIM_INTENT_TYPEHASH, FULFILL_INTENT_TYPEHASH} from "./module/RedeemModule.sol";
import {RedeemStore} from "./RedeemStore.sol";
import {RegisterModule} from "../core/module/RegisterModule.sol";
import {IAcrossSpokePool} from "../utils/interfaces/IAcrossSpokePool.sol";

bytes32 constant BRIDGE_TO_WALLET_INTENT_TYPEHASH = keccak256(
    "BridgeToWalletIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,address inputToken,address outputToken,uint256 inputAmount,uint256 bridgeFee,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

contract HubGate is Permission, EIP712 {
    struct Config {
        address attestor;
        address feeReceiver;
        uint transferGasLimit;
        uint maxBlockDelay;
        address acrossSpokePool;
        uint maxRelayFeeBps;
    }

    struct BridgeToWalletIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
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

    IArbSys public constant arbSys = IArbSys(address(100));

    AccountModule internal immutable accountModule;
    ShareModule internal immutable shareModule;
    AllocateModule internal immutable allocateModule;
    AllocateStore internal immutable allocateStore;
    SubscribeModule internal immutable subscribeModule;
    RedeemModule internal immutable redeemModule;
    RedeemStore internal immutable redeemStore;
    RegisterModule internal immutable registerModule;

    address internal immutable attestor;
    address internal immutable feeReceiver;
    uint internal immutable transferGasLimit;
    uint internal immutable maxBlockDelay;
    address internal immutable acrossSpokePool;
    uint internal immutable maxRelayFeeBps;

    constructor(
        IAuthority _authority,
        AccountModule _accountGate,
        ShareModule _shareGate,
        AllocateModule _allocate,
        AllocateStore _allocateStore,
        SubscribeModule _subscribe,
        RedeemModule _redeem,
        RedeemStore _redeemStore,
        RegisterModule _register,
        Config memory _config
    ) Permission(_authority) EIP712("HubGate", "1") {
        if (
            address(_accountGate) == address(0) || address(_shareGate) == address(0) || address(_allocate) == address(0)
                || address(_allocateStore) == address(0) || address(_subscribe) == address(0)
                || address(_redeem) == address(0) || address(_redeemStore) == address(0)
                || address(_register) == address(0)
        ) revert Error.Gate__InvalidModule();
        accountModule = _accountGate;
        shareModule = _shareGate;
        allocateModule = _allocate;
        allocateStore = _allocateStore;
        subscribeModule = _subscribe;
        redeemModule = _redeem;
        redeemStore = _redeemStore;
        registerModule = _register;
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

    function predictShareToken(
        address _masterAccount
    ) public view returns (ShareToken) {
        return ShareToken(shareModule.predict(_masterAccount));
    }

    function subscribe(
        SubscribeModule.SubscribeIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, arbSys.arbBlockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyTokenAndCap(registerModule, _intent.params.baseTokenId, address(_intent.baseToken), 0);

        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SUBSCRIBE_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    RuleLib.hashRules(_intent.rules)
                )
            )
        );

        IntentLib.verifyRelayFeeRatio(
            _actualRelayFee, accountModule.verifyPuppetAccount(_intent.params).signedBalance(), maxRelayFeeBps
        );
        subscribeModule.subscribe(
            _intent,
            accountModule,
            allocateStore,
            _digest,
            _domainSeparatorV4(),
            _userSignature,
            _attestorSignature,
            attestor,
            feeReceiver,
            _actualRelayFee,
            transferGasLimit
        );
    }

    function allocate(
        AllocateModule.AllocateIntent calldata _intent,
        bytes[] calldata _bodyList,
        bytes[] calldata _mandateList,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, arbSys.arbBlockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyTokenAndCap(
            registerModule, _intent.params.baseTokenId, address(_intent.baseToken), _intent.masterAmount
        );
        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ALLOCATE_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.masterAmount,
                    keccak256(abi.encodePacked(_intent.puppetList)),
                    keccak256(abi.encodePacked(_intent.matchedAmountList))
                )
            )
        );
        uint _masterAccountIn = allocateModule.allocate(
            _intent,
            _bodyList,
            _mandateList,
            accountModule,
            shareModule,
            allocateStore,
            _digest,
            _domainSeparatorV4(),
            _userSignature,
            _attestorSignature,
            attestor,
            transferGasLimit,
            feeReceiver,
            _actualRelayFee
        );
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _masterAccountIn, maxRelayFeeBps);
    }

    function createMaster(
        AllocateModule.AllocateIntent calldata _intent,
        bytes[] calldata _bodyList,
        bytes[] calldata _mandateList,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        (MasterAccount _masterAccount,) = accountModule.createMasterAccount(_intent.params, _userDeploySig, _signerProof);
        shareModule.createShareToken(address(_masterAccount), _intent.masterAmount);
        this.allocate(_intent, _bodyList, _mandateList, _userSignature, _attestorSignature, _actualRelayFee);
    }

    function sell(
        RedeemModule.SellIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, arbSys.arbBlockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        address _masterAccount = address(accountModule.verifyMasterAccount(_intent.masterParams));

        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SELL_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    AccountLib.hashAccount(_intent.masterParams),
                    _intent.sharesOut
                )
            )
        );

        ShareToken _shareToken = predictShareToken(_masterAccount);
        IERC20 _baseToken = IntentLib.verifyTokenAndCap(registerModule, _intent.masterParams.baseTokenId, address(0), 0);
        uint _holderSignedBalance = AccountLib.hashAccount(_intent.params) == AccountLib.hashAccount(_intent.masterParams)
            ? IAccount(_masterAccount).signedBalance()
            : accountModule.verifyPuppetAccount(_intent.params).signedBalance();
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _holderSignedBalance, maxRelayFeeBps);

        redeemModule.sell(
            _intent,
            _masterAccount,
            redeemStore,
            accountModule,
            _baseToken,
            _shareToken,
            _digest,
            _userSignature,
            _attestorSignature,
            attestor,
            transferGasLimit,
            feeReceiver,
            _actualRelayFee
        );
    }

    function claim(
        RedeemModule.ClaimIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external returns (uint) {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, arbSys.arbBlockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        address _masterAccount = address(accountModule.verifyMasterAccount(_intent.masterParams));

        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    AccountLib.hashAccount(_intent.masterParams),
                    _intent.amount
                )
            )
        );

        ShareToken _shareToken = predictShareToken(_masterAccount);
        IERC20 _baseToken = IntentLib.verifyTokenAndCap(registerModule, _intent.masterParams.baseTokenId, address(0), 0);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.amount, maxRelayFeeBps);

        return redeemModule.claim(
            _intent,
            _masterAccount,
            redeemStore,
            accountModule,
            _baseToken,
            _shareToken,
            _digest,
            _userSignature,
            _attestorSignature,
            attestor,
            transferGasLimit,
            feeReceiver,
            _actualRelayFee
        );
    }

    function fulfill(
        RedeemModule.FulfillIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, arbSys.arbBlockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        address _masterAccount = address(accountModule.verifyMasterAccount(_intent.params));
        IERC20 _baseToken = IntentLib.verifyTokenAndCap(registerModule, _intent.params.baseTokenId, address(0), 0);
        ShareToken _shareToken = predictShareToken(_masterAccount);

        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    FULFILL_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.acceptableShares
                )
            )
        );

        IntentLib.verifyRelayFeeRatio(_actualRelayFee, IAccount(_masterAccount).signedBalance(), maxRelayFeeBps);
        redeemModule.fulfill(
            _intent,
            _masterAccount,
            redeemStore,
            accountModule,
            shareModule,
            _baseToken,
            _shareToken,
            _digest,
            _userSignature,
            _attestorSignature,
            attestor,
            transferGasLimit,
            feeReceiver,
            _actualRelayFee
        );
    }

    function bridgeToWallet(
        BridgeToWalletIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.inputAmount == 0) revert Error.Deposit__NothingToBridge();
        if (_intent.destinationChainId == block.chainid) {
            revert Error.Deposit__SameChainBridge(_intent.destinationChainId);
        }
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, arbSys.arbBlockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyTokenAndCap(
            registerModule, _intent.params.baseTokenId, address(_intent.inputToken), _intent.inputAmount
        );

        PuppetAccount _puppetAccount = accountModule.verifyPuppetAccount(_intent.params);
        address _recipient = _puppetAccount.getUser();

        uint _signed = _puppetAccount.signedBalance();
        if (_signed < _intent.inputAmount) revert Error.Deposit__InsufficientBalance(_signed, _intent.inputAmount);

        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.inputAmount, maxRelayFeeBps);
        if (_actualRelayFee >= _intent.inputAmount) {
            revert Error.Deposit__InsufficientBalance(_intent.inputAmount, _actualRelayFee);
        }
        uint _acrossInputAmount = _intent.inputAmount - _actualRelayFee;
        if (_intent.bridgeFee >= _acrossInputAmount) {
            revert Error.Deposit__BridgeFeeExceedsInput(_intent.bridgeFee, _acrossInputAmount);
        }

        IAccount.Call[] memory _calls = new IAccount.Call[](2);
        _calls[0] = IAccount.Call({
            target: address(_intent.inputToken),
            value: 0,
            gasLimit: transferGasLimit,
            callData: abi.encodeCall(IERC20.approve, (acrossSpokePool, _acrossInputAmount))
        });
        _calls[1] = IAccount.Call({
            target: acrossSpokePool,
            value: 0,
            gasLimit: 0,
            callData: abi.encodeCall(
                IAcrossSpokePool.depositV3,
                (
                    address(_puppetAccount),
                    _recipient,
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

        accountModule.dispatch(
            _puppetAccount,
            _calls,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        BRIDGE_TO_WALLET_INTENT_TYPEHASH,
                        AccountLib.hashAccount(_intent.params),
                        _intent.blockNumber,
                        _intent.deadline,
                        _intent.acceptableRelayFee,
                        _intent.nonce,
                        _intent.chainId,
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
            _acrossInputAmount,
            _actualRelayFee,
            feeReceiver,
            transferGasLimit
        );

        _logEvent("BridgeToWallet", abi.encode(_intent, _puppetAccount, _recipient));
    }
}
