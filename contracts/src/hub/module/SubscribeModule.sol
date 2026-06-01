// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAccount} from "../../core/interface/IAccount.sol";
import {PuppetAccount} from "../../core/PuppetAccount.sol";
import {AccountLib} from "../../core/AccountLib.sol";
import {AccountModule} from "../../core/module/AccountModule.sol";
import {AllocateStore} from "../AllocateStore.sol";
import {RuleLib} from "../RuleLib.sol";
import {Access} from "../../utils/auth/Access.sol";
import {Error} from "../../utils/Error.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";
import {IntentLib} from "../../utils/IntentLib.sol";

bytes32 constant SUBSCRIBE_INTENT_TYPEHASH = keccak256(
    "SubscribeIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,address baseToken,SubscribeRule[] rules)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)SubscribeRule(AccountInitParams masterParams,bytes body,bytes mandate)"
);

contract SubscribeModule is Access {
    struct SubscribeIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        IERC20 baseToken;
        RuleLib.Rule[] rules;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function subscribe(
        SubscribeIntent calldata _intent,
        AccountModule _accountGate,
        AllocateStore _store,
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
            _puppetAccount,
            new IAccount.Call[](0),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce,
            _intent.baseToken,
            0,
            0,
            _actualRelayFee,
            _feeReceiver,
            _transferGasLimit
        );

        address _prevMasterAddr;
        for (uint _i; _i < _n; ++_i) {
            RuleLib.Rule calldata _rl = _intent.rules[_i];
            if (_intent.params.baseTokenId != _rl.masterParams.baseTokenId) {
                revert Error.Subscribe__BaseTokenMismatch(_intent.params.baseTokenId, _rl.masterParams.baseTokenId);
            }
            if (_intent.params.user == _rl.masterParams.user) {
                revert Error.Subscribe__SelfSubscribe(_intent.params.user);
            }
            address _masterAddr = _accountGate.predictMasterAccount(_rl.masterParams);
            if (_i > 0 && uint160(_masterAddr) <= uint160(_prevMasterAddr)) {
                revert Error.Subscribe__MasterListNotSorted(_prevMasterAddr, _masterAddr);
            }
            _prevMasterAddr = _masterAddr;

            if (_rl.body.length == 0) {
                _store.setMandate(address(_puppetAccount), _masterAddr, bytes32(0));
            } else {
                (bytes32 _bodyHash, bytes32 _mandateDigest) = RuleLib.mandate(
                    _routerDomainSeparator, address(_puppetAccount), _masterAddr, _intent.baseToken, _rl.body
                );
                IntentLib.verifySignature(_puppetAccount, _mandateDigest, _rl.mandate);
                _store.setMandate(address(_puppetAccount), _masterAddr, _bodyHash);
            }

            _logEvent(
                "Subscribe",
                abi.encode(
                    _puppetAccount,
                    _masterAddr,
                    _intent.params,
                    _rl.masterParams,
                    _intent.baseToken,
                    _rl.body,
                    _rl.mandate
                )
            );
        }
    }
}
