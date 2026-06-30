// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IAccount} from "./interfaces/IAccount.sol";

library SignLib {
    function transfer(
        address _token,
        uint _amountIn,
        uint _amountOut
    ) internal pure returns (IAccount.SignTransfer[] memory _transferList) {
        _transferList = new IAccount.SignTransfer[](1);
        _transferList[0] = IAccount.SignTransfer({token: _token, amountIn: _amountIn, amountOut: _amountOut});
    }

    function transfer(
        address _tokenA,
        uint _amountInA,
        uint _amountOutA,
        address _tokenB,
        uint _amountInB,
        uint _amountOutB
    ) internal pure returns (IAccount.SignTransfer[] memory _transferList) {
        _transferList = new IAccount.SignTransfer[](2);
        _transferList[0] = IAccount.SignTransfer({token: _tokenA, amountIn: _amountInA, amountOut: _amountOutA});
        _transferList[1] = IAccount.SignTransfer({token: _tokenB, amountIn: _amountInB, amountOut: _amountOutB});
    }

    function none() internal pure returns (IAccount.SignTransfer[] memory) {
        return new IAccount.SignTransfer[](0);
    }
}
