// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {GateConfig} from "./utils/GateConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LiquidityGate} from "./utils/LiquidityGate.sol";
import {Error} from "./utils/Error.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {IntentLib, RATE_PRECISION} from "./utils/IntentLib.sol";
import {AccountLib} from "./utils/AccountLib.sol";
import {CallLib} from "./utils/CallLib.sol";
import {BalanceLib} from "./utils/BalanceLib.sol";
import {AccountModule} from "./core/AccountModule.sol";
import {UserAccount} from "./core/UserAccount.sol";
import {FundAccount} from "./core/FundAccount.sol";
import {MandateStore} from "./core/MandateStore.sol";
import {Fund} from "./core/Fund.sol";
import {FundStore} from "./core/FundStore.sol";
import {GRID_BYTES, GRID_SIDE, PALETTE_BYTES, Share} from "./core/Share.sol";
import {EscrowStore} from "./core/EscrowStore.sol";
import {Deposit} from "./core/Deposit.sol";
import {Register} from "./core/Register.sol";
import {IAccount} from "./utils/interfaces/IAccount.sol";

bytes32 constant MANDATE_INTENT_TYPEHASH = keccak256(
    "MandateIntent(IntentHeader header,bytes32 mandateListHash,address[] tokenList,bool arm)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

bytes32 constant VALUATION_TYPEHASH = keccak256(
    "Valuation(uint256 value,bytes32 assetListHash,bytes32 positionListHash)"
);

bytes32 constant ALLOCATE_INTENT_TYPEHASH = keccak256(
    "AllocateIntent(IntentHeader header,address share,bytes32 valuationHash,Price price,Credit credit,bytes32 allocationListHash)Credit(uint256 chainId,address token,uint256 amount)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)Price(address token,uint256 amount,uint256 value)"
);

bytes32 constant CREDIT_TYPEHASH = keccak256("Credit(uint256 chainId,address token,uint256 amount)");

bytes32 constant SELL_INTENT_TYPEHASH = keccak256(
    "SellIntent(IntentHeader header,address master,address share,uint256 units)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

bytes32 constant REDEEM_INTENT_TYPEHASH = keccak256(
    "RedeemIntent(IntentHeader header,address share,bytes32 valuationHash,Price price,uint256 retire,uint256 drain)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)Price(address token,uint256 amount,uint256 value)"
);

bytes32 constant PRICE_TYPEHASH = keccak256("Price(address token,uint256 amount,uint256 value)");

uint constant ALLOWANCE_FLOOR = type(uint128).max;
uint constant MAX_SKIN = RATE_PRECISION / 2;

contract HubGate is LiquidityGate {
    struct MandateIntent {
        AccountLib.IntentHeader header;
        AccountLib.Mandate[] mandateList;
        bytes[] signatureList;
        address[] tokenList;
        bool arm;
    }

    MandateStore public immutable mandateStore;
    Fund public immutable fundModule;
    uint public immutable maxCohortSize;
    uint public immutable performanceFee;

    constructor(
        AccountModule _accountModule,
        Register _register,
        Deposit _depositModule,
        MandateStore _mandateStore,
        Fund _fundModule,
        EscrowStore _escrowStore,
        GateConfig memory _config,
        uint _maxCohortSize,
        uint _performanceFee
    ) LiquidityGate(_accountModule, _register, _depositModule, _escrowStore, _config) {
        if (
            address(_mandateStore) == address(0) || address(_fundModule) == address(0)
        ) {
            revert Error.Gate__InvalidModule();
        }
        if (_maxCohortSize == 0) revert Error.Gate__InvalidCohortCap();
        if (_performanceFee >= RATE_PRECISION) revert Error.Gate__InvalidPerformanceFee(_performanceFee);
        mandateStore = _mandateStore;
        fundModule = _fundModule;
        maxCohortSize = _maxCohortSize;
        performanceFee = _performanceFee;
    }

    function mandate(
        MandateIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        address _account = _intent.header.account;
        if (accountModule.createUserAccount(_intent.header.user) != _account) {
            revert Error.Account__HeaderMismatch(_account);
        }
        bytes32 _structHash = keccak256(
            abi.encode(
                MANDATE_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                keccak256(abi.encode(_intent.mandateList)),
                keccak256(abi.encodePacked(_intent.tokenList)),
                _intent.arm
            )
        );
        _authorize(_intent.header);
        IntentLib.verifyRegistered(registerModule, _intent.header.feeToken);

        uint _len = _intent.mandateList.length;
        if (_len != _intent.signatureList.length) {
            revert Error.Mandate__ListLengthMismatch(_len, _intent.signatureList.length);
        }
        for (uint _i; _i < _len; ++_i) {
            AccountLib.Mandate calldata _m = _intent.mandateList[_i];
            bytes32 _mandateDigest = AccountLib.mandateDigest(_account, _m);
            if (!UserAccount(payable(_account)).approves(_mandateDigest, _intent.signatureList[_i])) {
                revert Error.Account__InvalidSignature();
            }
            if (_i > 0 && uint160(_m.master) <= uint160(_intent.mandateList[_i - 1].master)) {
                revert Error.Mandate__ListNotSorted(_intent.mandateList[_i - 1].master, _m.master);
            }
            if (_m.allocationRate >= RATE_PRECISION) revert Error.Mandate__InvalidAllocationRate(_m.allocationRate);
            if (_m.skin > MAX_SKIN) revert Error.Mandate__InvalidSkin(_m.skin);
            mandateStore.setMandate(_account, _m.master, _m.expiry > block.timestamp ? _mandateDigest : bytes32(0));
        }

        uint _tokens = _intent.tokenList.length;
        IAccount.Call[] memory _routed = new IAccount.Call[](_tokens + 1);
        uint _n;
        for (uint _i; _i < _tokens; ++_i) {
            address _token = _intent.tokenList[_i];
            if (_intent.arm) IntentLib.verifyRegistered(registerModule, _token);
            uint _allowance = IERC20(_token).allowance(_account, address(fundModule));
            if (_intent.arm ? _allowance >= ALLOWANCE_FLOOR : _allowance == 0) continue;
            _routed[_n++] = IAccount.Call({
                target: _token,
                value: 0,
                gasLimit: transferGasLimit,
                callData: abi.encodeCall(IERC20.approve, (address(fundModule), _intent.arm ? type(uint).max : 0))
            });
        }
        _routed[_n++] = CallLib.pay(_intent.header.feeToken, feeReceiver, _intent.header.fee, transferGasLimit);
        assembly ("memory-safe") {
            mstore(_routed, _n)
        }
        accountModule.dispatch(
            IAccount(_account),
            attestor,
            _structHash,
            _coSig,
            abi.encode(
                msg.sig,
                _intent.mandateList,
                _intent.signatureList,
                _intent.tokenList,
                _intent.arm,
                _intent.header.feeToken,
                _intent.header.fee
            ),
            _routed,
            BalanceLib.list(_intent.header.feeToken)
        );
    }

    function verifyShare(
        address _master,
        Share _share
    ) public view {
        if (address(_share).code.length != 0x2d + 32 + GRID_BYTES + 2) {
            revert Error.Fund__ShareMismatch(_master, address(_share));
        }
        if (
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                LibClone.argsOnClone(address(_share)),
                bytes32(uint(uint160(_master))),
                address(this)
            ) != address(_share)
        ) revert Error.Fund__ShareMismatch(_master, address(_share));
    }

    function createFund(
        bytes32 _symbol,
        bytes calldata _pixels,
        bytes calldata _keySignature,
        bytes calldata _approval,
        Fund.AllocateIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        address _account = _intent.header.account;
        uint _len;
        while (_len < 32 && _symbol[_len] != 0) {
            bytes1 _c = _symbol[_len];
            if (!((_c >= "A" && _c <= "Z") || (_c >= "0" && _c <= "9"))) revert Error.Share__InvalidSymbol(_symbol);
            ++_len;
        }
        if (_len == 0 || (_len < 32 && _symbol << (_len * 8) != 0)) revert Error.Share__InvalidSymbol(_symbol);
        if (_pixels.length != GRID_BYTES) revert Error.Share__InvalidGrid(_pixels.length);
        for (uint _i; _i < GRID_SIDE * GRID_SIDE; ++_i) {
            uint8 _color = uint8(_pixels[PALETTE_BYTES + _i]);
            if (_color >= PALETTE_BYTES / 3) revert Error.Share__InvalidPixel(_i, _color);
        }
        address _parent = accountModule.createUserAccount(_intent.header.user);
        accountModule.createAccount(_account, _parent, _keySignature, _approval);
        address _clone = LibClone.cloneDeterministic(
            fundModule.shareImpl(),
            abi.encodePacked(_symbol, _pixels, uint16(performanceFee)),
            bytes32(uint(uint160(_account)))
        );
        if (_clone != address(_intent.share)) revert Error.Fund__ShareMismatch(_account, address(_intent.share));
        accountModule.record(
            _account,
            bytes32(0),
            abi.encode(msg.sig, _clone, _symbol, _pixels, performanceFee),
            new address[](0)
        );
        _allocate(_intent, _coSig);
    }

    function allocate(
        Fund.AllocateIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        _verifyBody(_intent.header.account, _intent.header.user);
        verifyShare(_intent.header.account, _intent.share);
        _allocate(_intent, _coSig);
    }

    function _allocate(
        Fund.AllocateIntent calldata _intent,
        bytes calldata _coSig
    ) internal {
        if (_intent.allocationList.length > maxCohortSize) {
            revert Error.Gate__ListTooLong(_intent.allocationList.length, maxCohortSize);
        }
        bytes32 _structHash = keccak256(
            abi.encode(
                ALLOCATE_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                _intent.share,
                keccak256(
                    abi.encode(
                        VALUATION_TYPEHASH,
                        _intent.valuation.value,
                        keccak256(abi.encode(_intent.valuation.assetList)),
                        keccak256(abi.encode(_intent.valuation.positionList))
                    )
                ),
                keccak256(
                    abi.encode(PRICE_TYPEHASH, _intent.price.token, _intent.price.amount, _intent.price.value)
                ),
                keccak256(
                    abi.encode(CREDIT_TYPEHASH, _intent.credit.chainId, _intent.credit.token, _intent.credit.amount)
                ),
                keccak256(abi.encode(_intent.allocationList))
            )
        );
        _authorize(_intent.header);
        fundModule.allocate(_intent, _structHash, _coSig, getConfig());
    }

    function sell(
        Fund.SellIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        if (accountModule.predictUserAccount(_intent.header.user) != _intent.header.account) {
            revert Error.Account__HeaderMismatch(_intent.header.account);
        }
        bytes32 _structHash = keccak256(
            abi.encode(
                SELL_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                _intent.master,
                _intent.share,
                _intent.units
            )
        );
        _authorize(_intent.header);
        IntentLib.verifyRegistered(registerModule, _intent.header.feeToken);
        verifyShare(_intent.master, _intent.share);
        fundModule.sell(_intent, _structHash, _coSig, getConfig());
    }

    function redeem(
        Fund.RedeemIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        _verifyBody(_intent.header.account, _intent.header.user);
        bytes32 _structHash = keccak256(
            abi.encode(
                REDEEM_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                _intent.share,
                keccak256(
                    abi.encode(
                        VALUATION_TYPEHASH,
                        _intent.valuation.value,
                        keccak256(abi.encode(_intent.valuation.assetList)),
                        keccak256(abi.encode(_intent.valuation.positionList))
                    )
                ),
                keccak256(
                    abi.encode(PRICE_TYPEHASH, _intent.price.token, _intent.price.amount, _intent.price.value)
                ),
                _intent.retire,
                _intent.drain
            )
        );
        _authorize(_intent.header);
        IntentLib.verifyRegistered(registerModule, _intent.price.token);
        verifyShare(_intent.header.account, _intent.share);
        fundModule.redeem(_intent, _structHash, _coSig, getConfig());
    }

    function claim(
        address _master,
        Share _share,
        address _holder
    ) external {
        verifyShare(_master, _share);
        fundModule.claim(_master, _share, _holder, getConfig());
    }

    function payOwed(
        address _account,
        address _token
    ) external {
        FundStore _fundStore = fundModule.fundStore();
        uint _amount = _fundStore.owedMap(_account, _token);
        if (_amount == 0) revert Error.Fund__NothingToClaim(_account);
        _fundStore.setOwed(_account, _token, 0);
        _fundStore.pay(_token, _account, _amount, transferGasLimit);
        accountModule.record(_account, bytes32(0), abi.encode(msg.sig, _token, _amount), BalanceLib.list(_token));
    }

    function refund(
        address _master,
        address _token,
        uint _amount
    ) external {
        address _parent = accountModule.createUserAccount(msg.sender);
        if (registerModule.tokenIdMap(_token) != bytes32(0) && _master.codehash == accountModule.bodyHash()) {
            (address _module, address _bound) = FundAccount(payable(_master)).bound();
            if (_module == address(accountModule) && _bound == _parent) revert Error.Escrow__RefundClosed();
        }
        uint _escrowed = escrowStore.escrowedMap(_parent, _master, _token);
        uint _held = _escrowed - escrowStore.fulfilledMap(_parent, _master, _token);
        if (_amount > _held) revert Error.Balance__InsufficientBalance(_held, _amount);
        escrowStore.setEscrowed(_parent, _master, _token, _escrowed - _amount);
        accountModule.record(
            _parent, bytes32(0), abi.encode(msg.sig, _master, _token, _amount), new address[](0)
        );
        escrowStore.pay(_token, msg.sender, _amount, transferGasLimit);
    }
}
