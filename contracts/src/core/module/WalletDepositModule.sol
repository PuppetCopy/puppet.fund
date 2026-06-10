// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Access} from "../../utils/auth/Access.sol";
import {Error} from "../../utils/Error.sol";
import {TransferUtils} from "../../utils/TransferUtils.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";
import {IWNT} from "../../utils/interfaces/IWNT.sol";

contract WalletDepositModule is Access {
    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function deposit(
        address _depositor,
        address _recipient,
        IERC20 _token,
        uint _amount,
        uint _gasLimit
    ) external auth {
        if (_amount == 0) revert Error.WalletDeposit__ZeroAmount();
        TransferUtils.transferStrictlyFrom(_token, _depositor, _recipient, _amount, _gasLimit);
        uint _depositPostBalance = _token.balanceOf(_recipient);
        _logEvent(
            "WalletDeposit", abi.encode(block.chainid, _depositor, _recipient, _token, _amount, _depositPostBalance)
        );
    }

    function depositWnt(
        address _depositor,
        address _recipient,
        IWNT _wnt,
        uint _gasLimit
    ) external payable auth {
        if (msg.value == 0) revert Error.WalletDeposit__ZeroAmount();
        _wnt.deposit{value: msg.value}();
        IERC20 _wntErc20 = IERC20(address(_wnt));
        TransferUtils.transferStrictly(_wntErc20, _recipient, msg.value, _gasLimit);
        uint _depositPostBalance = _wntErc20.balanceOf(_recipient);
        _logEvent(
            "WalletDeposit",
            abi.encode(block.chainid, _depositor, _recipient, _wntErc20, msg.value, _depositPostBalance)
        );
    }
}
