// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";

import {AccountLib} from "../utils/AccountLib.sol";
import {CallLib} from "../utils/CallLib.sol";
import {Error} from "../utils/Error.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";

contract FundAccount is IAccount, IERC1271 {
    struct Bound {
        address module;
        address parent;
        uint nonce;
    }

    bytes32 internal immutable SLOT;

    constructor() {
        SLOT = keccak256(abi.encode("puppet.fund", address(this)));
    }

    function parent() public view returns (address) {
        return _bound().parent;
    }

    function bound() public view returns (address, address) {
        Bound storage _b = _bound();
        return (_b.module, _b.parent);
    }

    function user() public view returns (address) {
        return IAccount(_bound().parent).user();
    }

    function nonce() public view returns (uint) {
        return _bound().nonce;
    }

    function genesis(
        address _parent,
        bytes calldata _keySignature
    ) external returns (bytes32 digest_) {
        Bound storage _b = _bound();
        if (_b.module != address(0)) revert Error.Account__AlreadyCreated();
        if (_parent == address(0)) revert Error.Account__InvalidUser();
        digest_ = AccountLib.genesisDigest(msg.sender, address(this), _parent);
        if (ECDSA.tryRecoverCalldata(digest_, _keySignature) != address(this)) {
            revert Error.Account__InvalidSignature();
        }
        _b.module = msg.sender;
        _b.parent = _parent;
    }

    function isValidSignature(
        bytes32 _digest,
        bytes calldata _signature
    ) public view returns (bytes4) {
        return ECDSA.tryRecoverCalldata(_digest, _signature) == address(this)
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }

    function execute(
        address _attestor,
        bytes32 _structHash,
        uint _deadline,
        bytes calldata _coSig,
        IAccount.Call[] calldata _callList
    ) external returns (bytes32 digest_, bytes[] memory resultList_) {
        Bound storage _b = _bound();
        if (msg.sender != _b.module) revert Error.Account__UnauthorizedCaller();
        if (block.timestamp > _deadline) revert Error.Intent__ExpiredDeadline(_deadline, block.timestamp);
        digest_ = AccountLib.intentDigest(address(this), _b.nonce++, _deadline, _structHash);
        CallLib.verifyPair(_b.parent, _attestor, digest_, _coSig);
        resultList_ = CallLib.run(_callList, _b.module);
    }

    function _bound() internal view returns (Bound storage b_) {
        bytes32 _slot = SLOT;
        assembly ("memory-safe") {
            b_.slot := _slot
        }
    }

    receive() external payable {}
}
