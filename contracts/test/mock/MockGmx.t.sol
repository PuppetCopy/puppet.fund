// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockGmx {
    struct Order {
        address account;
        address collateral;
        uint amount;
        bool open;
    }

    mapping(bytes32 key => Order) public orderMap;
    uint internal _sequence;

    function sendTokens(
        address _token,
        address _receiver,
        uint _amount
    ) external {
        SafeERC20.safeTransferFrom(IERC20(_token), msg.sender, _receiver, _amount);
    }

    function createOrder(
        address _account,
        address _collateral,
        uint _amount
    ) external returns (bytes32 key_) {
        unchecked {
            _sequence += 1;
        }
        key_ = keccak256(abi.encode(_account, _collateral, _amount, _sequence));
        orderMap[key_] = Order({account: _account, collateral: _collateral, amount: _amount, open: true});
    }

    function executeOrder(
        bytes32 _key,
        int _pnl
    ) external returns (uint payout_) {
        Order memory _order = orderMap[_key];
        require(_order.open, "MockGmx: order closed");
        orderMap[_key].open = false;
        payout_ = _pnl >= 0 ? _order.amount + uint(_pnl) : _order.amount - uint(-_pnl);
        SafeERC20.safeTransfer(IERC20(_order.collateral), _order.account, payout_);
    }
}
