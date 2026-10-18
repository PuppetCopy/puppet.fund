// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {ERC20} from "solady/tokens/ERC20.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {LibString} from "solady/utils/LibString.sol";

import {Error} from "../utils/Error.sol";

uint constant GRID_SIDE = 13;
uint constant PALETTE_BYTES = 39;
uint constant GRID_BYTES = PALETTE_BYTES + GRID_SIDE * GRID_SIDE;

contract ShareToken is ERC20 {
    address public burner;
    uint public pendingBurn;

    function tokenURI() external view returns (string memory) {
        string memory _symbol = symbol();
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(
                bytes(
                    string.concat(
                        '{"interop":{"erc1046":true},"name":"',
                        _symbol,
                        '","symbol":"',
                        _symbol,
                        '","decimals":',
                        LibString.toString(decimals()),
                        ',"image":"data:image/svg+xml;base64,',
                        Base64.encode(bytes(_svg())),
                        '"}'
                    )
                )
            )
        );
    }

    function master() public view returns (address) {
        return address(bytes20(LibClone.argsOnClone(address(this), 0, 20)));
    }

    function pixels() public view returns (bytes memory) {
        return LibClone.argsOnClone(address(this), 52, 52 + GRID_BYTES);
    }

    function performanceFee() public view returns (uint) {
        return uint16(bytes2(LibClone.argsOnClone(address(this), 52 + GRID_BYTES, 54 + GRID_BYTES)));
    }

    function _svg() internal view returns (string memory svg_) {
        bytes memory _pixels = pixels();
        string memory _side = LibString.toString(GRID_SIDE);
        string memory _size = LibString.toString(GRID_SIDE * 24);
        svg_ = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ',
            _side,
            " ",
            _side,
            '" shape-rendering="crispEdges" width="',
            _size,
            '" height="',
            _size,
            '">'
        );
        for (uint _i; _i < GRID_SIDE * GRID_SIDE; ++_i) {
            uint _at = uint(uint8(_pixels[PALETTE_BYTES + _i])) * 3;
            uint _rgb = (uint(uint8(_pixels[_at])) << 16) | (uint(uint8(_pixels[_at + 1])) << 8)
                | uint(uint8(_pixels[_at + 2]));
            svg_ = string.concat(
                svg_,
                '<rect x="',
                LibString.toString(_i % GRID_SIDE),
                '" y="',
                LibString.toString(_i / GRID_SIDE),
                '" width="1" height="1" fill="#',
                LibString.toHexStringNoPrefix(_rgb, 3),
                '"/>'
            );
        }
        svg_ = string.concat(svg_, "</svg>");
    }

    function symbol() public view override returns (string memory symbol_) {
        bytes32 _word = bytes32(LibClone.argsOnClone(address(this), 20, 52));
        uint _len;
        while (_len < 32 && _word[_len] != 0) {
            ++_len;
        }
        symbol_ = new string(_len);
        assembly ("memory-safe") {
            mstore(add(symbol_, 0x20), _word)
        }
    }

    function name() public view override returns (string memory) {
        return symbol();
    }

    function mint(
        address _to,
        uint _amount
    ) external {
        if (msg.sender != master()) revert Error.ShareToken__Forbidden();
        _mint(_to, _amount);
    }

    function allowBurn(
        address _spender,
        uint _amount
    ) external {
        if (msg.sender != master()) revert Error.ShareToken__Forbidden();
        burner = _spender;
        pendingBurn = _amount;
    }

    function burn(
        address _from,
        uint _amount
    ) external {
        if (msg.sender != _from || msg.sender != master()) {
            if (msg.sender != burner || _amount > pendingBurn) revert Error.ShareToken__Forbidden();
            pendingBurn -= _amount;
        }
        _burn(_from, _amount);
    }

    function transfer(
        address,
        uint
    ) public pure override returns (bool) {
        revert Error.ShareToken__Forbidden();
    }

    function approve(
        address,
        uint
    ) public pure override returns (bool) {
        revert Error.ShareToken__Forbidden();
    }

    function permit(
        address,
        address,
        uint,
        uint,
        uint8,
        bytes32,
        bytes32
    ) public pure override {
        revert Error.ShareToken__Forbidden();
    }

    function _givePermit2InfiniteAllowance() internal pure override returns (bool) {
        return false;
    }

    function transferFrom(
        address,
        address,
        uint
    ) public pure override returns (bool) {
        revert Error.ShareToken__Forbidden();
    }
}
