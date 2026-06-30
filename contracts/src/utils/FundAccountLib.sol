// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {LibClone} from "solady/utils/LibClone.sol";

import {Error} from "./Error.sol";

bytes32 constant FUND_ACCOUNT_INIT_TYPEHASH =
    keccak256("FundAccountInitParams(address master,address baseToken,bytes32 name)");

library FundAccountLib {
    struct FundAccountInitParams {
        address master;
        address baseToken;
        bytes32 name;
    }

    function hashFundAccount(
        FundAccountInitParams calldata _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(FUND_ACCOUNT_INIT_TYPEHASH, _p.master, _p.baseToken, _p.name));
    }

    function fundArgs(
        address _attest,
        FundAccountInitParams calldata _p
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(_attest, _p.master, _p.baseToken, _p.name);
    }

    function predictFund(
        address _impl,
        address _attest,
        FundAccountInitParams calldata _p
    ) internal view returns (address) {
        bytes memory _args = fundArgs(_attest, _p);
        return LibClone.predictDeterministicAddress(_impl, _args, keccak256(_args), address(this));
    }

    function verifyFund(
        address _impl,
        address _attest,
        FundAccountInitParams calldata _p
    ) internal view returns (address) {
        address _predicted = predictFund(_impl, _attest, _p);
        if (_predicted.code.length == 0) revert Error.Account__NotDeployed(_predicted);
        return _predicted;
    }
}
