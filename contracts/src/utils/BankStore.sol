// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Access} from "./auth/Access.sol";
import {IAuthority} from "./interfaces/IAuthority.sol";
import {TransferUtils} from "./TransferUtils.sol";

abstract contract BankStore is Access {
    mapping(IERC20 => uint) public signedBalanceMap;

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function getTokenBalance(
        IERC20 _token
    ) external view returns (uint) {
        return signedBalanceMap[_token];
    }

    function _transferIn(
        IERC20 _token,
        address _depositor,
        uint _amount,
        uint _gasLimit
    ) internal {
        TransferUtils.transferStrictlyFrom(_token, _depositor, address(this), _amount, _gasLimit);
        signedBalanceMap[_token] += _amount;
    }

    function _transferOut(
        IERC20 _token,
        address _receiver,
        uint _amount,
        uint _gasLimit
    ) internal {
        signedBalanceMap[_token] -= _amount;
        TransferUtils.transferStrictly(_token, _receiver, _amount, _gasLimit);
    }
}
