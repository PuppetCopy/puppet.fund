// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";

import {BaseGate} from "./utils/BaseGate.sol";
import {DepositRoute} from "./core/DepositRoute.sol";
import {BalanceLib} from "./utils/BalanceLib.sol";
import {CallLib} from "./utils/CallLib.sol";
import {Error} from "./utils/Error.sol";
import {IntentLib, RATE_PRECISION} from "./utils/IntentLib.sol";
import {AccountLib} from "./utils/AccountLib.sol";
import {AccountModule} from "./core/AccountModule.sol";
import {Deposit} from "./core/Deposit.sol";
import {Register} from "./core/Register.sol";
import {BondStore} from "./core/BondStore.sol";
import {IAccount} from "./utils/interfaces/IAccount.sol";

bytes32 constant MANDATE_INTENT_TYPEHASH = keccak256(
    "MandateIntent(IntentHeader header,bytes32 creditListHash,uint256 bond,bytes32 mandateListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

bytes32 constant UNBOND_INTENT_TYPEHASH = keccak256(
    "UnbondIntent(IntentHeader header,uint256 amount)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

bytes32 constant DRAW_INTENT_TYPEHASH = keccak256(
    "DrawIntent(IntentHeader header,uint256 spokeChainId,uint256 cycle,bytes32 lossListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

contract HubGate is BaseGate {
    struct MandateIntent {
        AccountLib.IntentHeader header;
        address[] creditList;
        uint bond;
        AccountLib.Mandate[] mandateList;
        bytes[] signatureList;
    }

    struct UnbondIntent {
        AccountLib.IntentHeader header;
        uint amount;
    }

    struct Loss {
        address puppet;
        uint amount;
    }

    struct DrawIntent {
        AccountLib.IntentHeader header;
        uint spokeChainId;
        uint cycle;
        Loss[] lossList;
    }

    Deposit internal immutable depositModule;
    BondStore internal immutable bondStore;
    address internal immutable bondToken;

    constructor(
        AccountModule _accountModule,
        Register _register,
        Deposit _depositModule,
        BondStore _bondStore,
        address _bondToken,
        Config memory _config
    ) BaseGate(_accountModule, _register, _config) {
        if (address(_depositModule) == address(0) || address(_bondStore) == address(0) || _bondToken == address(0)) {
            revert Error.Gate__InvalidModule();
        }
        depositModule = _depositModule;
        bondStore = _bondStore;
        bondToken = _bondToken;
    }

    function deposit(
        address _account,
        address _token,
        uint _amount,
        uint _bond
    ) external payable {
        address _user = accountModule.userOf(_account);
        if (_user != msg.sender) revert Error.Account__UnauthorizedCaller();
        if (_amount == 0 || _bond > _amount) revert Error.Balance__InvalidDeposit();
        if (_bond > 0 && _token != bondToken) revert Error.Bond__WrongToken(_token);
        uint _credited = _amount - _bond;
        if (_credited > 0) {
            depositModule.deposit{value: msg.value}(_user, _account, _token, _credited, transferGasLimit);
        }
        if (_bond > 0) {
            uint _storeBefore = BalanceLib.balanceOf(_token, address(bondStore));
            depositModule.deposit{value: _credited > 0 ? 0 : msg.value}(
                _user, address(bondStore), _token, _bond, transferGasLimit
            );
            uint _received = BalanceLib.balanceOf(_token, address(bondStore)) - _storeBefore;
            if (_received < _bond) revert Error.Bond__InsufficientBalance(_account, _received, _bond);
            bondStore.addBond(_account, _token, _bond);
        }
        accountModule.record(_account, bytes32(0), abi.encode(msg.sig, _token, _amount, _bond));
    }

    function mandate(
        MandateIntent calldata _intent,
        bytes calldata _intentSignature,
        AccountLib.Genesis calldata _genesis
    ) external {
        address _account = _intent.header.account;
        _deriveAccount(_account, _intent.header.user, _genesis);
        bytes32 _digest = _authorize(
            _intent.header,
            keccak256(
                abi.encode(
                    MANDATE_INTENT_TYPEHASH,
                    AccountLib.hashHeader(_intent.header),
                    keccak256(abi.encode(_intent.creditList)),
                    _intent.bond,
                    keccak256(abi.encode(_intent.mandateList))
                )
            )
        );
        IntentLib.verifyRegisteredTokenAndCap(registerModule, _intent.header.feeToken, _intent.header.fee);
        address _route = accountModule.predictDepositRoute(_intent.header.user);
        uint _tokens = _intent.creditList.length;
        uint[] memory _amountList = new uint[](_tokens);
        IAccount.Call[] memory _pays = new IAccount.Call[](_tokens);
        uint _paid;
        uint _swept;
        for (uint _i; _i < _tokens; ++_i) {
            address _token = _intent.creditList[_i];
            if (_i > 0 && uint160(_token) <= uint160(_intent.creditList[_i - 1])) {
                revert Error.Credit__ListNotSorted(_intent.creditList[_i - 1], _token);
            }
            if (registerModule.capMap(_token) == 0) revert Error.Intent__TokenNotValuable(_token);
            uint _amount = BalanceLib.balanceOf(_token, _route);
            _amountList[_i] = _amount;
            if (_token == bondToken) _swept = _amount;
            if (_amount > 0) {
                _pays[_paid] = CallLib.pay(_token, _account, _amount, transferGasLimit);
                ++_paid;
            }
        }
        assembly ("memory-safe") {
            mstore(_pays, _paid)
        }

        uint _credits = _paid > 0 ? 1 : 0;
        IAccount.Call[] memory _legs = new IAccount.Call[](_credits + (_intent.bond > 0 ? 2 : 1));
        if (_credits > 0) {
            _legs[0] = IAccount.Call({
                target: _route, value: 0, gasLimit: 0, callData: abi.encodeCall(DepositRoute.execute, (_pays))
            });
        }
        uint _storeBefore;
        if (_intent.bond > 0) {
            uint _needed = _intent.bond + (_intent.header.feeToken == bondToken ? _intent.header.fee : 0);
            uint _held = BalanceLib.balanceOf(bondToken, _account) + _swept;
            if (_held < _needed) revert Error.Bond__InsufficientBalance(_account, _held, _needed);
            _legs[_credits] = CallLib.pay(bondToken, address(bondStore), _intent.bond, transferGasLimit);
            _storeBefore = BalanceLib.balanceOf(bondToken, address(bondStore));
        }

        (,, address _signer) = IAccount(_account).args();
        if (_signer == address(0)) revert Error.Account__InvalidSignature();
        uint _len = _intent.mandateList.length;
        if (_len != _intent.signatureList.length) {
            revert Error.Mandate__ListLengthMismatch(_len, _intent.signatureList.length);
        }
        for (uint _i; _i < _len; ++_i) {
            AccountLib.Mandate calldata _m = _intent.mandateList[_i];
            bytes32 _mandateDigest = AccountLib.mandateDigest(_account, _m);
            if (ECDSA.tryRecoverCalldata(_mandateDigest, _intent.signatureList[_i]) != _signer) {
                revert Error.Account__InvalidSignature();
            }
            if (_i > 0 && uint160(_m.master) <= uint160(_intent.mandateList[_i - 1].master)) {
                revert Error.Mandate__ListNotSorted(_intent.mandateList[_i - 1].master, _m.master);
            }
            if (_m.master == _account) revert Error.Gate__MasterAsPuppet(_account);
            if (_m.allocationRate > RATE_PRECISION || _m.skin > RATE_PRECISION) {
                revert Error.Gate__InvalidAllocationRate(_m.allocationRate);
            }
            bondStore.setMandate(_account, _m.master, _mandateDigest);
        }

        _legs[_legs.length - 1] = _feeLeg(_intent.header);
        accountModule.dispatch(
            IAccount(_account),
            attestor,
            _digest,
            _intentSignature,
            abi.encode(
                msg.sig, _intent.creditList, _amountList, _intent.bond, _intent.mandateList, _intent.signatureList
            ),
            _legs
        );
        if (_intent.bond > 0) {
            uint _received = BalanceLib.balanceOf(bondToken, address(bondStore)) - _storeBefore;
            if (_received < _intent.bond) revert Error.Bond__InsufficientBalance(_account, _received, _intent.bond);
            bondStore.addBond(_account, bondToken, _intent.bond);
        }
    }

    function unbond(
        UnbondIntent calldata _intent,
        bytes calldata _intentSignature
    ) external {
        address _account = _intent.header.account;
        _existingAccount(_account, _intent.header.user);
        bytes32 _digest = _authorize(
            _intent.header,
            keccak256(abi.encode(UNBOND_INTENT_TYPEHASH, AccountLib.hashHeader(_intent.header), _intent.amount))
        );
        IntentLib.verifyRegisteredTokenAndCap(registerModule, _intent.header.feeToken, _intent.header.fee);
        if (_intent.amount == 0) revert Error.Balance__ZeroAmount();
        uint _bonded = bondStore.bondMap(_account, bondToken);
        if (_intent.amount > _bonded) revert Error.Bond__InsufficientBalance(_account, _bonded, _intent.amount);
        bondStore.payBond(_account, bondToken, _account, _intent.amount, transferGasLimit);
        uint _nonce = IAccount(_account).nonce();
        if (_nonce != _intent.header.nonce) {
            revert Error.Account__NonceMismatch(_account, _nonce, _intent.header.nonce);
        }
        IAccount.Call[] memory _legs = new IAccount.Call[](1);
        _legs[0] = _feeLeg(_intent.header);
        accountModule.dispatch(
            IAccount(_account), attestor, _digest, _intentSignature, abi.encode(msg.sig, _intent.amount), _legs
        );
    }

    function draw(
        DrawIntent calldata _intent,
        bytes calldata _intentSignature,
        AccountLib.Genesis calldata _genesis
    ) external {
        address _master = _intent.header.account;
        _deriveAccount(_master, _intent.header.user, _genesis);
        bytes32 _digest = _authorize(
            _intent.header,
            keccak256(
                abi.encode(
                    DRAW_INTENT_TYPEHASH,
                    AccountLib.hashHeader(_intent.header),
                    _intent.spokeChainId,
                    _intent.cycle,
                    keccak256(abi.encode(_intent.lossList))
                )
            )
        );
        IntentLib.verifyRegisteredTokenAndCap(registerModule, _intent.header.feeToken, _intent.header.fee);

        bondStore.markDrawn(_master, _intent.spokeChainId, _intent.cycle);

        uint _len = _intent.lossList.length;
        if (_len > maxCohortSize) revert Error.Gate__ListTooLong(_len, maxCohortSize);
        uint _drawn;
        for (uint _i; _i < _len; ++_i) {
            Loss calldata _l = _intent.lossList[_i];
            if (_i > 0 && uint160(_l.puppet) <= uint160(_intent.lossList[_i - 1].puppet)) {
                revert Error.Settle__RowsNotSorted(_intent.lossList[_i - 1].puppet, _l.puppet);
            }
            if (_l.puppet == _master) revert Error.Gate__MasterAsPuppet(_master);
            bytes32 _mandateDigest = bondStore.mandateMap(_l.puppet, _master);
            if (_mandateDigest == bytes32(0)) revert Error.Mandate__Mismatch(_l.puppet, _mandateDigest);
            uint _bonded = bondStore.bondMap(_l.puppet, bondToken);
            uint _loss = _bonded < _l.amount ? _bonded : _l.amount;
            if (_loss > 0) {
                bondStore.payBond(_l.puppet, bondToken, _master, _loss, transferGasLimit);
                _drawn += _loss;
            }
            accountModule.record(
                _l.puppet, _mandateDigest, abi.encode(msg.sig, _master, _intent.spokeChainId, _intent.cycle, _l.amount, _loss)
            );
        }

        uint _nonce = IAccount(_master).nonce();
        if (_nonce != _intent.header.nonce) {
            revert Error.Account__NonceMismatch(_master, _nonce, _intent.header.nonce);
        }
        IAccount.Call[] memory _legs = new IAccount.Call[](1);
        _legs[0] = _feeLeg(_intent.header);
        accountModule.dispatch(
            IAccount(_master),
            attestor,
            _digest,
            _intentSignature,
            abi.encode(msg.sig, _intent.spokeChainId, _intent.cycle, _drawn),
            _legs
        );
    }
}
