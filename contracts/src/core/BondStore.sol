// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Access} from "../utils/auth/Access.sol";
import {Error} from "../utils/Error.sol";
import {TransferUtils} from "../utils/TransferUtils.sol";

contract BondStore is Access {
    mapping(address account => mapping(address token => uint amount)) public bondMap;
    mapping(address puppet => mapping(address master => bytes32 digest)) public mandateMap;
    mapping(address master => mapping(uint spokeChainId => mapping(uint cycle => bool))) public drawnMap;

    constructor(
        address _authority
    ) Access(_authority) {}

    function addBond(
        address _account,
        address _token,
        uint _amount
    ) external auth {
        bondMap[_account][_token] += _amount;
    }

    function payBond(
        address _account,
        address _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) external auth {
        bondMap[_account][_token] -= _amount;
        TransferUtils.transferStrictly(_token, _to, _amount, _gasLimit);
    }

    function markDrawn(
        address _master,
        uint _spokeChainId,
        uint _cycle
    ) external auth {
        if (drawnMap[_master][_spokeChainId][_cycle]) {
            revert Error.Bond__CycleAlreadyDrawn(_master, _spokeChainId, _cycle);
        }
        drawnMap[_master][_spokeChainId][_cycle] = true;
    }

    function setMandate(
        address _puppet,
        address _master,
        bytes32 _digest
    ) external auth {
        mandateMap[_puppet][_master] = _digest;
    }

    receive() external payable {}
}
