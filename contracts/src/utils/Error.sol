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
    error Account__InvalidGate();
    error Share__InvalidImpl();
    error Account__InvalidUser();
    error Account__InvalidBaseTokenId();
    error Account__InvalidSignature();
    error Account__InvalidFlow();
    error Account__Shortfall(uint actual, uint expected);
    error Account__OutflowExceedsSigned(uint amountOut, uint signedSum);
    error Account__UnauthorizedDeploy();

    error TransientRoute__Unauthorized();

    error WalletDeposit__ZeroAmount();
    error WalletDeposit__UnregisteredToken();

    error Attest__InvalidAttestor();

    error Module__InvalidAuthority();
    error Module__CallerNotAuthority();
    error Module__Reentrant();

    error Access__Unauthorized();

    error Permission__Unauthorized();

    error Dictate__ContractNotRegistered();
    error Dictate__ContractAlreadyInitialized();
    error Dictate__ConfigurationUpdateFailed();
    error Dictate__InvalidModule();
    error Dictate__InvalidOwner();
    error Dictate__Unauthorized();
    error Dictate__ModuleAlreadyRegistered(bytes32 moduleId);

    error Register__InvalidImpl();
    error Register__InvalidHubToken();
    error Register__SelfHubTokenOnSpoke(uint chainId, address token);
    error Register__UnknownBaseTokenId(bytes32 baseTokenId);
    error Register__WntNotSet();

    error Gate__InvalidModule();

    error Intent__InvalidChainId(uint signed, uint expected);
    error Intent__StaleSignature(uint signedBlock, uint currentBlock, uint maxBlockDelay);
    error Intent__ExpiredDeadline(uint deadline, uint currentTimestamp);
    error Intent__TokenNotRegistered(bytes32 baseTokenId);
    error Intent__TokenMismatch(bytes32 baseTokenId, address expected, address actual);
    error Intent__AmountExceedsCap(uint amount, uint cap);
    error Intent__RelayFeeExceedsCap(uint actual, uint cap);
    error Intent__RelayFeeRatioExceeded(uint actual, uint amount, uint maxBps);
    error Intent__FeeReceiverZero();

    error Allocate__ZeroAmount();
    error Allocate__ZeroAcceptableNav();
    error Allocate__PreMintSupplyMismatch(uint current, uint expected);
    error Allocate__PostMintSupplyMismatch(uint current, uint expected);
    error Allocate__PuppetListNotSorted(address prev, address curr);
    error Allocate__ListLengthMismatch(uint puppetsLen, uint bodiesLen, uint sigsLen);

    error Operate__ExitsPending(uint signedBalance, uint totalStake);

    error Subscribe__EmptyRules();
    error Subscribe__MasterListNotSorted(address prev, address curr);
    error Subscribe__BaseTokenMismatch(bytes32 puppetBaseTokenId, bytes32 masterBaseTokenId);
    error Subscribe__SelfSubscribe(address user);

    error Share__ZeroShares();
    error Share__ZeroStakeAdded();
    error Share__Empty();
    error Share__InsufficientClaimable();
    error Share__RelayFeeTooHigh();
    error Share__NoStakeToCredit();

    error Fulfill__ZeroAcceptableNav();
    error Fulfill__SupplyMismatch(uint current, uint expected);
    error Fulfill__NothingToRetire();
    error Fulfill__RelayFeeTooHigh();

    error ShareToken__NotShareGate();
    error ShareToken__NotHubChain(uint expected, uint current);

    error Deposit__NothingToWithdraw();
    error Deposit__NothingToRecord();
    error Deposit__BaseTokenMismatch(bytes32 baseTokenId, address expected, address received);
    error Deposit__NothingToBridge();
    error Deposit__InsufficientBalance(uint balance, uint required);
    error Deposit__RelayFeeTooHigh();
    error Deposit__ZeroBridgeOutput();
    error Deposit__SameChainBridge(uint destinationChainId);
    error Deposit__InvalidDestinationChain(uint expected, uint provided);

    error TransferUtils__TokenTransferError(IERC20 token, address receiver, uint amount);
    error TransferUtils__TokenTransferFromError(IERC20 token, address from, address to, uint amount);
    error TransferUtils__InvalidReceiver();
    error TransferUtils__EmptyTokenTransferGasLimit(IERC20 token);

    error NonceLib__InvalidNonce(uint nonce);
    error NonceLib__InvalidNonceForAccount(address account, uint nonce);
}
