// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {GateConfig} from "./utils/GateConfig.sol";
import {LiquidityGate} from "./utils/LiquidityGate.sol";
import {CallLib} from "./utils/CallLib.sol";
import {BalanceLib} from "./utils/BalanceLib.sol";
import {Error} from "./utils/Error.sol";
import {IntentLib} from "./utils/IntentLib.sol";
import {AccountLib} from "./utils/AccountLib.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {AccountModule} from "./core/AccountModule.sol";
import {EscrowStore} from "./core/EscrowStore.sol";
import {Deposit} from "./core/Deposit.sol";
import {Register} from "./core/Register.sol";
import {FundAccount} from "./core/FundAccount.sol";
import {IAccount} from "./utils/interfaces/IAccount.sol";

bytes32 constant FULFIL_TYPEHASH = keccak256(
    "Fulfil(address store,address parent,address token,bytes32 round,uint256 fromTotal,uint256 fulfilledTotal,uint256 fee)"
);

bytes32 constant OPERATE_INTENT_TYPEHASH = keccak256(
    "OperateIntent(IntentHeader header,bytes32 callListHash,address[] tokenList)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
);

contract SpokeGate is LiquidityGate {
    struct OperateIntent {
        AccountLib.IntentHeader header;
        IAccount.Call[] callList;
        address[] tokenList;
    }

    constructor(
        AccountModule _accountModule,
        Register _register,
        Deposit _depositModule,
        EscrowStore _escrowStore,
        GateConfig memory _config
    ) LiquidityGate(_accountModule, _register, _depositModule, _escrowStore, _config) {}

    function fulfil(
        address _parent,
        address _master,
        address _token,
        bytes32 _round,
        uint _fromTotal,
        uint _fulfilledTotal,
        uint _fee,
        bytes calldata _attestorSignature
    ) external {
        bytes32 _digest = AccountLib.typedDigest(
            block.chainid,
            _master,
            keccak256(
                abi.encode(
                    FULFIL_TYPEHASH, address(escrowStore), _parent, _token, _round, _fromTotal, _fulfilledTotal, _fee
                )
            )
        );
        if (!SignatureCheckerLib.isValidSignatureNowCalldata(attestor, _digest, _attestorSignature)) {
            revert Error.Account__InvalidSignature();
        }
        if (_master.codehash == accountModule.bodyHash()) {
            (address _module, address _bound) = FundAccount(payable(_master)).bound();
            if (_module == address(accountModule) && _bound != _parent) revert Error.Account__HeaderMismatch(_master);
        }
        uint _fulfilled = escrowStore.fulfilledMap(_parent, _master, _token);
        if (
            _fulfilled != _fromTotal || _fulfilledTotal <= _fromTotal
                || _fulfilledTotal > escrowStore.escrowedMap(_parent, _master, _token)
        ) revert Error.Escrow__InvalidFulfil(_fulfilled, _fulfilledTotal);
        uint _amount = _fulfilledTotal - _fromTotal;
        IntentLib.verifyRelayFeeRatio(_fee, _amount, maxRelayFeeBps);
        escrowStore.setFulfilled(_parent, _master, _token, _fulfilledTotal);
        if (_fee > 0) escrowStore.pay(_token, feeReceiver, _fee, transferGasLimit);
        escrowStore.pay(_token, _master, _amount - _fee, transferGasLimit);
        accountModule.record(
            _master,
            _digest,
            abi.encode(msg.sig, _parent, _token, _round, _fromTotal, _fulfilledTotal, _fee),
            BalanceLib.list(_token)
        );
    }

    function operate(
        OperateIntent calldata _intent,
        bytes calldata _coSig,
        AccountLib.Genesis calldata _genesis
    ) external {
        address _master = _intent.header.account;
        _deriveBody(_master, _intent.header.user, _genesis);
        bytes32 _structHash = keccak256(
            abi.encode(
                OPERATE_INTENT_TYPEHASH,
                AccountLib.hashHeader(_intent.header),
                keccak256(abi.encode(_intent.callList)),
                keccak256(abi.encodePacked(_intent.tokenList))
            )
        );
        _authorize(_intent.header);
        IntentLib.verifyRegistered(registerModule, _intent.header.feeToken);
        uint _declared = _intent.tokenList.length;
        address[] memory _tokenList = new address[](_declared + 1);
        for (uint _i; _i < _declared; ++_i) {
            if (_intent.tokenList[_i] == _intent.header.feeToken) revert Error.Intent__DuplicateToken(_intent.header.feeToken);
            _tokenList[_i] = _intent.tokenList[_i];
        }
        _tokenList[_declared] = _intent.header.feeToken;
        uint _called = _intent.callList.length;
        IAccount.Call[] memory _legs = new IAccount.Call[](_called + 1);
        for (uint _i; _i < _called; ++_i) {
            _legs[_i] = _intent.callList[_i];
        }
        _legs[_called] = CallLib.pay(_intent.header.feeToken, feeReceiver, _intent.header.fee, transferGasLimit);
        accountModule.dispatch(
            IAccount(_master),
            attestor,
            _structHash,
            _coSig,
            abi.encode(msg.sig, _intent.header.feeToken, _intent.header.fee),
            _legs,
            _tokenList
        );
    }
}
