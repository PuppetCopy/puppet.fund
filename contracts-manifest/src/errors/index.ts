export const puppetErrorAbi = [
  {
    type: "error",
    name: "Account__UnauthorizedCaller",
    inputs: []
  },
  {
    type: "error",
    name: "Account__ForbiddenTarget",
    inputs: [
      {
        name: "target",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Account__InvalidImpl",
    inputs: []
  },
  {
    type: "error",
    name: "Account__InvalidUser",
    inputs: []
  },
  {
    type: "error",
    name: "Account__InvalidSignature",
    inputs: []
  },
  {
    type: "error",
    name: "Account__NonceMismatch",
    inputs: [
      {
        name: "account",
        internalType: "address",
        type: "address"
      },
      {
        name: "expected",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "actual",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Account__AlreadyCreated",
    inputs: []
  },
  {
    type: "error",
    name: "Account__Executing",
    inputs: []
  },
  {
    type: "error",
    name: "Account__CallReturnedFalse",
    inputs: [
      {
        name: "target",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Account__NotDelegated",
    inputs: [
      {
        name: "account",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Account__HeaderMismatch",
    inputs: [
      {
        name: "account",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Account__WithdrawClosed",
    inputs: [
      {
        name: "revokedAt",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Account__ForbiddenPull",
    inputs: []
  },
  {
    type: "error",
    name: "Chain__Locked",
    inputs: []
  },
  {
    type: "error",
    name: "Chain__NotSet",
    inputs: []
  },
  {
    type: "error",
    name: "Access__InvalidAuthority",
    inputs: []
  },
  {
    type: "error",
    name: "Access__CallerNotAuthority",
    inputs: []
  },
  {
    type: "error",
    name: "Access__Reentrant",
    inputs: []
  },
  {
    type: "error",
    name: "Access__Unauthorized",
    inputs: []
  },
  {
    type: "error",
    name: "GovernorAccount__Forbidden",
    inputs: [
      {
        name: "caller",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "GovernorAccount__CallFailed",
    inputs: [
      {
        name: "result",
        internalType: "bytes",
        type: "bytes"
      }
    ]
  },
  {
    type: "error",
    name: "GovernorAccount__ExpiredDeadline",
    inputs: [
      {
        name: "deadline",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "currentTimestamp",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "TransferUtils__TokenTransferError",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "receiver",
        internalType: "address",
        type: "address"
      },
      {
        name: "amount",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "TransferUtils__TokenTransferFromError",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "from",
        internalType: "address",
        type: "address"
      },
      {
        name: "to",
        internalType: "address",
        type: "address"
      },
      {
        name: "amount",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "TransferUtils__InvalidReceiver",
    inputs: []
  },
  {
    type: "error",
    name: "TransferUtils__NativeTransferError",
    inputs: [
      {
        name: "receiver",
        internalType: "address",
        type: "address"
      },
      {
        name: "amount",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "TransferUtils__EmptyTokenTransferGasLimit",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Gate__InvalidModule",
    inputs: []
  },
  {
    type: "error",
    name: "Gate__InvalidRelayFeeBps",
    inputs: [
      {
        name: "maxRelayFeeBps",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Gate__InvalidCohortCap",
    inputs: []
  },
  {
    type: "error",
    name: "Gate__InvalidPerformanceFee",
    inputs: [
      {
        name: "fee",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Gate__InvalidCanonicalToken",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Gate__NoAttestorEndpoint",
    inputs: []
  },
  {
    type: "error",
    name: "Gate__ListTooLong",
    inputs: [
      {
        name: "length",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "cap",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Intent__DuplicateToken",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Intent__ExpiredDeadline",
    inputs: [
      {
        name: "deadline",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "currentTimestamp",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Intent__DeadlineTooFar",
    inputs: [
      {
        name: "deadline",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "currentTimestamp",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "maxIntentTtl",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Intent__ZeroRelayFee",
    inputs: [
      {
        name: "account",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Intent__RelayFeeRatioExceeded",
    inputs: [
      {
        name: "actual",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "amount",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "maxBps",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Intent__FeeTokenMismatch",
    inputs: [
      {
        name: "signed",
        internalType: "address",
        type: "address"
      },
      {
        name: "actual",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Intent__InvalidProvider",
    inputs: []
  },
  {
    type: "error",
    name: "Mandate__ListNotSorted",
    inputs: [
      {
        name: "prev",
        internalType: "address",
        type: "address"
      },
      {
        name: "curr",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Mandate__InvalidAllocationRate",
    inputs: [
      {
        name: "rate",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Mandate__InvalidSkin",
    inputs: [
      {
        name: "skin",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Mandate__InvalidExitCap",
    inputs: [
      {
        name: "exitCap",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Mandate__StaleEpoch",
    inputs: [
      {
        name: "signedEpoch",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "epoch",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Mandate__Cooldown",
    inputs: [
      {
        name: "puppet",
        internalType: "address",
        type: "address"
      },
      {
        name: "allocatedAt",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "cooldownPeriod",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__CreditTokenMismatch",
    inputs: [
      {
        name: "credit",
        internalType: "address",
        type: "address"
      },
      {
        name: "round",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__TokenNotCanonical",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__UnitPriceMismatch",
    inputs: [
      {
        name: "amount",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "value",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__InsufficientShares",
    inputs: [
      {
        name: "held",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "required",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__ShareMismatch",
    inputs: [
      {
        name: "master",
        internalType: "address",
        type: "address"
      },
      {
        name: "shareToken",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__NotHolder",
    inputs: [
      {
        name: "holder",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__AllocationListNotSorted",
    inputs: [
      {
        name: "prev",
        internalType: "address",
        type: "address"
      },
      {
        name: "curr",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__NotAccount",
    inputs: [
      {
        name: "puppet",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__CreditNotIncreasing",
    inputs: [
      {
        name: "credited",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "total",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Fund__CreditFeeMismatch",
    inputs: [
      {
        name: "signed",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "billed",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Redeem__Open",
    inputs: [
      {
        name: "id",
        internalType: "uint64",
        type: "uint64"
      }
    ]
  },
  {
    type: "error",
    name: "Redeem__InvalidMode",
    inputs: [
      {
        name: "fraction",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "join",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Redeem__JoinAboveSymmetry",
    inputs: [
      {
        name: "join",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "cap",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Redeem__Dust",
    inputs: [
      {
        name: "amount",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "fee",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Redeem__TokenUnpriced",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Redeem__OutOfGas",
    inputs: [
      {
        name: "left",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "needed",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Escrow__InvalidFulfil",
    inputs: [
      {
        name: "fulfilled",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "submitted",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Escrow__Unfunded",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "balance",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "held",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Escrow__ReturnNotReady",
    inputs: [
      {
        name: "returnAt",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "FundStore__Unfunded",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "balance",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "held",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "FundStore__Unbooked",
    inputs: [
      {
        name: "master",
        internalType: "address",
        type: "address"
      },
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "booked",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "amount",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "ShareToken__Forbidden",
    inputs: []
  },
  {
    type: "error",
    name: "ShareToken__InvalidSymbol",
    inputs: [
      {
        name: "symbol",
        internalType: "bytes32",
        type: "bytes32"
      }
    ]
  },
  {
    type: "error",
    name: "ShareToken__InvalidGrid",
    inputs: [
      {
        name: "length",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "ShareToken__InvalidPixel",
    inputs: [
      {
        name: "cell",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "color",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Balance__ZeroAmount",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__ValueMismatch",
    inputs: [
      {
        name: "provided",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "expected",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Balance__NothingToWithdraw",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__NothingToSwap",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__InsufficientBalance",
    inputs: [
      {
        name: "balance",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "required",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Balance__InsufficientFund",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "balance",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "required",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Balance__ZeroSwapOutput",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__SwapInputNotSpent",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "balanceBefore",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "balanceAfter",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Balance__SwapOutputNotReceived",
    inputs: [
      {
        name: "outputToken",
        internalType: "address",
        type: "address"
      },
      {
        name: "received",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "signed",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Balance__DepositNotReceived",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "received",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "signed",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Balance__InvalidWithdraw",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__InvalidDeposit",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__InvalidSwap",
    inputs: []
  },
  {
    type: "error",
    name: "Token__InvalidReceiver",
    inputs: []
  }
] as const
