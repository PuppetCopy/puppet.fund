// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {LibClone} from "solady/utils/LibClone.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {Error} from "../utils/Error.sol";

bytes32 constant ACCOUNT_TYPEHASH = keccak256("AccountInitParams(address user,address signer)");

string constant DEPLOY_AUTH_MESSAGE = "Puppet: Authorize session key";

library AccountLib {
    struct AccountInitParams {
        address user;
        address signer;
    }

    function hashAccount(
        AccountInitParams calldata _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(ACCOUNT_TYPEHASH, _p.user, _p.signer));
    }

    function accountArgs(
        address _attest,
        AccountInitParams calldata _p
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(_attest, _p.signer, _p.user);
    }

    function predictAccount(
        address _impl,
        address _attest,
        AccountInitParams calldata _params
    ) internal view returns (address) {
        bytes memory _args = accountArgs(_attest, _params);
        return LibClone.predictDeterministicAddress(_impl, _args, keccak256(_args), address(this));
    }

    function verifyAccount(
        address _impl,
        address _attest,
        AccountInitParams calldata _params
    ) internal view returns (address) {
        address _predicted = predictAccount(_impl, _attest, _params);
        if (_predicted.code.length == 0) revert Error.Account__NotDeployed(_predicted);
        return _predicted;
    }

    function fundArgs(
        address _attest,
        address _signer
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(_attest, _signer);
    }

    function predictFund(
        address _impl,
        address _attest,
        address _signer
    ) internal view returns (address) {
        bytes memory _args = fundArgs(_attest, _signer);
        return LibClone.predictDeterministicAddress(_impl, _args, keccak256(_args), address(this));
    }

    function verifyFund(
        address _impl,
        address _attest,
        address _signer
    ) internal view returns (address) {
        address _predicted = predictFund(_impl, _attest, _signer);
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

    function predictRoute(
        address _impl,
        address _factory,
        address _account
    ) internal pure returns (address) {
        return LibClone.predictDeterministicAddress(
            _impl, abi.encodePacked(_account), bytes32(uint(uint160(_account))), _factory
        );
    }
}
