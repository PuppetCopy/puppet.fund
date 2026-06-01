// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {Error} from "../utils/Error.sol";
import {TransferUtils} from "../utils/TransferUtils.sol";
import {IAccount} from "./interface/IAccount.sol";

abstract contract AccountBase is IAccount, IERC165 {
    uint public signedBalance;

    function getAttest() public view returns (address _attest) {
        bytes memory _b = LibClone.argsOnClone(address(this), 0, 20);
        assembly ("memory-safe") {
            _attest := shr(96, mload(add(_b, 0x20)))
        }
    }

    function getSigner() public view returns (address _signer) {
        bytes memory _b = LibClone.argsOnClone(address(this), 20, 40);
        assembly ("memory-safe") {
            _signer := shr(96, mload(add(_b, 0x20)))
        }
    }

    function getUser() public view returns (address _user) {
        bytes memory _b = LibClone.argsOnClone(address(this), 40, 60);
        assembly ("memory-safe") {
            _user := shr(96, mload(add(_b, 0x20)))
        }
    }

    function getName() public view returns (bytes32 _name) {
        bytes memory _b = LibClone.argsOnClone(address(this), 60, 92);
        assembly ("memory-safe") {
            _name := mload(add(_b, 0x20))
        }
    }

    function getBaseTokenId() public view returns (bytes32 _id) {
        bytes memory _b = LibClone.argsOnClone(address(this), 92, 124);
        assembly ("memory-safe") {
            _id := mload(add(_b, 0x20))
        }
    }

    function isValidSignature(
        bytes32 _digest,
        bytes calldata _signature
    ) public view returns (bytes4) {
        address _signer = getSigner();
        if (_signer != address(0)) {
            if (SignatureCheckerLib.isValidSignatureNow(_signer, _digest, _signature)) {
                return IERC1271.isValidSignature.selector;
            }
        }
        if (SignatureCheckerLib.isValidSignatureNow(getUser(), _digest, _signature)) {
            return IERC1271.isValidSignature.selector;
        }
        revert Error.Account__InvalidSignature();
    }

    function supportsInterface(
        bytes4 _id
    ) public view virtual returns (bool) {
        return
            _id == type(IAccount).interfaceId || _id == type(IERC1271).interfaceId || _id == type(IERC165).interfaceId;
    }

    function execute(
        Call[] calldata _callList,
        IERC20 _baseToken,
        uint _amountIn,
        uint _amountOut,
        uint _relayFee,
        address _feeReceiver,
        uint _transferGasLimit
    ) external payable returns (uint _signedPostBalance, uint _postBalance, bytes[] memory _returnData) {
        if (msg.sender != getAttest()) revert Error.Account__UnauthorizedCaller();

        uint _signedPre = signedBalance;
        uint _len = _callList.length;

        _returnData = new bytes[](_len);
        for (uint _i; _i < _len; ++_i) {
            Call calldata _exec = _callList[_i];
            if (_exec.target == address(this) || _exec.target == getAttest()) {
                revert Error.Account__ForbiddenTarget(_exec.target);
            }
            (bool _ok, bytes memory _result) = _exec.gasLimit > 0
                ? _exec.target.call{value: _exec.value, gas: _exec.gasLimit}(_exec.callData)
                : _exec.target.call{value: _exec.value}(_exec.callData);
            if (!_ok) {
                assembly ("memory-safe") {
                    revert(add(_result, 32), mload(_result))
                }
            }
            _returnData[_i] = _result;
        }

        if (address(_baseToken) == address(0)) {
            if (_amountIn != 0 || _amountOut != 0 || _relayFee != 0) revert Error.Account__InvalidFlow();
            return (_signedPre, 0, _returnData);
        }

        uint _signedSum = _signedPre + _amountIn;
        uint _totalOut = _amountOut + _relayFee;
        if (_totalOut > _signedSum) revert Error.Account__OutflowExceedsSigned(_totalOut, _signedSum);

        TransferUtils.transferStrictly(_transferGasLimit, _baseToken, _feeReceiver, _relayFee);

        _signedPostBalance = _signedSum - _totalOut;
        _postBalance = _baseToken.balanceOf(address(this));
        if (_postBalance < _signedPostBalance) {
            revert Error.Account__Shortfall(_postBalance, _signedPostBalance);
        }

        signedBalance = _signedPostBalance;
    }

    receive() external payable {}
    fallback() external payable {}
}
