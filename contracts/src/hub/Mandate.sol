// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAccount} from "../utils/interfaces/IAccount.sol";
import {PuppetAccount} from "../core/PuppetAccount.sol";
import {FundAccount} from "../core/FundAccount.sol";
import {AccountLib} from "../utils/AccountLib.sol";
import {Account} from "../core/Account.sol";
import {AllocateStore} from "./store/AllocateStore.sol";
import {RuleLib} from "../utils/RuleLib.sol";
import {Access} from "../utils/auth/Access.sol";
import {CallLib} from "../utils/CallLib.sol";
import {SignLib} from "../utils/SignLib.sol";
import {Error} from "../utils/Error.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {IntentLib} from "../utils/IntentLib.sol";

bytes32 constant MANDATE_INTENT_TYPEHASH = keccak256(
    "MandateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,address baseToken,FundMandateRule[] rules)AccountInitParams(address user,address signer)FundMandateRule(address fund,bytes body,bytes mandate)"
);

contract Mandate is Access {
    struct MandateIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        address baseToken;
        RuleLib.Rule[] rules;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function mandate(
        MandateIntent calldata _intent,
        Account _accountGate,
        PuppetAccount _puppetAccount,
        address _route,
        uint _recognize,
        AllocateStore _store,
        address _base,
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
        if (_n == 0) revert Error.Mandate__EmptyRules();

        IAccount.Call[] memory _callList;
        IAccount.SignTransfer[] memory _transferList;
        if (_recognize > 0) {
            IAccount.Call memory _deposit = CallLib.routeExecute(
                _route, CallLib.compose(CallLib.transfer(_base, address(_puppetAccount), _recognize, _transferGasLimit))
            );
            _callList = _actualRelayFee > 0
                ? CallLib.compose(_deposit, CallLib.fee(_base, _feeReceiver, _actualRelayFee, _transferGasLimit))
                : CallLib.compose(_deposit);
            _transferList = SignLib.transfer(_base,_recognize, _actualRelayFee);
        } else {
            _callList = CallLib.feeOnly(_base, _feeReceiver, _actualRelayFee, _transferGasLimit);
            _transferList = SignLib.transfer(_base,0, _actualRelayFee);
        }

        _accountGate.dispatch(
            IAccount(address(_puppetAccount)),
            _callList,
            _transferList,
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        address _prevFund;
        for (uint _i; _i < _n; ++_i) {
            RuleLib.Rule calldata _rl = _intent.rules[_i];
            address _fund = _rl.fund;
            if (_fund.code.length > 0 && FundAccount(payable(_fund)).getSigner() == address(_puppetAccount)) {
                revert Error.Mandate__SelfFund(_puppetAccount.getUser());
            }
            if (_i > 0 && uint160(_fund) <= uint160(_prevFund)) {
                revert Error.Mandate__FundListNotSorted(_prevFund, _fund);
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

            _logEvent(
                "Mandate",
                abi.encode(
                    _puppetAccount, _actualRelayFee, _fund, _intent.baseToken, _intent.params, _rl.body, _rl.mandate
                )
            );
        }
    }
}
