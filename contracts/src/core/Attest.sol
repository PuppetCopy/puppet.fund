// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAccount} from "./interface/IAccount.sol";
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
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        IERC20 _baseToken,
        uint _amountIn,
        uint _amountOut,
        uint _relayFee,
        address _feeReceiver,
        uint _transferGasLimit
    ) external payable auth returns (uint signedPostBalance_, uint postBalance_, bytes[] memory results_) {
        IntentLib.verifySignature(_account, _digest, _userSignature);
        IntentLib.verifyAttestor(_attestor, _digest, _attestorSignature);
        (signedPostBalance_, postBalance_, results_) = _account.execute{value: msg.value}(
            _callList, _baseToken, _amountIn, _amountOut, _relayFee, _feeReceiver, _transferGasLimit
        );
    }

    function executeMandate(
        IAccount _puppet,
        IAccount.Call[] calldata _callList,
        bytes32 _mandateDigest,
        bytes calldata _mandate,
        IERC20 _baseToken,
        uint _amountOut,
        uint _transferGasLimit
    ) external auth returns (uint signedPostBalance_, uint postBalance_, bytes[] memory results_) {
        IntentLib.verifySignature(_puppet, _mandateDigest, _mandate);
        (signedPostBalance_, postBalance_, results_) =
            _puppet.execute(_callList, _baseToken, 0, _amountOut, 0, address(0), _transferGasLimit);
    }
}
