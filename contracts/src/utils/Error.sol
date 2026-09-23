// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library Error {
    error Account__UnauthorizedCaller();
    error Account__WithdrawNotOpen(uint requestedAt, uint delay);
    error Account__ForbiddenTarget(address target);
    error Account__InvalidImpl();
    error Account__InvalidUser();
    error Account__InvalidSignature();
    error Account__NonceMismatch(address account, uint expected, uint actual);
    error Account__AlreadyCreated();
    error Account__Executing();
    error Account__CallReturnedFalse(address target);
    error Account__NotDelegated(address account);
    error Account__HeaderMismatch(address account);


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

    error Intent__DuplicateToken(address token);
    error Intent__ExpiredDeadline(uint deadline, uint currentTimestamp);
    error Intent__DeadlineTooFar(uint deadline, uint currentTimestamp, uint maxIntentTtl);
    error Intent__ZeroRelayFee(address account);
    error Intent__RelayFeeRatioExceeded(uint actual, uint amount, uint maxBps);
    error Intent__FeeTokenMismatch(address signed, address actual);
    error Intent__TokenNotValuable(address token);
    error Intent__InvalidProvider();

    error Mandate__ListNotSorted(address prev, address curr);
    error Mandate__ListLengthMismatch(uint mandates, uint signatures);
    error Mandate__InvalidAllocationRate(uint rate);
    error Mandate__InvalidSkin(uint skin);
    error Mandate__Cooldown(address puppet, uint allocatedAt, uint cooldownPeriod);

    error Fund__CreditTokenMismatch(address credit, address round);
    error Fund__InsufficientUnits(uint held, uint required);
    error Fund__DrainExceedsQueue(uint drain, uint queued);
    error Fund__DrainLeavesDust(uint queued, uint floor);
    error Fund__ShareMismatch(address master, address share);
    error Escrow__InvalidFulfil(uint fulfilled, uint submitted);
    error Escrow__RefundClosed();
    error Fund__FeeUnfunded(uint amount, uint fee);
    error Fund__ZeroDrain();
    error Fund__NothingToClaim(address holder);
    error Fund__SkinBelowFloor(uint masterUnits, uint exposedUnits, uint skin);
    error Fund__NativeRowsUnsupported(uint rows);
    error Fund__AllocationListNotSorted(address prev, address curr);

    error Share__NotIssuer();
    error Share__InvalidSymbol(bytes32 symbol);
    error Share__InvalidGrid(uint length);
    error Share__InvalidPixel(uint cell, uint color);


    error Balance__ZeroAmount();
    error Balance__ValueMismatch(uint provided, uint expected);
    error Balance__NothingToWithdraw();
    error Balance__NothingToSwap();
    error Balance__InsufficientBalance(uint balance, uint required);
    error Balance__InsufficientFund(address token, uint balance, uint required);
    error Balance__ZeroSwapOutput();
    error Balance__SwapOutputNotReceived(address outputToken, uint received, uint signed);
    error Balance__DepositNotReceived(address token, uint received, uint signed);
    error Balance__InvalidWithdraw();
    error Balance__InvalidDeposit();
    error Balance__InvalidSwap();
}
