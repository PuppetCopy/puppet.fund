// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BankStore} from "../utils/BankStore.sol";
import {Error} from "../utils/Error.sol";
import {Precision} from "../utils/Precision.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";

contract RedeemStore is BankStore {
    struct Pool {
        uint accruedPerStake;
        uint totalStake;
    }

    struct Position {
        uint stake;
        uint cursor;
        uint accrued;
    }

    mapping(address master => mapping(IERC20 token => Pool)) public poolMap;
    mapping(address master => mapping(IERC20 token => mapping(address holder => Position))) public positionMap;

    constructor(
        IAuthority _authority
    ) BankStore(_authority) {}

    function getPool(
        address _master,
        IERC20 _token
    ) external view returns (Pool memory) {
        return poolMap[_master][_token];
    }

    function getPosition(
        address _master,
        IERC20 _token,
        address _holder
    ) external view returns (Position memory) {
        return positionMap[_master][_token][_holder];
    }

    function setPool(
        address _master,
        IERC20 _token,
        Pool calldata _pool
    ) external auth {
        poolMap[_master][_token] = _pool;
    }

    function setPosition(
        address _master,
        IERC20 _token,
        address _holder,
        Position calldata _position
    ) external auth {
        positionMap[_master][_token][_holder] = _position;
    }

    function deletePosition(
        address _master,
        IERC20 _token,
        address _holder
    ) external auth {
        delete positionMap[_master][_token][_holder];
    }

    function creditPool(
        address _master,
        IERC20 _token,
        address _depositor,
        uint _amount,
        uint _gasLimit
    ) external auth returns (uint accruedPerStake_, uint totalStake_) {
        Pool storage _pool = poolMap[_master][_token];
        if (_pool.totalStake == 0) revert Error.Share__NoStakeToCredit();
        _transferIn(_gasLimit, _token, _depositor, _amount);
        _pool.accruedPerStake += Precision.toFactor(_amount, _pool.totalStake);
        return (_pool.accruedPerStake, _pool.totalStake);
    }

    function transferOut(
        IERC20 _token,
        address _receiver,
        uint _amount,
        uint _gasLimit
    ) external auth {
        _transferOut(_gasLimit, _token, _receiver, _amount);
    }

    function transferOutUnsigned(
        IERC20 _token,
        address _receiver,
        uint _amount,
        uint _gasLimit
    ) external auth {
        _transferOutUnsigned(_gasLimit, _token, _receiver, _amount);
    }
}
