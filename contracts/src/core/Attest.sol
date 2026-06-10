// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IAccount} from "../utils/interfaces/IAccount.sol";
import {IntentLib} from "../utils/IntentLib.sol";
import {Access} from "../utils/auth/Access.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";

contract Attest is Access {
    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function execute(
        IAccount _account,
        IAccount.Call[] calldata _callList,
        IAccount.SignTransfer[] calldata _transferList,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor
    )
        external
        payable
        auth
        returns (uint[] memory signedPostBalanceList_, uint[] memory postBalanceList_, bytes[] memory resultList_)
    {
        IntentLib.verifySignature(_account, _digest, _userSignature);
        IntentLib.verifyAttestor(_attestor, _digest, _attestorSignature);
        (signedPostBalanceList_, postBalanceList_, resultList_) =
            _account.execute{value: msg.value}(_callList, _transferList);
    }

    function executeMandate(
        IAccount _puppet,
        IAccount.Call[] calldata _callList,
        IAccount.SignTransfer[] calldata _transferList,
        bytes32 _mandateDigest,
        bytes calldata _mandate
    )
        external
        auth
        returns (uint[] memory signedPostBalanceList_, uint[] memory postBalanceList_, bytes[] memory resultList_)
    {
        IntentLib.verifySignature(_puppet, _mandateDigest, _mandate);
        (signedPostBalanceList_, postBalanceList_, resultList_) = _puppet.execute(_callList, _transferList);
    }
}
