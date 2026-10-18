// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Access} from "../utils/auth/Access.sol";
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

    mapping(address master => Redemption) internal redemptionMap;
    mapping(address master => mapping(address holder => Holding)) internal holdingMap;

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
        address _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) external auth {
        TransferUtils.transferStrictly(_token, _to, _amount, _gasLimit);
    }
}

function isOpen(
    FundStore.Redemption memory _redemption
) pure returns (bool) {
    return _redemption.owedLeft > 0 || _redemption.masterPay > 0;
}
