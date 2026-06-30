// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Single source of protocol-wide custom errors. Names follow
/// `Module__Reason`; consumers (UI, indexer, matchmaker) decode revert data
/// against this surface.
library Error {
    error Account__UnauthorizedCaller();
    error Account__ForbiddenTarget(address target);
    error Account__NotDeployed(address predicted);
    error Share__InvalidImpl();
    error Account__InvalidUser();
    error Account__InvalidSignature();
    error Account__Shortfall(address token, uint actual, uint expected);
    error Account__OutflowExceedsSigned(uint amountOut, uint signedSum);
    error Account__UnauthorizedDeploy();

    error Route__Unauthorized();

    error Balance__ZeroAmount();

    error Module__InvalidAuthority();
    error Module__CallerNotAuthority();
    error Module__Reentrant();

    error Access__Unauthorized();

    error Permission__Unauthorized();

    error Dictate__ContractNotRegistered();
    error Dictate__InvalidOwner();
    error Dictate__Unauthorized();

    error Register__InvalidImpl();
    error Register__InvalidToken();
    error Register__UnknownToken(address token);
    error Register__WntNotSet();
    error Register__InvalidProvider();

    error Gate__InvalidModule();

    error Intent__InvalidChainId(uint signed, uint expected);
    error Intent__StaleSignature(uint signedBlock, uint currentBlock, uint maxBlockDelay);
    error Intent__ExpiredDeadline(uint deadline, uint currentTimestamp);
    error Intent__TokenNotRegistered(address token);
    error Intent__ProviderNotAllowed(address provider);
    error Intent__AmountExceedsCap(uint amount, uint cap);
    error Intent__RelayFeeExceedsCap(uint actual, uint cap);
    error Intent__RelayFeeRatioExceeded(uint actual, uint amount, uint maxBps);

    error Allocate__ZeroAmount();
    error Allocate__ZeroAcceptableNav();
    error Allocate__PreMintSupplyMismatch(uint current, uint expected);
    error Allocate__PuppetListNotSorted(address prev, address curr);
    error Allocate__ListLengthMismatch(uint puppetsLen, uint bodiesLen, uint sigsLen);

    error Mandate__EmptyRules();
    error Mandate__FundListNotSorted(address prev, address curr);
    error Mandate__SelfFund(address user);

    error Share__ZeroShares();
    error Share__ZeroWeightAdded();
    error Share__MasterCannotSell();
    error Share__Empty();
    error Share__RelayFeeTooHigh();
    error Share__NoWeightToCredit();
    error Share__CreditTooSmall();
    error Share__PoolDegraded();
    error Share__FundLiquidated();
    error Share__NotCreated();
    error Share__MasterMismatch(address derived, address declared);

    error Redeem__ZeroAcceptableNav();
    error Redeem__NothingToRetire();
    error Redeem__RelayFeeTooHigh();
    error Redeem__MasterSkinTooLow();
    error Redeem__DrainExceedsQueue();
    error Redeem__LiquidationRateTooSmall();

    error ShareToken__NotIssuer();
    error ShareToken__NotHubChain(uint expected, uint current);

    error Balance__NothingToWithdraw();
    error Balance__InvalidWithdraw();
    error Balance__NothingToRecord();
    error Balance__NothingToSwap();
    error Balance__InsufficientBalance(uint balance, uint required);
    error Balance__RelayFeeTooHigh();
    error Balance__ZeroSwapOutput();
    error Balance__InvalidDestinationChain(uint expected, uint provided);

    error TransferUtils__TokenTransferError(IERC20 token, address receiver, uint amount);
    error TransferUtils__TokenTransferFromError(IERC20 token, address from, address to, uint amount);
    error TransferUtils__InvalidReceiver();
    error TransferUtils__EmptyTokenTransferGasLimit(IERC20 token);

    error NonceLib__InvalidNonceForAccount(address account, uint nonce);
}
