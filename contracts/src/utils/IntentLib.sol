// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {AccountModule} from "../core/module/AccountModule.sol";
import {AccountLib} from "../core/AccountLib.sol";
import {Error} from "./Error.sol";
import {RegisterModule} from "../core/module/RegisterModule.sol";

library IntentLib {
    uint internal constant BASIS_POINTS = 10_000;

    function verifySignature(
        IERC1271 _verifier,
        bytes32 _digest,
        bytes calldata _signature
    ) internal view {
        if (_verifier.isValidSignature(_digest, _signature) != IERC1271.isValidSignature.selector) {
            revert Error.Account__InvalidSignature();
        }
    }

    function verifyAttestor(
        address _attestor,
        bytes32 _digest,
        bytes calldata _signature
    ) internal view {
        if (!SignatureCheckerLib.isValidSignatureNowCalldata(_attestor, _digest, _signature)) {
            revert Error.Account__InvalidSignature();
        }
    }

    function verifyChainId(
        uint _intentChainId
    ) internal view {
        if (_intentChainId != block.chainid) {
            revert Error.Intent__InvalidChainId(_intentChainId, block.chainid);
        }
    }

    function verifyTimeBounds(
        uint _blockNumber,
        uint _deadline,
        uint _currentBlock,
        uint _maxBlockDelay
    ) internal view {
        if (block.timestamp > _deadline) {
            revert Error.Intent__ExpiredDeadline(_deadline, block.timestamp);
        }
        if (_blockNumber > _currentBlock) {
            revert Error.Intent__StaleSignature(_blockNumber, _currentBlock, 0);
        }
        if (_currentBlock > _blockNumber + _maxBlockDelay) {
            revert Error.Intent__StaleSignature(_blockNumber, _currentBlock, _maxBlockDelay);
        }
    }

    function verifyTokenAndCap(
        RegisterModule _register,
        bytes32 _baseTokenId,
        address _token,
        uint _amount
    ) internal view returns (IERC20) {
        RegisterModule.TokenInfo memory _info = _register.getTokenInfo(_baseTokenId);
        if (address(_info.token) == address(0)) {
            revert Error.Intent__TokenNotRegistered(_baseTokenId);
        }
        if (_token != address(0) && address(_info.token) != _token) {
            revert Error.Intent__TokenMismatch(_baseTokenId, address(_info.token), _token);
        }
        if (_info.cap > 0 && _amount > _info.cap) {
            revert Error.Intent__AmountExceedsCap(_amount, _info.cap);
        }
        return _info.token;
    }

    function verifyRelayFee(
        uint _actualRelayFee,
        uint _acceptableRelayFee
    ) internal pure {
        if (_actualRelayFee > _acceptableRelayFee) {
            revert Error.Intent__RelayFeeExceedsCap(_actualRelayFee, _acceptableRelayFee);
        }
    }

    function verifyRelayFeeRatio(
        uint _relayFee,
        uint _extractable,
        uint _maxRelayFeeBps
    ) internal pure {
        if (_relayFee * BASIS_POINTS > _extractable * _maxRelayFeeBps) {
            revert Error.Intent__RelayFeeRatioExceeded(_relayFee, _extractable, _maxRelayFeeBps);
        }
    }
}
