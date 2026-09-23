// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {TransientSlot} from "@openzeppelin/contracts/utils/TransientSlot.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {AccountModule} from "./AccountModule.sol";
import {AccountLib, MAX_SESSION_TTL} from "../utils/AccountLib.sol";
import {CallLib} from "../utils/CallLib.sol";
import {Error} from "../utils/Error.sol";
import {TransferUtils} from "../utils/TransferUtils.sol";
import {BalanceLib} from "../utils/BalanceLib.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";

contract UserAccount is IAccount {
    struct State {
        uint epoch;
        uint nonce;
        uint withdrawRequestedAt;
    }

    bytes32 internal immutable SLOT;
    bytes32 private constant EXECUTING_SLOT = keccak256("puppet.user.executing");

    constructor() {
        SLOT = keccak256(abi.encode("puppet.user", address(this)));
    }

    function module() public view returns (address module_) {
        bytes memory _args = LibClone.argsOnClone(address(this), 0, 20);
        assembly ("memory-safe") {
            module_ := shr(96, mload(add(_args, 0x20)))
        }
    }

    function user() public view returns (address user_) {
        bytes memory _args = LibClone.argsOnClone(address(this), 20, 40);
        assembly ("memory-safe") {
            user_ := shr(96, mload(add(_args, 0x20)))
        }
    }

    function nonce() public view returns (uint) {
        return _state().nonce;
    }

    function epoch() public view returns (uint) {
        return _state().epoch;
    }

    function withdrawRequestedAt() public view returns (uint) {
        return _state().withdrawRequestedAt;
    }

    function revokeSessions() external {
        if (msg.sender != user()) revert Error.Account__UnauthorizedCaller();
        if (TransientSlot.tload(TransientSlot.asBoolean(EXECUTING_SLOT))) revert Error.Account__Executing();
        State storage _s = _state();
        unchecked {
            _s.epoch += 1;
        }
        AccountModule(module()).recordSelf(abi.encode(msg.sig, _s.epoch), new address[](0));
    }

    function requestWithdraw() external {
        if (msg.sender != user()) revert Error.Account__UnauthorizedCaller();
        if (TransientSlot.tload(TransientSlot.asBoolean(EXECUTING_SLOT))) revert Error.Account__Executing();
        uint _requestedAt = block.timestamp;
        _state().withdrawRequestedAt = _requestedAt;
        AccountModule(module()).recordSelf(abi.encode(msg.sig, _requestedAt), new address[](0));
    }

    function withdraw(
        address _token,
        uint _amount,
        uint _gasLimit
    ) external {
        address _user = user();
        if (msg.sender != _user) revert Error.Account__UnauthorizedCaller();
        if (TransientSlot.tload(TransientSlot.asBoolean(EXECUTING_SLOT))) revert Error.Account__Executing();
        AccountModule _module = AccountModule(module());
        uint _delay = _module.withdrawDelay();
        if (_delay > 0) {
            State storage _s = _state();
            uint _requestedAt = _s.withdrawRequestedAt;
            if (_requestedAt == 0 || block.timestamp < _requestedAt + _delay) {
                revert Error.Account__WithdrawNotOpen(_requestedAt, _delay);
            }
            _s.withdrawRequestedAt = 0;
        }
        TransferUtils.transferStrictly(_token, _user, _amount, _gasLimit);
        _module.recordSelf(abi.encode(msg.sig, _token, _amount), BalanceLib.list(_token));
    }

    function approves(
        bytes32 _digest,
        bytes calldata _signature
    ) public view returns (bool) {
        address _user = user();
        if (_signature.length == 65) {
            return ECDSA.tryRecoverCalldata(_digest, _signature) == _user
                || SignatureCheckerLib.isValidERC1271SignatureNowCalldata(_user, _digest, _signature);
        }
        (address _signer, uint _issuedAt, uint _expiry, bytes memory _grant, bytes memory _inner) =
            abi.decode(_signature, (address, uint, uint, bytes, bytes));
        if (_issuedAt > block.timestamp || block.timestamp > _expiry || _expiry > _issuedAt + MAX_SESSION_TTL) {
            return false;
        }
        bytes32 _grantDigest = AccountLib.sessionDigest(module(), _user, _signer, _issuedAt, _expiry, _state().epoch);
        if (
            ECDSA.tryRecover(_grantDigest, _grant) != _user
                && !SignatureCheckerLib.isValidERC1271SignatureNow(_user, _grantDigest, _grant)
        ) return false;
        return ECDSA.tryRecover(_digest, _inner) == _signer;
    }

    function execute(
        address _attestor,
        bytes32 _structHash,
        bytes calldata _coSig,
        IAccount.Call[] calldata _callList
    ) external returns (bytes32 digest_, bytes[] memory resultList_) {
        address _module = module();
        if (msg.sender != _module) revert Error.Account__UnauthorizedCaller();
        State storage _s = _state();
        digest_ = AccountLib.intentDigest(address(this), _s.nonce++, _structHash);
        CallLib.verifyPair(address(this), _attestor, digest_, _coSig);
        TransientSlot.tstore(TransientSlot.asBoolean(EXECUTING_SLOT), true);
        resultList_ = CallLib.run(_callList, _module);
        TransientSlot.tstore(TransientSlot.asBoolean(EXECUTING_SLOT), false);
    }

    function _state() internal view returns (State storage s_) {
        bytes32 _slot = SLOT;
        assembly ("memory-safe") {
            s_.slot := _slot
        }
    }

    receive() external payable {}
}
