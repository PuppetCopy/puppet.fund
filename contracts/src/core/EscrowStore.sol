// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Access} from "../utils/auth/Access.sol";
import {TransferUtils} from "../utils/TransferUtils.sol";

contract EscrowStore is Access {
    mapping(address parent => mapping(address master => mapping(address token => uint escrowed))) public escrowedMap;
    mapping(address parent => mapping(address master => mapping(address token => uint fulfilled))) public fulfilledMap;

    constructor(
        address _authority
    ) Access(_authority) {}

    function setEscrowed(
        address _parent,
        address _master,
        address _token,
        uint _total
    ) external auth {
        escrowedMap[_parent][_master][_token] = _total;
    }

    function setFulfilled(
        address _parent,
        address _master,
        address _token,
        uint _total
    ) external auth {
        fulfilledMap[_parent][_master][_token] = _total;
    }

    function pay(
        address _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) external auth {
        TransferUtils.transferStrictly(_token, _to, _amount, _gasLimit);
    }

    receive() external payable {}
}
