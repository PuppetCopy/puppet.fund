// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

library SlotLib {
    function readBytes32(
        bytes calldata _data,
        uint _slot
    ) internal pure returns (bytes32) {
        uint _end = (_slot + 1) * 32;
        return _data.length < _end ? bytes32(0) : bytes32(_data[_end - 32:_end]);
    }

    function readUint(
        bytes calldata _data,
        uint _slot
    ) internal pure returns (uint) {
        return uint(readBytes32(_data, _slot));
    }

    function readInt(
        bytes calldata _data,
        uint _slot
    ) internal pure returns (int) {
        return int(uint(readBytes32(_data, _slot)));
    }

    function readAddress(
        bytes calldata _data,
        uint _slot
    ) internal pure returns (address) {
        return address(uint160(uint(readBytes32(_data, _slot))));
    }

    function readBool(
        bytes calldata _data,
        uint _slot
    ) internal pure returns (bool) {
        return readBytes32(_data, _slot) != bytes32(0);
    }
}
