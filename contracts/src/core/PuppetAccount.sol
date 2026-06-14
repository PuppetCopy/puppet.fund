// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {Error} from "../utils/Error.sol";
import {BaseAccount} from "./BaseAccount.sol";

contract PuppetAccount is BaseAccount {
    function getUser() public view returns (address _user) {
        bytes memory _b = LibClone.argsOnClone(address(this), 40, 60);
        assembly ("memory-safe") {
            _user := shr(96, mload(add(_b, 0x20)))
        }
    }

    function isValidSignature(
        bytes32 _digest,
        bytes calldata _signature
    ) public view returns (bytes4) {
        address _signer = getSigner();
        if (_signer != address(0)) {
            if (SignatureCheckerLib.isValidSignatureNow(_signer, _digest, _signature)) {
                return IERC1271.isValidSignature.selector;
            }
        }
        if (SignatureCheckerLib.isValidSignatureNow(getUser(), _digest, _signature)) {
            return IERC1271.isValidSignature.selector;
        }
        revert Error.Account__InvalidSignature();
    }
}
