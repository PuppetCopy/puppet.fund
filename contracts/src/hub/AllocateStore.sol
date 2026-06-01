// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Access} from "../utils/auth/Access.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";

contract AllocateStore is Access {
    struct PuppetState {
        bytes32 mandate;
        uint lastAllocatedAt;
    }

    mapping(address puppet => mapping(address master => bytes32 bodyHash)) public mandateMap;
    mapping(address puppet => mapping(address master => uint)) public lastAllocatedAtMap;
    mapping(address master => bool) public seeded;

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function setSeeded(
        address _master
    ) external auth {
        seeded[_master] = true;
    }

    function getPuppetStateList(
        address[] calldata _puppetList,
        address _master
    ) external view returns (PuppetState[] memory _stateList) {
        _stateList = new PuppetState[](_puppetList.length);
        for (uint _i; _i < _puppetList.length; ++_i) {
            address _puppet = _puppetList[_i];
            _stateList[_i] =
                PuppetState({mandate: mandateMap[_puppet][_master], lastAllocatedAt: lastAllocatedAtMap[_puppet][_master]});
        }
    }

    function setMandate(
        address _puppet,
        address _master,
        bytes32 _bodyHash
    ) external auth {
        mandateMap[_puppet][_master] = _bodyHash;
        if (lastAllocatedAtMap[_puppet][_master] == 0) lastAllocatedAtMap[_puppet][_master] = 1;
    }

    function setLastAllocatedAtMany(
        address[] calldata _puppetList,
        uint[] calldata _sharesMintedList,
        address _master,
        uint _ts
    ) external auth {
        for (uint _i; _i < _puppetList.length; ++_i) {
            if (_sharesMintedList[_i] != 0) lastAllocatedAtMap[_puppetList[_i]][_master] = _ts;
        }
    }
}
