// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TransientSlot} from "@openzeppelin/contracts/utils/TransientSlot.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {AccountModule} from "./AccountModule.sol";
import {AccountLib, MAX_SESSION_BYTES, MAX_SESSION_TTL, SESSION_REVOKE_DELAY, WALLET_SIGNATURE_TAG} from "../utils/AccountLib.sol";
import {MANDATE_BYTES, MandateLib} from "../utils/MandateLib.sol";
import {CallLib} from "../utils/CallLib.sol";
import {Error} from "../utils/Error.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";


contract UserAccount is IAccount {
    struct State {
        uint epoch;
        uint nonce;
        uint revokedAt;
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

    function revokeSessions() external {
        if (msg.sender != user()) revert Error.Account__UnauthorizedCaller();
        if (TransientSlot.tload(TransientSlot.asBoolean(EXECUTING_SLOT))) revert Error.Account__Executing();
        State storage _s = _state();
        unchecked {
            _s.epoch += 1;
        }
        _s.revokedAt = block.timestamp;
        AccountModule(module()).recordSelf(abi.encode(msg.sig, _s.epoch), new address[](0));
    }

    function approves(
        bytes32 _digest,
        bytes calldata _signature
    ) public view returns (bool) {
        address _user = user();
        if (_signature.length > MAX_SESSION_BYTES) return false;
        if (_signature.length > 32 && bytes32(_signature[:32]) == WALLET_SIGNATURE_TAG) {
            return SignatureCheckerLib.isValidERC1271SignatureNowCalldata(_user, _digest, _signature[32:]);
        }
        if (_signature.length == 65) {
            return ECDSA.tryRecoverCalldata(_digest, _signature) == _user
                || SignatureCheckerLib.isValidERC1271SignatureNowCalldata(_user, _digest, _signature);
        }
        (address _signer, uint _issuedAt, uint _expiry, uint _epoch, address _fund, bytes memory _grant, bytes memory _inner) =
            abi.decode(_signature, (address, uint, uint, uint, address, bytes, bytes));
        if (
            _signer == address(0) || _issuedAt > block.timestamp || block.timestamp > _expiry
                || _expiry > _issuedAt + MAX_SESSION_TTL
        ) {
            return false;
        }
        State storage _s = _state();
        if (
            _epoch != _s.epoch
                && (_epoch + 1 != _s.epoch || block.timestamp >= _s.revokedAt + SESSION_REVOKE_DELAY)
        ) return false;
        bytes32 _grantDigest = AccountLib.sessionDigest(module(), _user, _signer, _issuedAt, _expiry, _epoch, _fund);
        if (
            ECDSA.tryRecover(_grantDigest, _grant) != _user
                && !SignatureCheckerLib.isValidERC1271SignatureNow(_user, _grantDigest, _grant)
        ) return false;
        return ECDSA.tryRecover(_digest, _inner) == _signer;
    }

    function execute(
        address _attestor,
        bytes32 _structHash,
        uint _deadline,
        bytes calldata _coSig,
        IAccount.Call[] calldata _callList
    ) external returns (bytes32 digest_, bytes[] memory resultList_) {
        address _module = module();
        if (msg.sender != _module) revert Error.Account__UnauthorizedCaller();
        if (block.timestamp > _deadline) revert Error.Intent__ExpiredDeadline(_deadline, block.timestamp);
        if (_attestor == address(0)) {
            MandateLib.Mandate memory _mandate = abi.decode(_coSig[:MANDATE_BYTES], (MandateLib.Mandate));
            if (_mandate.expiry <= block.timestamp) revert Error.Mandate__Expired(_mandate.expiry);
            digest_ = MandateLib.digest(address(this), _mandate);
            if (!approves(digest_, _coSig[MANDATE_BYTES:])) revert Error.Account__InvalidSignature();
            if (
                _callList.length != 1 || _callList[0].value != 0
                    || bytes4(_callList[0].callData[:4]) != IERC20.transfer.selector
            ) revert Error.Mandate__ForbiddenCall();
            (address _to,) = abi.decode(_callList[0].callData[4:], (address, uint));
            if (_to != _mandate.master) revert Error.Mandate__ForbiddenCall();
        } else {
            digest_ = AccountLib.intentDigest(address(this), _state().nonce++, _deadline, _structHash);
            CallLib.verifyPair(address(this), _attestor, digest_, _coSig);
        }
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
