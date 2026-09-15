// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library Error {
    error Schedule__Expired(uint expiry, uint timestamp);
    error Schedule__NotArrived(address token, uint held, uint amount);

    error Account__UnauthorizedCaller();
    error Account__ForbiddenTarget(address target);
    error Account__InvalidImpl();
    error Account__InvalidUser();
    error Account__SessionExpired(uint expiry, uint nowTs);
    error Account__SessionTooLong(uint expiry, uint maxTtl);
    error Account__InvalidResetPeriod();
    error Account__InvalidSignature();
    error Account__NonceMismatch(address account, uint expected, uint actual);
    error Account__AlreadyCreated();
    error Account__ReentrantCall();
    error Account__NotDelegated(address account);
    error Account__HeaderMismatch(address account);
    error Account__AttestorAlive(uint quietSince);
    error Account__DigestConsumed(bytes32 digest);

    error Chain__Locked();
    error Chain__NotSet();

    error Access__InvalidAuthority();
    error Access__CallerNotAuthority();
    error Access__Reentrant();
    error Access__Unauthorized();

    error Dictate__InvalidOwner();
    error Dictate__Unauthorized();

    error Register__InvalidToken();

    error TransferUtils__TokenTransferError(IERC20 token, address receiver, uint amount);
    error TransferUtils__TokenTransferFromError(IERC20 token, address from, address to, uint amount);
    error TransferUtils__InvalidReceiver();
    error TransferUtils__NativeTransferError(address receiver, uint amount);
    error TransferUtils__EmptyTokenTransferGasLimit(IERC20 token);

    error Gate__InvalidModule();
    error Gate__InvalidRelayFeeBps(uint maxRelayFeeBps);
    error Gate__InvalidPerformanceFee(uint fee);
    error Gate__InvalidCohortCap();
    error Gate__ListTooLong(uint length, uint cap);
    error Gate__InvalidAllocationRate(uint rate);
    error Gate__MasterAsPuppet(address master);

    error Intent__ExpiredDeadline(uint deadline, uint currentTimestamp);
    error Intent__DeadlineTooFar(uint deadline, uint currentTimestamp, uint maxIntentTtl);
    error Intent__ZeroRelayFee(address account);
    error Intent__RelayFeeRatioExceeded(uint actual, uint amount, uint maxBps);
    error Intent__FeeTokenMismatch(address signed, address actual);
    error Intent__TokenNotValuable(address token);
    error Intent__AmountExceedsCap(uint amount, uint cap);
    error Intent__InvalidProvider();

    error Mandate__Mismatch(address puppet, bytes32 digest);
    error Mandate__Expired(uint expiry);
    error Mandate__ListNotSorted(address prev, address curr);
    error Mandate__ListLengthMismatch(uint mandates, uint signatures);
    error Mandate__TokenNotListed(address puppet, address token);

    error Bond__InsufficientBalance(address account, uint held, uint required);
    error Bond__WrongToken(address token);
    error Bond__CycleAlreadyDrawn(address master, uint spokeChainId, uint cycle);

    error Credit__ListNotSorted(address prev, address curr);

    error Settle__RowsNotSorted(address prev, address curr);

    error Balance__ZeroAmount();
    error Balance__ValueMismatch(uint provided, uint expected);
    error Balance__NothingToWithdraw();
    error Balance__NothingToSweep();
    error Balance__NothingToSwap();
    error Balance__InsufficientBalance(uint balance, uint required);
    error Balance__ZeroSwapOutput();
    error Balance__SwapOutputNotReceived(address outputToken, uint received, uint signed);
    error Balance__DepositNotReceived(address token, uint received, uint signed);
    error Balance__InvalidWithdraw();
    error Balance__InvalidDeposit();

    error Operate__BackingListTooLong(uint length, uint cap);
    error Operate__BackingListNotSorted(address prev, address curr);
    error Operate__BackingExceedsCap(address puppet, uint stake, uint cap);
    error Operate__SkinExceeded(uint backed, uint collateral);
}
