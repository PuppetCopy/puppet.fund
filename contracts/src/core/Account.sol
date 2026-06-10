// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {LibClone} from "solady/utils/LibClone.sol";

import {IAccount} from "../utils/interfaces/IAccount.sol";
import {AccountLib} from "../utils/AccountLib.sol";
import {PuppetAccount} from "./PuppetAccount.sol";
import {FundAccount} from "./FundAccount.sol";
import {Attest} from "./Attest.sol";
import {Permission} from "../utils/auth/Permission.sol";
import {Error} from "../utils/Error.sol";
import {NonceLib} from "../utils/NonceLib.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";

bytes32 constant CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH = keccak256(
    "CreatePuppetAccountIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bytes32 tokenId,uint256 initialDepositAmount)AccountInitParams(address user,address signer)"
);

contract Account is Permission {
    struct CreatePuppetAccountIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        bytes32 tokenId;
        uint initialDepositAmount;
    }

    uint internal constant _NONCE_SCOPE = uint32(bytes4(keccak256("PuppetAccount")));

    Attest public immutable attest;
    address public immutable puppetAccountImpl;
    address public immutable fundAccountImpl;
    address public immutable routeImpl;

    constructor(
        IAuthority _authority,
        Attest _attest,
        address _puppetAccountImpl,
        address _fundAccountImpl,
        address _routeImpl
    ) Permission(_authority) {
        if (
            address(_attest) == address(0) || _puppetAccountImpl == address(0) || _fundAccountImpl == address(0)
                || _routeImpl == address(0)
        ) {
            revert Error.Register__InvalidImpl();
        }
        attest = _attest;
        puppetAccountImpl = _puppetAccountImpl;
        fundAccountImpl = _fundAccountImpl;
        routeImpl = _routeImpl;
    }

    function predictPuppetAccount(
        AccountLib.AccountInitParams calldata _params
    ) external view returns (address) {
        return AccountLib.predictAccount(puppetAccountImpl, address(attest), _params);
    }

    function verifyPuppetAccount(
        AccountLib.AccountInitParams calldata _params
    ) external view returns (PuppetAccount) {
        return PuppetAccount(payable(AccountLib.verifyAccount(puppetAccountImpl, address(attest), _params)));
    }

    function predictFundAccount(
        address _signer
    ) external view returns (address) {
        return AccountLib.predictFund(fundAccountImpl, address(attest), _signer);
    }

    function verifyFundAccount(
        address _signer
    ) external view returns (FundAccount) {
        return FundAccount(payable(AccountLib.verifyFund(fundAccountImpl, address(attest), _signer)));
    }

    function predictRoute(
        address _account
    ) external view returns (address) {
        return AccountLib.predictRoute(routeImpl, address(this), _account);
    }

    function isNonceConsumed(
        address _account,
        uint _nonce
    ) external view returns (bool) {
        return NonceLib.isConsumedBy(_NONCE_SCOPE, _nonce, _account);
    }

    function _deployRoute(
        address _account
    ) private returns (address) {
        return LibClone.cloneDeterministic(routeImpl, abi.encodePacked(_account), bytes32(uint(uint160(_account))));
    }

    function createPuppetAccount(
        AccountLib.AccountInitParams calldata _params,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof
    ) external auth returns (PuppetAccount account_, address route_) {
        if (_params.user == address(0)) revert Error.Account__InvalidUser();
        AccountLib.verifyDeployAuth(_params.user, _params.signer, _userDeploySig, _signerProof);
        bytes memory _args = AccountLib.accountArgs(address(attest), _params);
        address _account = LibClone.cloneDeterministic(puppetAccountImpl, _args, keccak256(_args));
        route_ = _deployRoute(_account);
        account_ = PuppetAccount(payable(_account));
        _logEvent("DeployPuppetAccount", abi.encode(_params, _account, route_));
    }

    function createFundAccount(
        address _signer
    ) external auth returns (FundAccount account_, address route_) {
        if (_signer == address(0)) revert Error.Account__InvalidUser();
        bytes memory _args = AccountLib.fundArgs(address(attest), _signer);
        address _account = LibClone.cloneDeterministic(fundAccountImpl, _args, keccak256(_args));
        route_ = _deployRoute(_account);
        account_ = FundAccount(payable(_account));
        _logEvent("DeployFundAccount", abi.encode(_signer, _account, route_));
    }

    function dispatch(
        IAccount _account,
        IAccount.Call[] calldata _callList,
        IAccount.SignTransfer[] calldata _transferList,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _nonce
    )
        external
        payable
        auth
        returns (uint[] memory signedPostBalanceList_, uint[] memory postBalanceList_, bytes[] memory resultList_)
    {
        NonceLib.consumeBy(_NONCE_SCOPE, _nonce, address(_account));

        (signedPostBalanceList_, postBalanceList_, resultList_) = attest.execute{value: msg.value}(
            _account, _callList, _transferList, _digest, _userSignature, _attestorSignature, _attestor
        );

        _logEvent(
            "AccountCall",
            abi.encode(
                block.chainid, address(_account), _nonce, _transferList, signedPostBalanceList_, postBalanceList_
            )
        );
    }

    function dispatchMandate(
        IAccount _puppet,
        bytes32 _mandateDigest,
        bytes calldata _mandate,
        IAccount.Call[] calldata _callList,
        IAccount.SignTransfer[] calldata _transferList
    )
        external
        auth
        returns (uint[] memory signedPostBalanceList_, uint[] memory postBalanceList_, bytes[] memory resultList_)
    {
        (
            signedPostBalanceList_, postBalanceList_, resultList_
        ) = attest.executeMandate(_puppet, _callList, _transferList, _mandateDigest, _mandate);
        _logEvent(
            "MandateCall",
            abi.encode(
                block.chainid, address(_puppet), _mandateDigest, _transferList, signedPostBalanceList_, postBalanceList_
            )
        );
    }
}
