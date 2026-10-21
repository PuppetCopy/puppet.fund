// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Access} from "../utils/auth/Access.sol";
import {BalanceLib} from "../utils/BalanceLib.sol";
import {Error} from "../utils/Error.sol";
import {TransferUtils} from "../utils/TransferUtils.sol";

contract FundStore is Access {
    struct Holding {
        uint40 allocatedAt;
        uint40 redeemedAt;
        uint96 queued;
        uint80 cost;
    }

    struct Redemption {
        uint64 id;
        uint32 fraction;
        uint64 fee;
        uint96 masterPay;
        uint128 queued;
        uint128 owedLeft;
        uint96 potLeft;
        address token;
        uint price;
    }

    struct Credit {
        uint total;
        uint feeTotal;
    }

    mapping(address master => Redemption) internal redemptionMap;
    mapping(address master => mapping(address holder => Holding)) internal holdingMap;
    mapping(address master => mapping(uint chainId => mapping(address token => Credit))) internal creditMap;
    mapping(address master => mapping(address token => uint booked)) public bookedMap;
    mapping(address token => uint held) public heldMap;

    constructor(
        address _authority
    ) Access(_authority) {}

    function getRedemption(
        address _master
    ) external view returns (Redemption memory) {
        return redemptionMap[_master];
    }

    function getHolding(
        address _master,
        address _holder
    ) external view returns (Holding memory) {
        return holdingMap[_master][_holder];
    }

    function getCredit(
        address _master,
        uint _chainId,
        address _token
    ) external view returns (Credit memory) {
        return creditMap[_master][_chainId][_token];
    }

    function setCredit(
        address _master,
        uint _chainId,
        address _token,
        Credit calldata _credit
    ) external auth {
        creditMap[_master][_chainId][_token] = _credit;
    }

    function book(
        address _master,
        address _token,
        uint _amount
    ) external auth {
        uint _held = heldMap[_token] + _amount;
        uint _balance = BalanceLib.balanceOf(_token, address(this));
        if (_balance < _held) revert Error.FundStore__Unfunded(_token, _balance, _held);
        heldMap[_token] = _held;
        bookedMap[_master][_token] += _amount;
    }

    function setRedemption(
        address _master,
        Redemption calldata _redemption
    ) external auth {
        redemptionMap[_master] = _redemption;
    }

    function setHolding(
        address _master,
        address _holder,
        Holding calldata _holding
    ) external auth {
        holdingMap[_master][_holder] = _holding;
    }

    function pay(
        address _master,
        address _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) external auth {
        uint _booked = bookedMap[_master][_token];
        if (_amount > _booked) revert Error.FundStore__Unbooked(_master, _token, _booked, _amount);
        bookedMap[_master][_token] = _booked - _amount;
        heldMap[_token] -= _amount;
        TransferUtils.transferStrictly(_token, _to, _amount, _gasLimit);
    }
}

function isOpen(
    FundStore.Redemption memory _redemption
) pure returns (bool) {
    return _redemption.owedLeft > 0 || _redemption.masterPay > 0;
}
