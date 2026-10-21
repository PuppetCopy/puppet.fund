// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {ESCROW_RETURN_DELAY} from "../utils/AccountLib.sol";
import {BalanceLib} from "../utils/BalanceLib.sol";
import {Error} from "../utils/Error.sol";
import {IntentLib, RATE_PRECISION} from "../utils/IntentLib.sol";
import {TransferUtils} from "../utils/TransferUtils.sol";
import {Access} from "../utils/auth/Access.sol";
import {AccountModule} from "./AccountModule.sol";
import {FundAccount} from "./FundAccount.sol";
import {UserAccount} from "./UserAccount.sol";

contract EscrowStore is Access {
    AccountModule public immutable accountModule;
    uint public immutable maxFeeBps;

    mapping(address owner => mapping(address token => uint escrowed)) public escrowedMap;
    mapping(address owner => mapping(address token => uint released)) public releasedMap;
    mapping(address owner => mapping(address token => uint returned)) public returnedMap;
    mapping(address owner => mapping(address body => mapping(address token => uint fulfilled))) public fulfilledMap;
    mapping(address owner => mapping(address body => mapping(address token => uint feePaid))) public feePaidMap;
    mapping(address owner => mapping(address token => uint returnAt)) public returnAtMap;
    mapping(address token => uint held) public heldMap;

    constructor(
        address _authority,
        AccountModule _accountModule,
        uint _maxFeeBps
    ) Access(_authority) {
        if (address(_accountModule) == address(0)) revert Error.Gate__InvalidModule();
        if (_maxFeeBps >= RATE_PRECISION) revert Error.Gate__InvalidRelayFeeBps(_maxFeeBps);
        accountModule = _accountModule;
        maxFeeBps = _maxFeeBps;
    }

    function escrow(
        address _owner,
        address _token,
        uint _amount
    ) external auth returns (uint escrowed_) {
        uint _held = heldMap[_token] + _amount;
        uint _balance = BalanceLib.balanceOf(_token, address(this));
        if (_balance < _held) revert Error.Escrow__Unfunded(_token, _balance, _held);
        heldMap[_token] = _held;
        escrowed_ = escrowedMap[_owner][_token] + _amount;
        escrowedMap[_owner][_token] = escrowed_;
        delete returnAtMap[_owner][_token];
    }

    function release(
        address _owner,
        address _body,
        address _token,
        uint _total,
        uint _feeTotal,
        address _feeReceiver,
        uint _gasLimit
    ) external auth {
        if (_body.codehash != accountModule.bodyHash()) revert Error.Account__NotDelegated(_body);
        (address _module, address _parent) = FundAccount(payable(_body)).bound();
        if (_module != address(accountModule) || _parent != _owner) revert Error.Account__HeaderMismatch(_body);
        uint _fulfilled = fulfilledMap[_owner][_body][_token];
        if (_total <= _fulfilled) revert Error.Escrow__InvalidFulfil(_fulfilled, _total);
        uint _amount = _total - _fulfilled;
        uint _fee = _feeTotal - feePaidMap[_owner][_body][_token];
        uint _released = releasedMap[_owner][_token];
        uint _open = escrowedMap[_owner][_token] - _released - returnedMap[_owner][_token];
        if (_amount > _open) revert Error.Balance__InsufficientBalance(_open, _amount);
        IntentLib.verifyRelayFeeRatio(_fee, _amount, maxFeeBps);
        fulfilledMap[_owner][_body][_token] = _total;
        feePaidMap[_owner][_body][_token] = _feeTotal;
        releasedMap[_owner][_token] = _released + _amount;
        heldMap[_token] -= _amount;
        if (_fee > 0) TransferUtils.transferStrictly(_token, _feeReceiver, _fee, _gasLimit);
        TransferUtils.transferStrictly(_token, _body, _amount - _fee, _gasLimit);
    }

    function requestReturn(
        address _owner,
        address _token
    ) external auth returns (uint returnAt_) {
        returnAt_ = block.timestamp + ESCROW_RETURN_DELAY;
        returnAtMap[_owner][_token] = returnAt_;
    }

    function refund(
        address _owner,
        address _token,
        uint _gasLimit
    ) external auth returns (uint returned_) {
        uint _returnAt = returnAtMap[_owner][_token];
        if (_returnAt == 0 || block.timestamp < _returnAt) revert Error.Escrow__ReturnNotReady(_returnAt);
        delete returnAtMap[_owner][_token];
        uint _returned = returnedMap[_owner][_token];
        uint _open = escrowedMap[_owner][_token] - releasedMap[_owner][_token] - _returned;
        if (_open == 0) revert Error.Balance__NothingToWithdraw();
        returned_ = _returned + _open;
        returnedMap[_owner][_token] = returned_;
        heldMap[_token] -= _open;
        TransferUtils.transferStrictly(_token, UserAccount(payable(_owner)).user(), _open, _gasLimit);
    }

    receive() external payable {}
}
