// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;


library Error {
    error Account__UnauthorizedCaller();
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
    error Account__WithdrawClosed(uint revokedAt);
    error Account__ForbiddenPull();

    error Access__InvalidAuthority();
    error Access__CallerNotAuthority();
    error Access__Reentrant();
    error Access__Unauthorized();

    error GovernorAccount__Forbidden(address caller);
    error GovernorAccount__CallFailed(bytes result);
    error GovernorAccount__ExpiredDeadline(uint deadline, uint currentTimestamp);
    error GovernorAccount__Locked();
    error GovernorAccount__NotSet();

    error TransferUtils__TokenTransferError(address token, address receiver, uint amount);
    error TransferUtils__TokenTransferFromError(address token, address from, address to, uint amount);
    error TransferUtils__InvalidReceiver();
    error TransferUtils__NativeTransferError(address receiver, uint amount);
    error TransferUtils__EmptyTokenTransferGasLimit(address token);

    error Gate__InvalidModule();
    error Gate__InvalidRelayFeeBps(uint maxRelayFeeBps);
    error Gate__InvalidCohortCap();
    error Gate__InvalidPerformanceFee(uint fee);
    error Gate__InvalidCanonicalToken(address token);
    error Gate__NoAttestorEndpoint();
    error Gate__ListTooLong(uint length, uint cap);

    error Intent__DuplicateToken(address token);
    error Intent__ExpiredDeadline(uint deadline, uint currentTimestamp);
    error Intent__DeadlineTooFar(uint deadline, uint currentTimestamp, uint maxIntentTtl);
    error Intent__ZeroRelayFee(address account);
    error Intent__RelayFeeRatioExceeded(uint actual, uint amount, uint maxBps);
    error Intent__FeeTokenMismatch(address signed, address actual);
    error Intent__InvalidProvider();

    error Mandate__ListNotSorted(address prev, address curr);
    error Mandate__InvalidAllocationRate(uint rate);
    error Mandate__InvalidSkin(uint skin);
    error Mandate__InvalidExitCap(uint exitCap);
    error Mandate__StaleEpoch(uint signedEpoch, uint epoch);
    error Mandate__Cooldown(address puppet, uint allocatedAt, uint cooldownPeriod);

    error Fund__CreditTokenMismatch(address credit, address round);
    error Fund__TokenNotCanonical(address token);
    error Fund__UnitPriceMismatch(uint amount, uint value);
    error Fund__InsufficientShares(uint held, uint required);
    error Fund__ShareMismatch(address master, address shareToken);
    error Fund__NotHolder(address holder);
    error Fund__AllocationListNotSorted(address prev, address curr);
    error Fund__NotAccount(address puppet);
    error Fund__CreditNotIncreasing(uint credited, uint total);
    error Fund__CreditFeeMismatch(uint signed, uint billed);

    error Redeem__Open(uint64 id);
    error Redeem__InvalidMode(uint fraction, uint join);
    error Redeem__JoinAboveSymmetry(uint join, uint cap);
    error Redeem__Dust(uint amount, uint fee);
    error Redeem__TokenUnpriced(address token);
    error Redeem__OutOfGas(uint left, uint needed);

    error Escrow__InvalidFulfil(uint fulfilled, uint submitted);
    error Escrow__Unfunded(address token, uint balance, uint held);
    error Escrow__ReturnNotReady(uint returnAt);

    error FundStore__Unfunded(address token, uint balance, uint held);
    error FundStore__Unbooked(address master, address token, uint booked, uint amount);

    error ShareToken__Forbidden();
    error ShareToken__InvalidSymbol(bytes32 symbol);
    error ShareToken__InvalidGrid(uint length);
    error ShareToken__InvalidPixel(uint cell, uint color);

    error Balance__ZeroAmount();
    error Balance__ValueMismatch(uint provided, uint expected);
    error Balance__NothingToWithdraw();
    error Balance__NothingToSwap();
    error Balance__InsufficientBalance(uint balance, uint required);
    error Balance__InsufficientFund(address token, uint balance, uint required);
    error Balance__ZeroSwapOutput();
    error Balance__SwapInputNotSpent(address token, uint balanceBefore, uint balanceAfter);
    error Balance__SwapOutputNotReceived(address outputToken, uint received, uint signed);
    error Balance__DepositNotReceived(address token, uint received, uint signed);
    error Balance__InvalidWithdraw();
    error Balance__InvalidDeposit();
    error Balance__InvalidSwap();

    error Token__InvalidReceiver();
}
