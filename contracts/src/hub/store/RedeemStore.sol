// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BankStore} from "../../utils/BankStore.sol";
import {Error} from "../../utils/Error.sol";
import {Precision} from "../../utils/Precision.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";

contract RedeemStore is BankStore {
    struct Pool {
        uint epoch;
        uint accruedPerStake;
        uint totalStake;
    }

    struct Position {
        uint epoch;
        uint stake;
        uint cursor;
        uint accrued;
    }

    mapping(address fund => Pool) public poolMap;
    mapping(address fund => mapping(address holder => Position)) public positionMap;
    mapping(address fund => mapping(uint epoch => uint)) public closedEpochAccruedMap;
    mapping(address fund => uint) public closeRateMap;

    constructor(
        IAuthority _authority
    ) BankStore(_authority) {}

    function getPool(
        address _fund
    ) external view returns (Pool memory) {
        return poolMap[_fund];
    }

    function getPosition(
        address _fund,
        address _holder
    ) external view returns (Position memory) {
        return positionMap[_fund][_holder];
    }

    function setPool(
        address _fund,
        Pool calldata _pool
    ) external auth {
        poolMap[_fund] = _pool;
    }

    function setPosition(
        address _fund,
        address _holder,
        Position calldata _position
    ) external auth {
        positionMap[_fund][_holder] = _position;
    }

    function deletePosition(
        address _fund,
        address _holder
    ) external auth {
        delete positionMap[_fund][_holder];
    }

    function closeFund(
        address _fund,
        uint _closeRate
    ) external auth {
        closeRateMap[_fund] = _closeRate;
    }

    function recognize(
        IERC20 _token,
        uint _amount
    ) external auth {
        signedBalanceMap[_token] += _amount;
    }

    function rotatePool(
        address _fund
    ) external auth {
        Pool storage _pool = poolMap[_fund];
        closedEpochAccruedMap[_fund][_pool.epoch] = _pool.accruedPerStake;
        _pool.epoch += 1;
        _pool.accruedPerStake = 0;
        _pool.totalStake = 0;
    }

    function creditPool(
        address _fund,
        uint _amount
    ) external auth returns (uint accruedPerStake_, uint totalStake_) {
        Pool storage _pool = poolMap[_fund];
        if (_pool.totalStake == 0) revert Error.Share__NoStakeToCredit();
        uint _credit = Precision.toFactor(_amount, _pool.totalStake);
        if (_credit == 0) revert Error.Share__CreditTooSmall();
        _pool.accruedPerStake += _credit;
        return (_pool.accruedPerStake, _pool.totalStake);
    }

    function transferOut(
        IERC20 _token,
        address _receiver,
        uint _amount,
        uint _gasLimit
    ) external auth {
        _transferOut(_token, _receiver, _amount, _gasLimit);
    }
}
