// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {Error} from "../utils/Error.sol";
import {IAccount} from "./interface/IAccount.sol";

abstract contract AccountBase is IAccount, IERC165 {
    mapping(bytes32 tokenId => uint signed) internal _signedBalanceMap;

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

    function signedBalanceOf(
        bytes32 _tokenId
    ) external view returns (uint) {
        return _signedBalanceMap[_tokenId];
    }

    function supportsInterface(
        bytes4 _id
    ) public view virtual returns (bool) {
        return
            _id == type(IAccount).interfaceId || _id == type(IERC1271).interfaceId || _id == type(IERC165).interfaceId;
    }

    function execute(
        Call[] calldata _callList,
        SignTransfer[] calldata _transferList
    )
        external
        payable
        returns (uint[] memory signedPostBalanceList_, uint[] memory postBalanceList_, bytes[] memory returnDataList_)
    {
        address _attest = getAttest();
        if (msg.sender != _attest) revert Error.Account__UnauthorizedCaller();

        uint _callLen = _callList.length;
        returnDataList_ = new bytes[](_callLen);
        for (uint _i; _i < _callLen; ++_i) {
            Call calldata _call = _callList[_i];
            if (_call.target == address(this) || _call.target == _attest) {
                revert Error.Account__ForbiddenTarget(_call.target);
            }
            bool _ok;
            (_ok, returnDataList_[_i]) = _call.gasLimit > 0
                ? _call.target.call{value: _call.value, gas: _call.gasLimit}(_call.callData)
                : _call.target.call{value: _call.value}(_call.callData);
            if (!_ok) {
                bytes memory _res = returnDataList_[_i];
                assembly ("memory-safe") {
                    revert(add(_res, 32), mload(_res))
                }
            }
        }

        uint _len = _transferList.length;
        signedPostBalanceList_ = new uint[](_len);
        postBalanceList_ = new uint[](_len);
        for (uint _i; _i < _len; ++_i) {
            SignTransfer calldata _t = _transferList[_i];
            uint _signedSum = _signedBalanceMap[_t.tokenId] + _t.amountIn;
            if (_t.amountOut > _signedSum) revert Error.Account__OutflowExceedsSigned(_t.amountOut, _signedSum);

            uint _signedPost = _signedSum - _t.amountOut;
            _signedBalanceMap[_t.tokenId] = _signedPost;
            uint _post = address(_t.token) == address(0) ? address(this).balance : _t.token.balanceOf(address(this));
            if (_post < _signedPost) revert Error.Account__Shortfall(address(_t.token), _post, _signedPost);
            signedPostBalanceList_[_i] = _signedPost;
            postBalanceList_[_i] = _post;
        }
    }

    receive() external payable {}
    fallback() external payable {}
}
