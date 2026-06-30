// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseGate} from "./utils/BaseGate.sol";
import {CallLib} from "./utils/CallLib.sol";
import {SignLib} from "./utils/SignLib.sol";
import {Error} from "./utils/Error.sol";
import {IntentLib} from "./utils/IntentLib.sol";
import {AccountLib} from "./utils/AccountLib.sol";
import {RuleLib} from "./utils/RuleLib.sol";
import {IAuthority} from "./utils/interfaces/IAuthority.sol";

import {Account} from "./core/Account.sol";
import {PuppetAccount} from "./core/PuppetAccount.sol";
import {FundAccount} from "./core/FundAccount.sol";
import {IAccount} from "./utils/interfaces/IAccount.sol";
import {Issue} from "./hub/Issue.sol";
import {ShareToken} from "./hub/ShareToken.sol";
import {FundAccountLib} from "./utils/FundAccountLib.sol";
import {Allocate, ALLOCATE_INTENT_TYPEHASH} from "./hub/Allocate.sol";
import {AllocateStore} from "./hub/store/AllocateStore.sol";
import {Mandate, MANDATE_INTENT_TYPEHASH} from "./hub/Mandate.sol";
import {
    Redeem,
    SELL_INTENT_TYPEHASH,
    CLAIM_INTENT_TYPEHASH,
    REDEEM_INTENT_TYPEHASH,
    LIQUIDATE_INTENT_TYPEHASH
} from "./hub/Redeem.sol";
import {RedeemStore} from "./hub/store/RedeemStore.sol";
import {Register} from "./core/Register.sol";

bytes32 constant WITHDRAW_INTENT_TYPEHASH = keccak256(
    "WithdrawIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address provider,bytes providerCallData,uint32 expires,uint32 fillDeadline)AccountInitParams(address user,address signer)"
);

contract HubGate is BaseGate, EIP712 {
    struct WithdrawIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        address inputToken;
        address outputToken;
        uint inputAmount;
        uint outputAmount;
        uint destinationChainId;
        address provider;
        bytes providerCallData;
        uint32 expires;
        uint32 fillDeadline;
    }

    Issue internal immutable shareModule;
    Allocate internal immutable allocateModule;
    AllocateStore internal immutable allocateStore;
    Mandate internal immutable mandateModule;
    Redeem internal immutable redeemModule;
    RedeemStore internal immutable redeemStore;

    constructor(
        IAuthority _authority,
        Account _accountGate,
        Issue _shareGate,
        Allocate _allocate,
        AllocateStore _allocateStore,
        Mandate _mandate,
        Redeem _redeem,
        RedeemStore _redeemStore,
        Register _register,
        Config memory _config
    ) BaseGate(_authority, _accountGate, _register, _config) EIP712("HubGate", "1") {
        if (
            address(_shareGate) == address(0) || address(_allocate) == address(0)
                || address(_allocateStore) == address(0) || address(_mandate) == address(0)
                || address(_redeem) == address(0) || address(_redeemStore) == address(0)
        ) revert Error.Gate__InvalidModule();
        shareModule = _shareGate;
        allocateModule = _allocate;
        allocateStore = _allocateStore;
        mandateModule = _mandate;
        redeemModule = _redeem;
        redeemStore = _redeemStore;
    }

    function predictShareToken(
        FundAccountLib.FundAccountInitParams calldata _fundParams
    ) public view returns (ShareToken) {
        return ShareToken(shareModule.predict(accountModule.predictFundAccount(_fundParams), _fundParams));
    }

    function mandate(
        Mandate.MandateIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        _mandate(_intent, accountModule.verifyPuppetAccount(_intent.params), _userSignature, _attestorSignature, _actualRelayFee);
    }

    function mandate(
        Mandate.MandateIntent calldata _intent,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        address _predicted = accountModule.predictPuppetAccount(_intent.params);
        PuppetAccount _puppet = PuppetAccount(payable(_predicted));
        if (_predicted.code.length == 0) {
            (_puppet,) = accountModule.createPuppetAccount(_intent.params, _userDeploySig, _signerProof);
        }
        _mandate(_intent, _puppet, _userSignature, _attestorSignature, _actualRelayFee);
    }

    function _mandate(
        Mandate.MandateIntent calldata _intent,
        PuppetAccount _puppet,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) internal {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        address _base = _intent.baseToken;
        IntentLib.verifyTokenAndCap(registerModule, _base, 0);

        address _route = accountModule.predictRoute(address(_puppet));
        uint _recognize = IERC20(_base).balanceOf(_route);
        IntentLib.verifyRelayFeeRatio(
            _actualRelayFee, _puppet.signedBalanceOf(_base) + _recognize, maxRelayFeeBps
        );

        mandateModule.mandate(
            _intent,
            accountModule,
            _puppet,
            _route,
            _recognize,
            allocateStore,
            _base,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        MANDATE_INTENT_TYPEHASH,
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
            ),
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
        Allocate.AllocateIntent calldata _intent,
        bytes[] calldata _bodyList,
        bytes[] calldata _mandateList,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        _allocate(
            _intent,
            _bodyList,
            _mandateList,
            address(accountModule.verifyPuppetAccount(_intent.params)),
            _userSignature,
            _attestorSignature,
            _actualRelayFee
        );
    }

    function allocate(
        Allocate.AllocateIntent calldata _intent,
        bytes[] calldata _bodyList,
        bytes[] calldata _mandateList,
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
        _allocate(_intent, _bodyList, _mandateList, _master, _userSignature, _attestorSignature, _actualRelayFee);
    }

    function _allocate(
        Allocate.AllocateIntent calldata _intent,
        bytes[] calldata _bodyList,
        bytes[] calldata _mandateList,
        address _master,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) internal {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        address _base = _intent.fundParams.baseToken;
        IntentLib.verifyTokenAndCap(registerModule, _base, _intent.masterAmount);

        if (_master != _intent.fundParams.master) {
            revert Error.Share__MasterMismatch(_master, _intent.fundParams.master);
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
                    FundAccountLib.hashFundAccount(_intent.fundParams),
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.masterAmount,
                    keccak256(abi.encodePacked(_intent.puppetList)),
                    keccak256(abi.encodePacked(_intent.allocatedAmountList))
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
        IntentLib.verifyTokenAndCap(registerModule, _intent.fundParams.baseToken,_fundAccountIn);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _fundAccountIn, maxRelayFeeBps);
    }

    function sell(
        Redeem.SellIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        address _fundAccount = address(
            accountModule.verifyFundAccount(_intent.fundParams)
        );

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
                    FundAccountLib.hashFundAccount(_intent.fundParams),
                    _intent.sharesOut
                )
            )
        );

        address _baseToken = _intent.fundParams.baseToken;
        IntentLib.verifyTokenAndCap(registerModule, _baseToken, 0);

        PuppetAccount _holder = accountModule.verifyPuppetAccount(_intent.params);

        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _holder.signedBalanceOf(_baseToken), maxRelayFeeBps);

        redeemModule.sell(
            _intent,
            _holder,
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
        Redeem.ClaimIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external returns (uint) {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        address _fundAccount = address(
            accountModule.verifyFundAccount(_intent.fundParams)
        );

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
                    FundAccountLib.hashFundAccount(_intent.fundParams)
                )
            )
        );

        address _baseToken = _intent.fundParams.baseToken;
        IntentLib.verifyTokenAndCap(registerModule, _baseToken, 0);
 
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

    function redeem(
        Redeem.RedeemIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        PuppetAccount _master = accountModule.verifyPuppetAccount(_intent.params);
        if (address(_master) != _intent.fundParams.master) {
            revert Error.Share__MasterMismatch(address(_master), _intent.fundParams.master);
        }
        address _fundAccount = address(
            accountModule.verifyFundAccount(_intent.fundParams)
        );
        address _baseToken = _intent.fundParams.baseToken;
        IntentLib.verifyTokenAndCap(registerModule, _baseToken, 0);

        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    REDEEM_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    FundAccountLib.hashFundAccount(_intent.fundParams),
                    _intent.sharesOut,
                    _intent.assetsOut,
                    _intent.acceptableNetAssetValue
                )
            )
        );

        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.acceptableNetAssetValue, maxRelayFeeBps);
        redeemModule.redeem(
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

    function liquidate(
        Redeem.LiquidateIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        PuppetAccount _master = accountModule.verifyPuppetAccount(_intent.params);
        if (address(_master) != _intent.fundParams.master) {
            revert Error.Share__MasterMismatch(address(_master), _intent.fundParams.master);
        }
        address _fundAccount = address(
            accountModule.verifyFundAccount(_intent.fundParams)
        );
        address _baseToken = _intent.fundParams.baseToken;
        IntentLib.verifyTokenAndCap(registerModule, _baseToken, 0);

        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LIQUIDATE_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    FundAccountLib.hashFundAccount(_intent.fundParams),
                    _intent.acceptableNetAssetValue
                )
            )
        );

        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.acceptableNetAssetValue, maxRelayFeeBps);
        redeemModule.liquidate(
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

    function withdraw(
        WithdrawIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.inputAmount == 0) revert Error.Balance__NothingToWithdraw();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        address _token = _intent.inputToken;
        IntentLib.verifyTokenAndCap(registerModule, _token, _intent.inputAmount);
        PuppetAccount _account = accountModule.verifyPuppetAccount(_intent.params);

        uint _signed = _account.signedBalanceOf(_token);
        if (_signed < _intent.inputAmount) revert Error.Balance__InsufficientBalance(_signed, _intent.inputAmount);
        if (_actualRelayFee >= _intent.inputAmount) revert Error.Balance__RelayFeeTooHigh();
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.inputAmount, maxRelayFeeBps);
        uint _settler = _intent.inputAmount - _actualRelayFee;

        IAccount.Call[] memory _callList;
        if (_intent.provider == address(0)) {
            if (
                _intent.outputToken != _intent.inputToken || _intent.destinationChainId != block.chainid
                    || _intent.providerCallData.length != 0
            ) revert Error.Balance__InvalidWithdraw();
            IAccount.Call memory _payout = CallLib.payout(_token, _intent.params.user, _settler, transferGasLimit);
            _callList = _actualRelayFee > 0
                ? CallLib.compose(_payout, CallLib.fee(_token, feeReceiver, _actualRelayFee, transferGasLimit))
                : CallLib.compose(_payout);
        } else {
            if (_intent.outputAmount == 0) revert Error.Balance__ZeroSwapOutput();
            if (_intent.providerCallData.length == 0) revert Error.Balance__InvalidWithdraw();
            IAccount.Call memory _approve = CallLib.approve(_token, _intent.provider, _settler, transferGasLimit);
            IAccount.Call memory _dex = IAccount.Call({target: _intent.provider, value: 0, gasLimit: 0, callData: _intent.providerCallData});
            IAccount.Call memory _reset = CallLib.approve(_token, _intent.provider, 0, transferGasLimit);
            _callList = _actualRelayFee > 0
                ? CallLib.compose(_approve, _dex, _reset, CallLib.fee(_token, feeReceiver, _actualRelayFee, transferGasLimit))
                : CallLib.compose(_approve, _dex, _reset);
        }

        accountModule.dispatch(
            IAccount(address(_account)),
            _callList,
            SignLib.transfer(_token, 0, _intent.inputAmount),
            _hashWithdraw(_intent),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );

        _logEvent("Withdraw", abi.encode(_intent, _actualRelayFee, address(_account)));
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
        );
    }
}
