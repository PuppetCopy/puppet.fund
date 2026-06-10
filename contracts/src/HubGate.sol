// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseGate} from "./utils/BaseGate.sol";
import {CallLib} from "./utils/CallLib.sol";
import {Error} from "./utils/Error.sol";
import {IntentLib} from "./utils/IntentLib.sol";
import {AccountLib} from "./core/AccountLib.sol";
import {RuleLib} from "./utils/RuleLib.sol";
import {IAuthority} from "./utils/interfaces/IAuthority.sol";

import {AccountModule} from "./core/module/AccountModule.sol";
import {PuppetAccount} from "./core/PuppetAccount.sol";
import {FundAccount} from "./core/FundAccount.sol";
import {IAccount} from "./core/interface/IAccount.sol";
import {ShareModule} from "./hub/ShareModule.sol";
import {ShareToken} from "./hub/ShareToken.sol";
import {ShareLib} from "./hub/ShareLib.sol";
import {AllocateModule, ALLOCATE_INTENT_TYPEHASH} from "./hub/AllocateModule.sol";
import {AllocateStore} from "./hub/store/AllocateStore.sol";
import {SubscribeModule, SUBSCRIBE_INTENT_TYPEHASH} from "./hub/SubscribeModule.sol";
import {
    RedeemModule,
    SELL_INTENT_TYPEHASH,
    CLAIM_INTENT_TYPEHASH,
    FULFILL_INTENT_TYPEHASH
} from "./hub/RedeemModule.sol";
import {RedeemStore} from "./hub/store/RedeemStore.sol";
import {RegisterModule} from "./core/module/RegisterModule.sol";

bytes32 constant WITHDRAW_TO_WALLET_INTENT_TYPEHASH = keccak256(
    "WithdrawToWalletIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bytes32 tokenId,uint256 amount)AccountInitParams(address user,address signer)"
);

bytes32 constant WITHDRAW_TO_BRIDGE_INTENT_TYPEHASH = keccak256(
    "WithdrawToBridgeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bytes32 tokenId,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address provider,bytes providerCallData,uint32 expires,uint32 fillDeadline)AccountInitParams(address user,address signer)"
);

contract HubGate is BaseGate, EIP712 {
    struct WithdrawToWalletIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        bytes32 tokenId;
        uint amount;
    }

    struct WithdrawToBridgeIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        bytes32 tokenId;
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

    ShareModule internal immutable shareModule;
    AllocateModule internal immutable allocateModule;
    AllocateStore internal immutable allocateStore;
    SubscribeModule internal immutable subscribeModule;
    RedeemModule internal immutable redeemModule;
    RedeemStore internal immutable redeemStore;

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
    ) BaseGate(_authority, _accountGate, _register, _config) EIP712("HubGate", "1") {
        if (
            address(_shareGate) == address(0) || address(_allocate) == address(0)
                || address(_allocateStore) == address(0) || address(_subscribe) == address(0)
                || address(_redeem) == address(0) || address(_redeemStore) == address(0)
        ) revert Error.Gate__InvalidModule();
        shareModule = _shareGate;
        allocateModule = _allocate;
        allocateStore = _allocateStore;
        subscribeModule = _subscribe;
        redeemModule = _redeem;
        redeemStore = _redeemStore;
    }

    function predictShareToken(
        ShareLib.ShareInitParams calldata _shareParams
    ) public view returns (ShareToken) {
        return ShareToken(shareModule.predict(_shareParams));
    }

    function subscribe(
        SubscribeModule.SubscribeIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IERC20 _base = IntentLib.verifyTokenAndCap(registerModule, _intent.baseTokenId, address(0), 0);

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
                    _intent.baseTokenId,
                    RuleLib.hashRules(_intent.rules)
                )
            )
        );

        IntentLib.verifyRelayFeeRatio(
            _actualRelayFee,
            accountModule.verifyPuppetAccount(_intent.params).signedBalanceOf(_intent.baseTokenId),
            maxRelayFeeBps
        );
        subscribeModule.subscribe(
            _intent,
            accountModule,
            allocateStore,
            _base,
            _intent.baseTokenId,
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
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IERC20 _base =
            IntentLib.verifyTokenAndCap(registerModule, _intent.share.baseTokenId, address(0), _intent.masterAmount);
        if (address(accountModule.verifyPuppetAccount(_intent.params)) != _intent.share.master) {
            revert Error.Share__MasterMismatch(
                address(accountModule.verifyPuppetAccount(_intent.params)), _intent.share.master
            );
        }

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
                    ShareLib.hashShare(_intent.share),
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.masterAmount,
                    keccak256(abi.encodePacked(_intent.puppetList)),
                    keccak256(abi.encodePacked(_intent.matchedAmountList))
                )
            )
        );
        uint _fundAccountIn = allocateModule.allocate(
            _intent,
            _bodyList,
            _mandateList,
            accountModule,
            shareModule,
            allocateStore,
            redeemStore,
            _base,
            _digest,
            _domainSeparatorV4(),
            _userSignature,
            _attestorSignature,
            attestor,
            transferGasLimit,
            feeReceiver,
            _actualRelayFee
        );
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _fundAccountIn, maxRelayFeeBps);
    }

    function sell(
        RedeemModule.SellIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        FundAccount _fund = accountModule.verifyFundAccount(_intent.share.master);
        address _fundAccount = address(_fund);

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
                    ShareLib.hashShare(_intent.share),
                    _intent.sharesOut
                )
            )
        );

        bytes32 _baseTokenId = _intent.share.baseTokenId;
        IERC20 _baseToken = IntentLib.verifyTokenAndCap(registerModule, _baseTokenId, address(0), 0);

        PuppetAccount _holder = accountModule.verifyPuppetAccount(_intent.params);

        IntentLib.verifyRelayFeeRatio(
            _actualRelayFee,
            _holder.signedBalanceOf(_baseTokenId)
                + redeemModule.getClaimable(redeemStore, _fundAccount, address(_holder)),
            maxRelayFeeBps
        );

        redeemModule.sell(
            _intent,
            IAccount(address(_holder)),
            redeemStore,
            accountModule,
            shareModule,
            _baseToken,
            _fundAccount,
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
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        FundAccount _fund = accountModule.verifyFundAccount(_intent.share.master);
        address _fundAccount = address(_fund);

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
                    ShareLib.hashShare(_intent.share),
                    _intent.amount
                )
            )
        );

        IERC20 _baseToken = IntentLib.verifyTokenAndCap(registerModule, _intent.share.baseTokenId, address(0), 0);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.amount, maxRelayFeeBps);

        return redeemModule.claim(
            _intent,
            redeemStore,
            accountModule,
            shareModule,
            _baseToken,
            _fundAccount,
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
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        PuppetAccount _master = accountModule.verifyPuppetAccount(_intent.params);
        if (address(_master) != _intent.share.master) {
            revert Error.Share__MasterMismatch(address(_master), _intent.share.master);
        }
        address _fundAccount = address(accountModule.verifyFundAccount(address(_master)));
        IERC20 _baseToken = IntentLib.verifyTokenAndCap(registerModule, _intent.share.baseTokenId, address(0), 0);

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
                    ShareLib.hashShare(_intent.share),
                    _intent.sharesOut,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.acceptableShares
                )
            )
        );

        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.acceptableNetAssetValue, maxRelayFeeBps);
        redeemModule.fulfill(
            _intent,
            redeemStore,
            accountModule,
            shareModule,
            _baseToken,
            _fundAccount,
            _digest,
            _userSignature,
            _attestorSignature,
            attestor,
            transferGasLimit,
            feeReceiver,
            _actualRelayFee
        );
    }

    function withdrawToWallet(
        WithdrawToWalletIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.amount == 0) revert Error.Deposit__NothingToWithdraw();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IERC20 _token = IntentLib.verifyTokenAndCap(registerModule, _intent.tokenId, address(0), _intent.amount);
        PuppetAccount _account = accountModule.verifyPuppetAccount(_intent.params);

        uint _signed = _account.signedBalanceOf(_intent.tokenId);
        if (_signed < _intent.amount) revert Error.Deposit__InsufficientBalance(_signed, _intent.amount);
        if (_actualRelayFee >= _intent.amount) revert Error.Deposit__RelayFeeTooHigh();
        uint _receiverAmount = _intent.amount - _actualRelayFee;

        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    WITHDRAW_TO_WALLET_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.tokenId,
                    _intent.amount
                )
            )
        );

        accountModule.dispatch(
            IAccount(address(_account)),
            CallLib.withFee(
                CallLib.transferCall(_token, _intent.params.user, _receiverAmount, transferGasLimit),
                _token,
                feeReceiver,
                _actualRelayFee,
                transferGasLimit
            ),
            CallLib.signTransfer(_intent.tokenId, _token, 0, _intent.amount),
            _digest,
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );

        _logEvent("WithdrawToWallet", abi.encode(_intent, address(_account)));
    }

    function withdrawToBridge(
        WithdrawToBridgeIntent calldata _intent,
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
        IERC20 _token = IntentLib.verifyTokenAndCap(
            registerModule, _intent.tokenId, address(_intent.inputToken), _intent.inputAmount
        );

        PuppetAccount _puppetAccount = accountModule.verifyPuppetAccount(_intent.params);
        address _recipient = _puppetAccount.getUser();
        address _route = accountModule.predictRoute(address(_puppetAccount));

        uint _routeBalance = _token.balanceOf(_route);
        if (_routeBalance < _intent.inputAmount) {
            revert Error.Deposit__InsufficientBalance(_routeBalance, _intent.inputAmount);
        }

        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.inputAmount, maxRelayFeeBps);
        if (_actualRelayFee >= _intent.inputAmount) revert Error.Deposit__RelayFeeTooHigh();
        if (_intent.outputAmount == 0) revert Error.Deposit__ZeroBridgeOutput();
        uint _settler = _intent.inputAmount - _actualRelayFee;

        IAccount.Call[] memory _legs = new IAccount.Call[](_actualRelayFee > 0 ? 4 : 3);
        _legs[0] = CallLib.approveCall(_token, _intent.provider, _settler, transferGasLimit);
        _legs[1] = IAccount.Call({target: _intent.provider, value: 0, gasLimit: 0, callData: _intent.providerCallData});
        _legs[2] = CallLib.approveCall(_token, _intent.provider, 0, transferGasLimit);
        if (_actualRelayFee > 0) {
            _legs[3] = CallLib.transferCall(_token, feeReceiver, _actualRelayFee, transferGasLimit);
        }

        accountModule.dispatch(
            IAccount(address(_puppetAccount)),
            CallLib.wrap(CallLib.routeExecute(_route, _legs)),
            CallLib.noTransfers(),
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        WITHDRAW_TO_BRIDGE_INTENT_TYPEHASH,
                        AccountLib.hashAccount(_intent.params),
                        _intent.blockNumber,
                        _intent.deadline,
                        _intent.acceptableRelayFee,
                        _intent.nonce,
                        _intent.chainId,
                        _intent.tokenId,
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
            _intent.nonce
        );

        _logEvent("WithdrawToBridge", abi.encode(_intent, _puppetAccount, _recipient));
    }
}
