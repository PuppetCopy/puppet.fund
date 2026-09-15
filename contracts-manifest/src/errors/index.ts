export const puppetErrorAbi = [
  {
    type: "error",
    name: "Schedule__Expired",
    inputs: [
      {
        name: "expiry",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "timestamp",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Schedule__NotArrived",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "held",
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
    name: "Account__SessionExpired",
    inputs: [
      {
        name: "expiry",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "nowTs",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Account__SessionTooLong",
    inputs: [
      {
        name: "expiry",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "maxTtl",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Account__InvalidResetPeriod",
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
    name: "Account__ReentrantCall",
    inputs: []
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
    name: "Account__AttestorAlive",
    inputs: [
      {
        name: "quietSince",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Account__DigestConsumed",
    inputs: [
      {
        name: "digest",
        internalType: "bytes32",
        type: "bytes32"
      }
    ]
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
    name: "Dictate__InvalidOwner",
    inputs: []
  },
  {
    type: "error",
    name: "Dictate__Unauthorized",
    inputs: []
  },
  {
    type: "error",
    name: "Register__InvalidToken",
    inputs: []
  },
  {
    type: "error",
    name: "TransferUtils__TokenTransferError",
    inputs: [
      {
        name: "token",
        internalType: "contract IERC20",
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
        internalType: "contract IERC20",
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
        internalType: "contract IERC20",
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
    name: "Gate__InvalidCohortCap",
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
    name: "Gate__InvalidAllocationRate",
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
    name: "Gate__MasterAsPuppet",
    inputs: [
      {
        name: "master",
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
    name: "Intent__TokenNotValuable",
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
    name: "Intent__AmountExceedsCap",
    inputs: [
      {
        name: "amount",
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
    name: "Intent__InvalidProvider",
    inputs: []
  },
  {
    type: "error",
    name: "Mandate__Mismatch",
    inputs: [
      {
        name: "puppet",
        internalType: "address",
        type: "address"
      },
      {
        name: "digest",
        internalType: "bytes32",
        type: "bytes32"
      }
    ]
  },
  {
    type: "error",
    name: "Mandate__Expired",
    inputs: [
      {
        name: "expiry",
        internalType: "uint256",
        type: "uint256"
      }
    ]
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
    name: "Mandate__ListLengthMismatch",
    inputs: [
      {
        name: "mandates",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "signatures",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Mandate__TokenNotListed",
    inputs: [
      {
        name: "puppet",
        internalType: "address",
        type: "address"
      },
      {
        name: "token",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Bond__InsufficientBalance",
    inputs: [
      {
        name: "account",
        internalType: "address",
        type: "address"
      },
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
    name: "Bond__WrongToken",
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
    name: "Bond__CycleAlreadyDrawn",
    inputs: [
      {
        name: "master",
        internalType: "address",
        type: "address"
      },
      {
        name: "spokeChainId",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "cycle",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Credit__ListNotSorted",
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
    name: "Settle__RowsNotSorted",
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
    name: "Balance__NothingToSweep",
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
    name: "Balance__ZeroSwapOutput",
    inputs: []
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
    name: "Operate__BackingListTooLong",
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
    name: "Operate__BackingListNotSorted",
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
    name: "Operate__BackingExceedsCap",
    inputs: [
      {
        name: "puppet",
        internalType: "address",
        type: "address"
      },
      {
        name: "stake",
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
    name: "Operate__SkinExceeded",
    inputs: [
      {
        name: "backed",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "collateral",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  }
] as const
