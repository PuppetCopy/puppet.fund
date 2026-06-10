// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAccount} from "../core/interface/IAccount.sol";
import {PuppetAccount} from "../core/PuppetAccount.sol";
import {AccountLib} from "../core/AccountLib.sol";
import {AccountModule} from "../core/module/AccountModule.sol";
import {AllocateStore} from "./store/AllocateStore.sol";
import {RuleLib} from "../utils/RuleLib.sol";
import {Access} from "../utils/auth/Access.sol";
import {CallLib} from "../utils/CallLib.sol";
import {Error} from "../utils/Error.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {IntentLib} from "../utils/IntentLib.sol";

bytes32 constant SUBSCRIBE_INTENT_TYPEHASH = keccak256(
    "SubscribeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bytes32 baseTokenId,SubscribeRule[] rules)AccountInitParams(address user,address signer)SubscribeRule(address fund,bytes body,bytes mandate)"
);

contract SubscribeModule is Access {
    struct SubscribeIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        bytes32 baseTokenId;
        RuleLib.Rule[] rules;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function subscribe(
        SubscribeIntent calldata _intent,
        AccountModule _accountGate,
        AllocateStore _store,
        IERC20 _base,
        bytes32 _baseTokenId,
        bytes32 _digest,
        bytes32 _routerDomainSeparator,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        address _feeReceiver,
        uint _actualRelayFee,
        uint _transferGasLimit
    ) external auth {
        uint _n = _intent.rules.length;
        if (_n == 0) revert Error.Subscribe__EmptyRules();

        PuppetAccount _puppetAccount = _accountGate.verifyPuppetAccount(_intent.params);

        _accountGate.dispatch(
            IAccount(address(_puppetAccount)),
            CallLib.feeOnly(_base, _feeReceiver, _actualRelayFee, _transferGasLimit),
            CallLib.signTransfer(_baseTokenId, _base, 0, _actualRelayFee),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        address _prevFund;
        address _ownFund = _accountGate.predictFundAccount(address(_puppetAccount));
        for (uint _i; _i < _n; ++_i) {
            RuleLib.Rule calldata _rl = _intent.rules[_i];
            address _fund = _rl.fund;
            if (_fund == _ownFund) {
                revert Error.Subscribe__SelfSubscribe(_puppetAccount.getUser());
            }
            if (_i > 0 && uint160(_fund) <= uint160(_prevFund)) {
                revert Error.Subscribe__FundListNotSorted(_prevFund, _fund);
            }
            _prevFund = _fund;

            if (_rl.body.length == 0) {
                _store.setMandate(address(_puppetAccount), _fund, bytes32(0));
            } else {
                (bytes32 _bodyHash, bytes32 _mandateDigest) =
                    RuleLib.mandate(_routerDomainSeparator, address(_puppetAccount), _fund, _base, _rl.body);
                IntentLib.verifySignature(_puppetAccount, _mandateDigest, _rl.mandate);
                _store.setMandate(address(_puppetAccount), _fund, _bodyHash);
            }

            _logEvent("Subscribe", abi.encode(_puppetAccount, _fund, _intent.params, _rl.body, _rl.mandate));
        }
    }
}
