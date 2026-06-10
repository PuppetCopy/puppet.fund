// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Access} from "../../utils/auth/Access.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";

contract AllocateStore is Access {
    struct PuppetState {
        bytes32 mandate;
        uint lastAllocatedAt;
    }

    mapping(address puppet => mapping(address fund => bytes32 bodyHash)) public mandateMap;
    mapping(address puppet => mapping(address fund => uint)) public lastAllocatedAtMap;

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function getPuppetStateList(
        address[] calldata _puppetList,
        address _fund
    ) external view returns (PuppetState[] memory _stateList) {
        _stateList = new PuppetState[](_puppetList.length);
        for (uint _i; _i < _puppetList.length; ++_i) {
            address _puppet = _puppetList[_i];
            _stateList[_i] =
                PuppetState({mandate: mandateMap[_puppet][_fund], lastAllocatedAt: lastAllocatedAtMap[_puppet][_fund]});
        }
    }

    function setMandate(
        address _puppet,
        address _fund,
        bytes32 _bodyHash
    ) external auth {
        mandateMap[_puppet][_fund] = _bodyHash;
        if (lastAllocatedAtMap[_puppet][_fund] == 0) lastAllocatedAtMap[_puppet][_fund] = 1;
    }

    function setLastAllocatedAtMany(
        address[] calldata _puppetList,
        uint[] calldata _sharesMintedList,
        address _fund,
        uint _ts
    ) external auth {
        for (uint _i; _i < _puppetList.length; ++_i) {
            if (_sharesMintedList[_i] != 0) lastAllocatedAtMap[_puppetList[_i]][_fund] = _ts;
        }
    }
}
