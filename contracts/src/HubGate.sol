// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {LibClone} from "solady/utils/LibClone.sol";

import {AccountModule} from "./core/AccountModule.sol";
import {Deposit} from "./core/Deposit.sol";
import {EscrowStore} from "./core/EscrowStore.sol";
import {Fund} from "./core/Fund.sol";
import {MandateStore} from "./core/MandateStore.sol";
import {Redeem} from "./core/Redeem.sol";
import {GRID_BYTES, GRID_SIDE, PALETTE_BYTES, ShareToken} from "./core/ShareToken.sol";
import {UserAccount} from "./core/UserAccount.sol";
import {AccountLib} from "./utils/AccountLib.sol";
import {BalanceLib} from "./utils/BalanceLib.sol";
import {CallLib} from "./utils/CallLib.sol";
import {Error} from "./utils/Error.sol";
import {GateConfig} from "./utils/GateConfig.sol";
import {RATE_PRECISION} from "./utils/IntentLib.sol";
import {IAccount} from "./utils/interfaces/IAccount.sol";
import {LiquidityGate} from "./utils/LiquidityGate.sol";
import {MandateLib} from "./utils/MandateLib.sol";
import {NATIVE_TOKEN} from "./utils/Native.sol";

uint constant MAX_SKIN = 100 * RATE_PRECISION;

bytes32 constant PRICE_TYPEHASH = keccak256("Price(uint256 amount,uint256 value)");

bytes32 constant CREDIT_TYPEHASH = keccak256("Credit(uint256 chainId,address token,uint256 total,uint256 feeTotal)");

bytes32 constant ASSET_TYPEHASH = keccak256("Asset(uint256 chainId,address token,uint256 id,uint256 amount,uint256 value)");

bytes32 constant POSITION_TYPEHASH = keccak256("Position(uint256 chainId,bytes32 venue,bytes32 id,uint256 value)");

bytes32 constant VALUATION_TYPEHASH = keccak256(
    "Valuation(Asset[] assetList,Position[] positionList)Asset(uint256 chainId,address token,uint256 id,uint256 amount,uint256 value)Position(uint256 chainId,bytes32 venue,bytes32 id,uint256 value)"
);

bytes32 constant MANDATE_INTENT_TYPEHASH = keccak256(
    "MandateIntent(IntentHeader header,uint256 epoch,bytes32 mandateListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

bytes32 constant ALLOCATE_INTENT_TYPEHASH = keccak256(
    "AllocateIntent(IntentHeader header,address shareToken,Valuation valuation,address token,Price price,Credit credit,bytes32 allocationListHash)Asset(uint256 chainId,address token,uint256 id,uint256 amount,uint256 value)Credit(uint256 chainId,address token,uint256 total,uint256 feeTotal)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)Position(uint256 chainId,bytes32 venue,bytes32 id,uint256 value)Price(uint256 amount,uint256 value)Valuation(Asset[] assetList,Position[] positionList)"
);

bytes32 constant SELL_INTENT_TYPEHASH = keccak256(
    "SellIntent(IntentHeader header,address shareToken,uint256 shares)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

bytes32 constant REDEEM_INTENT_TYPEHASH = keccak256(
    "RedeemIntent(IntentHeader header,address shareToken,Valuation valuation,address token,uint256 fraction,uint256 join)Asset(uint256 chainId,address token,uint256 id,uint256 amount,uint256 value)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)Position(uint256 chainId,bytes32 venue,bytes32 id,uint256 value)Valuation(Asset[] assetList,Position[] positionList)"
);

contract HubGate is LiquidityGate {
    struct MandateIntent {
        AccountLib.IntentHeader header;
        uint epoch;
        MandateLib.Mandate[] mandateList;
    }

    address private immutable impl;
    Fund public immutable fundModule;
    Redeem public immutable redeemModule;
    uint public immutable maxCohortSize;
    uint public immutable performanceFee;
    mapping(address token => bool) internal canonicalTokenMap;
    string[] internal attestorEndpointList;

    constructor(
        AccountModule _accountModule,
        Deposit _depositModule,
        EscrowStore _escrowStore,
        Fund _fundModule,
        Redeem _redeemModule,
        GateConfig memory _config,
        string[] memory _attestorEndpointList,
        address[] memory _canonicalTokenList,
        uint _maxCohortSize,
        uint _performanceFee
    ) LiquidityGate(_accountModule, _depositModule, _escrowStore, _config) {
        if (address(_fundModule) == address(0) || address(_redeemModule) == address(0)) revert Error.Gate__InvalidModule();
        if (_maxCohortSize == 0) revert Error.Gate__InvalidCohortCap();
        if (_performanceFee >= RATE_PRECISION) revert Error.Gate__InvalidPerformanceFee(_performanceFee);
        if (_attestorEndpointList.length == 0) revert Error.Gate__NoAttestorEndpoint();
        for (uint _i; _i < _attestorEndpointList.length; ++_i) {
            if (bytes(_attestorEndpointList[_i]).length == 0) revert Error.Gate__NoAttestorEndpoint();
            attestorEndpointList.push(_attestorEndpointList[_i]);
        }
        for (uint _i; _i < _canonicalTokenList.length; ++_i) {
            address _token = _canonicalTokenList[_i];
            if (_token == NATIVE_TOKEN || _token.code.length == 0) revert Error.Gate__InvalidCanonicalToken(_token);
            canonicalTokenMap[_token] = true;
        }
        impl = address(this);
        fundModule = _fundModule;
        redeemModule = _redeemModule;
        maxCohortSize = _maxCohortSize;
        performanceFee = _performanceFee;
    }

    function mandate(
        MandateIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        address _account = _intent.header.account;
        _verifyUser(_account, _intent.header.user);
        bytes32 _structHash = keccak256(
            abi.encode(
                MANDATE_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                _intent.epoch,
                keccak256(abi.encode(_intent.mandateList))
            )
        );
        _authorize(_intent.header);
        uint _epoch = UserAccount(payable(_account)).epoch();
        if (_intent.epoch != _epoch) revert Error.Mandate__StaleEpoch(_intent.epoch, _epoch);

        uint _len = _intent.mandateList.length;
        IAccount.Call[] memory _legs = new IAccount.Call[](1);
        MandateStore _mandateStore = fundModule.mandateStore();
        for (uint _i; _i < _len; ++_i) {
            MandateLib.Mandate calldata _m = _intent.mandateList[_i];
            if (_i > 0 && uint160(_m.master) <= uint160(_intent.mandateList[_i - 1].master)) {
                revert Error.Mandate__ListNotSorted(_intent.mandateList[_i - 1].master, _m.master);
            }
            bool _live = _m.expiry > block.timestamp;
            if (_m.allocationRate >= RATE_PRECISION || (_live && _m.allocationRate == 0)) {
                revert Error.Mandate__InvalidAllocationRate(_m.allocationRate);
            }
            if (_m.skin > MAX_SKIN) revert Error.Mandate__InvalidSkin(_m.skin);
            if (_m.exitCap > RATE_PRECISION || (_live && _m.exitCap == 0)) revert Error.Mandate__InvalidExitCap(_m.exitCap);
            _mandateStore.setMandate(_account, _m.master, _live ? keccak256(abi.encode(_m, _epoch)) : bytes32(0));
        }
        _legs[0] = CallLib.pay(_intent.header.feeToken, feeReceiver, _intent.header.fee, transferGasLimit);
        accountModule.dispatch(
            IAccount(_account),
            attestor,
            _structHash,
            _intent.header.deadline,
            _coSig,
            abi.encode(msg.sig, _epoch, _intent.mandateList, _intent.header.feeToken, _intent.header.fee),
            _legs,
            BalanceLib.list(_intent.header.feeToken)
        );
    }

    function createFund(
        bytes32 _symbol,
        bytes calldata _pixels,
        bytes calldata _keySignature,
        bytes calldata _approval,
        Fund.AllocateIntent calldata _intent,
        bytes calldata _coSig,
        bytes calldata _ownerSignature
    ) external {
        address _account = _intent.header.account;
        uint _len;
        while (_len < 32 && _symbol[_len] != 0) {
            bytes1 _c = _symbol[_len];
            if (!((_c >= "A" && _c <= "Z") || (_c >= "0" && _c <= "9"))) revert Error.ShareToken__InvalidSymbol(_symbol);
            ++_len;
        }
        if (_len == 0 || (_len < 32 && _symbol << (_len * 8) != 0)) revert Error.ShareToken__InvalidSymbol(_symbol);
        if (_pixels.length != GRID_BYTES) revert Error.ShareToken__InvalidGrid(_pixels.length);
        for (uint _i; _i < GRID_SIDE * GRID_SIDE; ++_i) {
            uint8 _color = uint8(_pixels[PALETTE_BYTES + _i]);
            if (_color >= PALETTE_BYTES / 3) revert Error.ShareToken__InvalidPixel(_i, _color);
        }
        address _parent = accountModule.createUserAccount(_intent.header.user);
        accountModule.createAccount(_account, _parent, _keySignature, _approval);
        address _clone = LibClone.cloneDeterministic(
            fundModule.shareImpl(),
            abi.encodePacked(_account, _symbol, _pixels, uint16(performanceFee)),
            bytes32(uint(uint160(_account)))
        );
        if (_clone != address(_intent.shareToken)) revert Error.Fund__ShareMismatch(_account, address(_intent.shareToken));
        accountModule.record(
            _account,
            bytes32(0),
            abi.encode(msg.sig, _clone, _symbol, _pixels, performanceFee),
            new address[](0)
        );
        _allocate(_intent, _coSig, _ownerSignature);
    }

    function allocate(
        Fund.AllocateIntent calldata _intent,
        bytes calldata _coSig,
        bytes calldata _ownerSignature
    ) external {
        _verifyBody(_intent.header.account, _intent.header.user);
        verifyShare(_intent.header.account, _intent.shareToken);
        _allocate(_intent, _coSig, _ownerSignature);
    }

    function sell(
        Redeem.SellIntent calldata _intent,
        bytes calldata _coSig
    ) external {
        if (accountModule.predictUserAccount(_intent.header.user) != _intent.header.account) {
            revert Error.Account__HeaderMismatch(_intent.header.account);
        }
        bytes32 _structHash = keccak256(
            abi.encode(SELL_INTENT_TYPEHASH, AccountLib.hashHeader(_intent.header), _intent.shareToken, _intent.shares)
        );
        _authorize(_intent.header);
        address _master = _intent.shareToken.master();
        verifyShare(_master, _intent.shareToken);
        fundModule.mandateStore().setMandate(_intent.header.account, _master, bytes32(0));
        redeemModule.sell(_master, _intent, _structHash, _coSig, getConfig());
    }

    function redeem(
        Redeem.RedeemIntent calldata _intent,
        bytes calldata _coSig,
        address[] calldata _holderList
    ) external {
        _verifyBody(_intent.header.account, _intent.header.user);
        if (_holderList.length > maxCohortSize) revert Error.Gate__ListTooLong(_holderList.length, maxCohortSize);
        if (!isCanonical(_intent.token)) revert Error.Fund__TokenNotCanonical(_intent.token);
        Fund.Valuation calldata _v = _intent.valuation;
        uint _valuation;
        Fund.Price memory _price;
        bytes32[] memory _assetHashList = new bytes32[](_v.assetList.length);
        for (uint _i; _i < _assetHashList.length; ++_i) {
            Fund.Asset calldata _asset = _v.assetList[_i];
            _assetHashList[_i] = keccak256(abi.encode(ASSET_TYPEHASH, _asset));
            _valuation += _asset.value;
            if (_price.amount == 0 && _asset.chainId == block.chainid && _asset.token == _intent.token && _asset.id == 0) {
                _price = Fund.Price({amount: _asset.amount, value: _asset.value});
            }
        }
        bytes32[] memory _positionHashList = new bytes32[](_v.positionList.length);
        for (uint _i; _i < _positionHashList.length; ++_i) {
            _positionHashList[_i] = keccak256(abi.encode(POSITION_TYPEHASH, _v.positionList[_i]));
            _valuation += _v.positionList[_i].value;
        }
        bytes32 _structHash = keccak256(
            abi.encode(
                REDEEM_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                _intent.shareToken,
                keccak256(
                    abi.encode(VALUATION_TYPEHASH, keccak256(abi.encodePacked(_assetHashList)), keccak256(abi.encodePacked(_positionHashList)))
                ),
                _intent.token,
                _intent.fraction,
                _intent.join
            )
        );
        _authorize(_intent.header);
        verifyShare(_intent.header.account, _intent.shareToken);
        redeemModule.redeem(_intent, _structHash, _valuation, _price, _coSig, getConfig());
        redeemModule.redeemCohort(_intent.header.account, _intent.shareToken, _holderList, getConfig());
    }

    function redeemCohort(
        ShareToken _shareToken,
        address[] calldata _holderList
    ) external {
        if (_holderList.length > maxCohortSize) revert Error.Gate__ListTooLong(_holderList.length, maxCohortSize);
        address _master = _shareToken.master();
        verifyShare(_master, _shareToken);
        redeemModule.redeemCohort(_master, _shareToken, _holderList, getConfig());
    }

    function attestorEndpoints() external view returns (string[] memory) {
        return address(this) == impl ? attestorEndpointList : HubGate(impl).attestorEndpoints();
    }

    function isCanonical(
        address _token
    ) public view returns (bool) {
        return address(this) == impl ? canonicalTokenMap[_token] : HubGate(impl).isCanonical(_token);
    }

    function verifyShare(
        address _master,
        ShareToken _shareToken
    ) public view {
        if (address(_shareToken).code.length != 0x2d + 20 + 32 + GRID_BYTES + 2) {
            revert Error.Fund__ShareMismatch(_master, address(_shareToken));
        }
        if (
            LibClone.predictDeterministicAddress(
                LibClone.implementationOf(address(_shareToken)),
                LibClone.argsOnClone(address(_shareToken)),
                bytes32(uint(uint160(_master))),
                address(this)
            ) != address(_shareToken)
        ) revert Error.Fund__ShareMismatch(_master, address(_shareToken));
    }

    function _allocate(
        Fund.AllocateIntent calldata _intent,
        bytes calldata _coSig,
        bytes calldata _ownerSignature
    ) internal {
        if (_intent.allocationList.length > maxCohortSize) {
            revert Error.Gate__ListTooLong(_intent.allocationList.length, maxCohortSize);
        }
        Fund.Valuation calldata _v = _intent.valuation;
        uint _valuation;
        bytes32[] memory _assetHashList = new bytes32[](_v.assetList.length);
        for (uint _i; _i < _assetHashList.length; ++_i) {
            _assetHashList[_i] = keccak256(abi.encode(ASSET_TYPEHASH, _v.assetList[_i]));
            _valuation += _v.assetList[_i].value;
        }
        bytes32[] memory _positionHashList = new bytes32[](_v.positionList.length);
        for (uint _i; _i < _positionHashList.length; ++_i) {
            _positionHashList[_i] = keccak256(abi.encode(POSITION_TYPEHASH, _v.positionList[_i]));
            _valuation += _v.positionList[_i].value;
        }
        bytes32 _structHash = keccak256(
            abi.encode(
                ALLOCATE_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                _intent.shareToken,
                keccak256(
                    abi.encode(VALUATION_TYPEHASH, keccak256(abi.encodePacked(_assetHashList)), keccak256(abi.encodePacked(_positionHashList)))
                ),
                _intent.token,
                keccak256(abi.encode(PRICE_TYPEHASH, _intent.price.amount, _intent.price.value)),
                keccak256(
                    abi.encode(
                        CREDIT_TYPEHASH,
                        _intent.credit.chainId,
                        _intent.credit.token,
                        _intent.credit.total,
                        _intent.credit.feeTotal
                    )
                ),
                keccak256(abi.encode(_intent.allocationList))
            )
        );
        _authorize(_intent.header);
        if (_intent.price.amount == 0 || _intent.price.value == 0) revert Error.Balance__ZeroAmount();
        if (!isCanonical(_intent.token)) revert Error.Fund__TokenNotCanonical(_intent.token);
        fundModule.allocate(_intent, _structHash, _valuation, _coSig, _ownerSignature, getConfig());
    }

    function _deriveBody(
        address _body,
        address _owner,
        AccountLib.Genesis calldata
    ) internal view override {
        _verifyBody(_body, _owner);
    }
}
