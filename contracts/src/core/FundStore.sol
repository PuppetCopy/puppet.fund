// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Access} from "../utils/auth/Access.sol";
import {TransferUtils} from "../utils/TransferUtils.sol";

contract FundStore is Access {
    struct Holding {
        uint192 basis;
        uint64 allocatedAt;
    }

    struct Queue {
        uint epoch;
        uint weight;
    }

    struct Position {
        uint epoch;
        uint cursor;
        uint weight;
        uint basis;
        uint shortfall;
    }

    mapping(address master => uint skin) public skinMap;
    mapping(address master => uint units) public retiredMap;
    mapping(address master => mapping(address holder => Holding)) internal holdingMap;
    mapping(address master => Queue) internal queueMap;
    mapping(address master => mapping(address holder => Position)) internal positionMap;
    mapping(address master => mapping(uint epoch => uint accrued)) public accruedMap;
    mapping(address master => mapping(uint epoch => mapping(address token => uint accrued))) public tokenAccruedMap;
    mapping(address master => mapping(uint epoch => address[] tokenList)) internal epochTokenMap;
    mapping(address master => mapping(address holder => mapping(uint epoch => mapping(address token => uint cursor))))
        public tokenCursorMap;
    mapping(address master => mapping(uint chainId => mapping(address token => uint credited))) public creditedMap;
    mapping(address account => mapping(address token => uint amount)) public owedMap;

    constructor(
        address _authority
    ) Access(_authority) {}

    function getHolding(
        address _master,
        address _holder
    ) external view returns (Holding memory) {
        return holdingMap[_master][_holder];
    }

    function getQueue(
        address _master
    ) external view returns (Queue memory) {
        return queueMap[_master];
    }

    function getPosition(
        address _master,
        address _holder
    ) external view returns (Position memory) {
        return positionMap[_master][_holder];
    }

    function getEpochTokenList(
        address _master,
        uint _epoch
    ) external view returns (address[] memory) {
        return epochTokenMap[_master][_epoch];
    }

    function setSkin(
        address _master,
        uint _skin
    ) external auth {
        skinMap[_master] = _skin;
    }

    function setRetired(
        address _master,
        uint _units
    ) external auth {
        retiredMap[_master] = _units;
    }

    function setHolding(
        address _master,
        address _holder,
        Holding calldata _holding
    ) external auth {
        holdingMap[_master][_holder] = _holding;
    }

    function setQueue(
        address _master,
        Queue calldata _queue
    ) external auth {
        queueMap[_master] = _queue;
    }

    function setPosition(
        address _master,
        address _holder,
        Position calldata _position
    ) external auth {
        positionMap[_master][_holder] = _position;
    }

    function setAccrued(
        address _master,
        uint _epoch,
        uint _accrued
    ) external auth {
        accruedMap[_master][_epoch] = _accrued;
    }

    function setTokenAccrued(
        address _master,
        uint _epoch,
        address _token,
        uint _accrued
    ) external auth {
        tokenAccruedMap[_master][_epoch][_token] = _accrued;
    }

    function pushEpochToken(
        address _master,
        uint _epoch,
        address _token
    ) external auth {
        epochTokenMap[_master][_epoch].push(_token);
    }

    function setTokenCursor(
        address _master,
        address _holder,
        uint _epoch,
        address _token,
        uint _cursor
    ) external auth {
        tokenCursorMap[_master][_holder][_epoch][_token] = _cursor;
    }

    function setCredited(
        address _master,
        uint _chainId,
        address _token,
        uint _total
    ) external auth {
        creditedMap[_master][_chainId][_token] = _total;
    }

    function setOwed(
        address _account,
        address _token,
        uint _amount
    ) external auth {
        owedMap[_account][_token] = _amount;
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
