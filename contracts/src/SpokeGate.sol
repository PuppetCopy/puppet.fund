// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {GateConfig} from "./utils/GateConfig.sol";
import {LiquidityGate} from "./utils/LiquidityGate.sol";
import {CallLib} from "./utils/CallLib.sol";
import {BalanceLib} from "./utils/BalanceLib.sol";
import {Error} from "./utils/Error.sol";
import {AccountLib} from "./utils/AccountLib.sol";

import {AccountModule} from "./core/AccountModule.sol";
import {EscrowStore} from "./core/EscrowStore.sol";
import {Deposit} from "./core/Deposit.sol";
import {FundAccount} from "./core/FundAccount.sol";
import {UserAccount} from "./core/UserAccount.sol";
import {IAccount} from "./utils/interfaces/IAccount.sol";

bytes32 constant CALL_TYPEHASH = keccak256("Call(address target,uint256 value,uint256 gasLimit,bytes callData)");

bytes32 constant OPERATE_INTENT_TYPEHASH = keccak256(
    "OperateIntent(IntentHeader header,Call[] callList,address[] tokenList)Call(address target,uint256 value,uint256 gasLimit,bytes callData)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

contract SpokeGate is LiquidityGate {
    struct OperateIntent {
        AccountLib.IntentHeader header;
        IAccount.Call[] callList;
        address[] tokenList;
    }

    constructor(
        AccountModule _accountModule,
        Deposit _depositModule,
        EscrowStore _escrowStore,
        GateConfig memory _config
    ) LiquidityGate(_accountModule, _depositModule, _escrowStore, _config) {}

    function fulfil(
        address _body,
        address _token,
        uint _total,
        uint _feeTotal,
        bytes calldata _ownerSignature,
        AccountLib.Genesis calldata _genesis
    ) external {
        if (_body.codehash != accountModule.bodyHash()) revert Error.Account__NotDelegated(_body);
        (address _module, address _owner) = FundAccount(payable(_body)).bound();
        if (_module == address(0)) {
            accountModule.createAccount(_body, _genesis.parent, _genesis.key, _genesis.approval);
            (_module, _owner) = FundAccount(payable(_body)).bound();
        }
        if (_module != address(accountModule)) revert Error.Account__HeaderMismatch(_body);
        bytes32 _digest = AccountLib.creditDigest(_owner, _body, block.chainid, _token, _total, _feeTotal);
        if (!UserAccount(payable(_owner)).approves(_digest, _ownerSignature)) revert Error.Account__InvalidSignature();
        escrowStore.release(_owner, _body, _token, _total, _feeTotal, feeReceiver, transferGasLimit);
        accountModule.record(_body, _digest, abi.encode(msg.sig, _token, _total, _feeTotal), BalanceLib.list(_token));
    }

    function operate(
        OperateIntent calldata _intent,
        bytes calldata _coSig,
        AccountLib.Genesis calldata _genesis
    ) external {
        address _master = _intent.header.account;
        _deriveBody(_master, _intent.header.user, _genesis);
        _authorize(_intent.header);
        uint _declared = _intent.tokenList.length;
        address[] memory _tokenList = new address[](_declared + 1);
        for (uint _i; _i < _declared; ++_i) {
            if (_intent.tokenList[_i] == _intent.header.feeToken) revert Error.Intent__DuplicateToken(_intent.header.feeToken);
            _tokenList[_i] = _intent.tokenList[_i];
        }
        _tokenList[_declared] = _intent.header.feeToken;
        uint _called = _intent.callList.length;
        IAccount.Call[] memory _legs = new IAccount.Call[](_called + 1);
        bytes32[] memory _callHashList = new bytes32[](_called);
        for (uint _i; _i < _called; ++_i) {
            IAccount.Call calldata _call = _intent.callList[_i];
            _legs[_i] = _call;
            _callHashList[_i] =
                keccak256(abi.encode(CALL_TYPEHASH, _call.target, _call.value, _call.gasLimit, keccak256(_call.callData)));
        }
        _legs[_called] = CallLib.pay(_intent.header.feeToken, feeReceiver, _intent.header.fee, transferGasLimit);
        bytes32 _structHash = keccak256(
            abi.encode(
                OPERATE_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                keccak256(abi.encodePacked(_callHashList)),
                keccak256(abi.encodePacked(_intent.tokenList))
            )
        );
        accountModule.dispatch(
            IAccount(_master),
            attestor,
            _structHash,
            _intent.header.deadline,
            _coSig,
            abi.encode(msg.sig, _intent.header.feeToken, _intent.header.fee),
            _legs,
            _tokenList
        );
    }
}
