// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {Access} from "../utils/auth/Access.sol";
import {AccountLib} from "../utils/AccountLib.sol";
import {MandateLib} from "../utils/MandateLib.sol";
import {BalanceLib} from "../utils/BalanceLib.sol";
import {CallLib} from "../utils/CallLib.sol";
import {Error} from "../utils/Error.sol";
import {IntentLib, RATE_PRECISION} from "../utils/IntentLib.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";
import {AccountModule} from "./AccountModule.sol";
import {EscrowStore} from "./EscrowStore.sol";
import {FundAccount} from "./FundAccount.sol";
import {FundStore, isOpen} from "./FundStore.sol";
import {MandateStore} from "./MandateStore.sol";
import {UserAccount} from "./UserAccount.sol";
import {GateConfig} from "../utils/GateConfig.sol";
import {ShareToken} from "./ShareToken.sol";

uint constant VIRTUAL_SHARES = 1e12;
uint constant VIRTUAL_VALUE = 1e12;
uint constant PRICE_PRECISION = 1e12;

contract Fund is Access {
    struct Asset {
        uint chainId;
        address token;
        uint id;
        uint amount;
        uint value;
    }

    struct Position {
        uint chainId;
        bytes32 venue;
        bytes32 id;
        uint value;
    }

    struct Valuation {
        Asset[] assetList;
        Position[] positionList;
    }

    struct Allocation {
        address puppet;
        MandateLib.Mandate mandate;
        uint amount;
    }

    struct Credit {
        uint chainId;
        address token;
        uint total;
        uint feeTotal;
    }

    struct Price {
        uint amount;
        uint value;
    }

    struct AllocateIntent {
        AccountLib.IntentHeader header;
        ShareToken shareToken;
        Valuation valuation;
        address token;
        Price price;
        Credit credit;
        Allocation[] allocationList;
    }

    AccountModule public immutable accountModule;
    MandateStore public immutable mandateStore;
    FundStore public immutable fundStore;
    EscrowStore public immutable escrowStore;
    address public immutable shareImpl;
    address public immutable wnt;

    constructor(
        address _authority,
        AccountModule _accountModule,
        MandateStore _mandateStore,
        FundStore _fundStore,
        EscrowStore _escrowStore,
        address _shareImpl,
        address _wnt
    ) Access(_authority) {
        if (
            address(_accountModule) == address(0) || address(_mandateStore) == address(0)
                || address(_fundStore) == address(0) || address(_escrowStore) == address(0) || _shareImpl == address(0)
                || _wnt == address(0)
        ) {
            revert Error.Gate__InvalidModule();
        }
        accountModule = _accountModule;
        mandateStore = _mandateStore;
        fundStore = _fundStore;
        escrowStore = _escrowStore;
        shareImpl = _shareImpl;
        wnt = _wnt;
    }

    function allocate(
        AllocateIntent calldata _intent,
        bytes32 _structHash,
        uint _valuation,
        bytes calldata _coSig,
        bytes calldata _ownerSignature,
        GateConfig calldata _config
    ) external auth {
        address _master = _intent.header.account;
        Price calldata _price = _intent.price;
        if (_intent.header.feeToken != wnt) revert Error.Intent__FeeTokenMismatch(_intent.header.feeToken, wnt);
        if (_intent.token == wnt && _price.amount != _price.value) {
            revert Error.Fund__UnitPriceMismatch(_price.amount, _price.value);
        }
        uint _len = _intent.allocationList.length;
        ShareToken _shareToken = _intent.shareToken;
        uint _supply = _shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _masterShares = _shareToken.balanceOf(_master);
        uint _nav = _valuation + VIRTUAL_VALUE;
        FundStore.Redemption memory _redemption = fundStore.getRedemption(_master);
        if (isOpen(_redemption)) revert Error.Redeem__Open(_redemption.id);
        uint _exiting = Math.mulDiv(_redemption.queued, RATE_PRECISION, _supply, Math.Rounding.Ceil);
        uint _masterLeg = _intent.credit.total > 0 ? 1 : 0;
        if (_len + _masterLeg == 0) revert Error.Balance__ZeroAmount();
        address _owner = FundAccount(payable(_master)).parent();
        uint _slice = _intent.header.fee / (_len + _masterLeg);

        IAccount.Call[] memory _legs = new IAccount.Call[](_len + 2);
        uint _n;
        uint _existing = _supply == VIRTUAL_SHARES ? Math.mulDiv(_valuation, VIRTUAL_SHARES, VIRTUAL_VALUE) : 0;
        uint _minted = _existing;
        uint _masterBilled;
        if (_masterLeg > 0) {
            Credit calldata _credit = _intent.credit;
            bool _local = _credit.chainId == block.chainid;
            if (_local && _credit.token != _intent.token) {
                revert Error.Fund__CreditTokenMismatch(_credit.token, _intent.token);
            }
            FundStore.Credit memory _credited = _local
                ? FundStore.Credit({
                    total: escrowStore.fulfilledMap(_owner, _master, _credit.token),
                    feeTotal: escrowStore.feePaidMap(_owner, _master, _credit.token)
                })
                : fundStore.getCredit(_master, _credit.chainId, _credit.token);
            if (_credit.total <= _credited.total) revert Error.Fund__CreditNotIncreasing(_credited.total, _credit.total);
            uint _amount = _credit.total - _credited.total;
            uint _masterSlice = Math.mulDiv(_slice, _price.amount, _price.value);
            if (
                _local
                    ? _credit.feeTotal != _credited.feeTotal + _masterSlice
                    : _credit.feeTotal < _credited.feeTotal + _masterSlice
            ) revert Error.Fund__CreditFeeMismatch(_credit.feeTotal, _credited.feeTotal + _masterSlice);
            _masterBilled = _credit.feeTotal - _credited.feeTotal;
            IntentLib.verifyRelayFeeRatio(_masterBilled, _amount, _config.maxRelayFeeBps);
            bytes32 _digest = AccountLib.creditDigest(
                _owner, _master, _credit.chainId, _credit.token, _credit.total, _credit.feeTotal
            );
            if (!UserAccount(payable(_owner)).approves(_digest, _ownerSignature)) revert Error.Account__InvalidSignature();
            accountModule.record(_owner, _digest, abi.encode(msg.sig, _master, _credit), new address[](0));
            if (_local) {
                escrowStore.release(
                    _owner,
                    _master,
                    _credit.token,
                    _credit.total,
                    _credit.feeTotal,
                    _config.feeReceiver,
                    _config.transferGasLimit
                );
            } else {
                fundStore.setCredit(
                    _master, _credit.chainId, _credit.token, FundStore.Credit({total: _credit.total, feeTotal: _credit.feeTotal})
                );
            }
            _minted += Math.mulDiv(
                Math.mulDiv(_amount, _price.value, _price.amount) - _slice
                    - Math.mulDiv(_masterBilled - _masterSlice, _price.value, _price.amount),
                _supply + _existing,
                _nav
            );
        }
        if (_minted > 0) {
            _legs[_n++] = IAccount.Call({
                target: address(_shareToken), value: 0, gasLimit: 0, callData: abi.encodeCall(ShareToken.mint, (_master, _minted))
            });
        }
        _masterShares += _minted;
        uint _first = _n;
        address _prev;
        for (uint _i; _i < _len; ++_i) {
            Allocation calldata _row = _intent.allocationList[_i];
            address _puppet = _row.puppet;
            if (uint160(_puppet) <= uint160(_prev)) revert Error.Fund__AllocationListNotSorted(_prev, _puppet);
            _prev = _puppet;
            if (_puppet == _owner) continue;
            if (accountModule.predictUserAccount(UserAccount(payable(_puppet)).user()) != _puppet) {
                revert Error.Fund__NotAccount(_puppet);
            }
            uint _value = Math.mulDiv(_row.amount, _price.value, _price.amount);
            if (_slice * RATE_PRECISION >= _value * _config.maxRelayFeeBps) continue;
            MandateLib.Mandate calldata _mandate = _row.mandate;
            if (
                mandateStore.mandateMap(_puppet, _master)
                    != keccak256(abi.encode(_mandate, UserAccount(payable(_puppet)).epoch()))
                    || _mandate.expiry <= block.timestamp
            ) {
                continue;
            }
            FundStore.Holding memory _holding = fundStore.getHolding(_master, _puppet);
            if (_holding.allocatedAt > 0 && block.timestamp - _holding.allocatedAt < _mandate.cooldownPeriod) {
                revert Error.Mandate__Cooldown(_puppet, _holding.allocatedAt, _mandate.cooldownPeriod);
            }
            uint _stake = _shareToken.balanceOf(_puppet);
            uint _open = _mandate.exitCap > _exiting ? _mandate.exitCap - _exiting : 0;
            uint _balance = BalanceLib.balanceOf(_intent.token, _puppet);
            if (_row.amount * RATE_PRECISION > _balance * _mandate.allocationRate) continue;
            uint _rateRoom = Math.mulDiv(_balance, _price.value, _price.amount) * _mandate.allocationRate;
            if (_open == 0 || _value * RATE_PRECISION * _mandate.exitCap > _rateRoom * _open) continue;
            uint _shares = Math.mulDiv(_value - _slice, _supply + _existing, _nav);
            if (_shares == 0) continue;
            if (_mandate.skin > 0) {
                uint _skinRoom = _masterShares * _mandate.skin;
                uint _held = _stake * RATE_PRECISION;
                if (_skinRoom < _held || _shares * RATE_PRECISION * _mandate.exitCap > (_skinRoom - _held) * _open) {
                    continue;
                }
            }
            _holding.allocatedAt = uint40(block.timestamp);
            _holding.cost = SafeCast.toUint80(
                (_holding.cost * _stake + (_value - _slice) * PRICE_PRECISION) / (_stake + _shares)
            );
            IAccount.Call[] memory _pull = new IAccount.Call[](1);
            _pull[0] = CallLib.pay(_intent.token, _master, _row.amount, 0);
            try accountModule.dispatch{gas: _config.transferGasLimit}(
                IAccount(_puppet),
                address(0),
                bytes32(0),
                _intent.header.deadline,
                "",
                abi.encode(msg.sig, _master, _row.amount, _value, _slice, _shares, _holding),
                _pull,
                BalanceLib.list(_intent.token)
            ) {} catch {
                continue;
            }
            fundStore.setHolding(_master, _puppet, _holding);
            _legs[_n++] = IAccount.Call({
                target: address(_shareToken), value: 0, gasLimit: 0, callData: abi.encodeCall(ShareToken.mint, (_puppet, _shares))
            });
            _minted += _shares;
        }
        uint _billed = Math.mulDiv(_slice * (_n - _first), _price.amount, _price.value);
        if (_minted == _existing) revert Error.Balance__ZeroAmount();

        if (_billed > 0) _legs[_n++] = CallLib.pay(_intent.token, _config.feeReceiver, _billed, _config.transferGasLimit);
        assembly ("memory-safe") {
            mstore(_legs, _n)
        }
        accountModule.dispatch(
            IAccount(_master),
            _config.attestor,
            _structHash,
            _intent.header.deadline,
            _coSig,
            abi.encode(
                msg.sig,
                _valuation,
                _supply,
                _intent.token,
                _price,
                _intent.credit,
                _ownerSignature,
                _minted,
                _slice,
                _billed,
                _masterBilled
            ),
            _legs,
            BalanceLib.list(_intent.token, address(_shareToken))
        );
    }
}
