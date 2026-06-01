// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {LibClone} from "solady/utils/LibClone.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {TransientRoute} from "./TransientRoute.sol";
import {Error} from "../utils/Error.sol";

bytes32 constant ACCOUNT_TYPEHASH =
    keccak256("AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)");

string constant DEPLOY_AUTH_MESSAGE = "Puppet: Authorize session key";

library AccountLib {
    struct AccountInitParams {
        address user;
        bytes32 name;
        bytes32 baseTokenId;
        address signer;
    }

    function hashAccount(
        AccountInitParams calldata _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(ACCOUNT_TYPEHASH, _p.user, _p.name, _p.baseTokenId, _p.signer));
    }

    function predict(
        address _impl,
        address _attest,
        AccountInitParams calldata _params
    ) internal view returns (address) {
        bytes memory _args =
            abi.encodePacked(_attest, _params.signer, _params.user, _params.name, _params.baseTokenId);
        return LibClone.predictDeterministicAddress(_impl, _args, keccak256(_args), address(this));
    }

    function verify(
        address _impl,
        address _attest,
        AccountInitParams calldata _params
    ) internal view returns (address) {
        address _predicted = predict(_impl, _attest, _params);
        if (_predicted.code.length == 0) revert Error.Account__NotDeployed(_predicted);
        return _predicted;
    }

    function verifyDeployAuth(
        address _user,
        address _signer,
        bytes calldata _sig,
        bytes calldata _signerProof
    ) internal view {
        bytes32 _bindDigest = SignatureCheckerLib.toEthSignedMessageHash(bytes(DEPLOY_AUTH_MESSAGE));
        if (!SignatureCheckerLib.isValidSignatureNow(_user, _bindDigest, _sig)) {
            revert Error.Account__UnauthorizedDeploy();
        }

        if (_signer != address(0)) {
            if (!SignatureCheckerLib.isValidSignatureNow(_signer, keccak256(abi.encode(_user)), _signerProof)) {
                revert Error.Account__UnauthorizedDeploy();
            }
        }
    }

    function create(
        address _impl,
        address _transientRouteImpl,
        address _attest,
        AccountInitParams calldata _params,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof
    ) internal returns (address _account, address _transientRoute) {
        if (_params.user == address(0)) revert Error.Account__InvalidUser();
        if (_params.baseTokenId == bytes32(0)) revert Error.Account__InvalidBaseTokenId();
        verifyDeployAuth(_params.user, _params.signer, _userDeploySig, _signerProof);
        bytes memory _args =
            abi.encodePacked(_attest, _params.signer, _params.user, _params.name, _params.baseTokenId);
        _account = LibClone.cloneDeterministic(_impl, _args, keccak256(_args));
        _transientRoute = LibClone.cloneDeterministic(
            _transientRouteImpl, abi.encodePacked(_account), bytes32(uint(uint160(_account)))
        );
    }

    function predictTransientRoute(
        address _impl,
        address _factory,
        address _account
    ) internal pure returns (address) {
        bytes memory _args = abi.encodePacked(_account);
        return LibClone.predictDeterministicAddress(_impl, _args, bytes32(uint(uint160(_account))), _factory);
    }
}
