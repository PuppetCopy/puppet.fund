// This file is auto-generated from contracts/src/utils/Error.sol
// Do not edit manually.

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
    name: "Account__NotDeployed",
    inputs: [
      {
        name: "predicted",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Share__InvalidImpl",
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
    name: "Account__Shortfall",
    inputs: [
      {
        name: "token",
        internalType: "address",
        type: "address"
      },
      {
        name: "actual",
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
    name: "Account__OutflowExceedsSigned",
    inputs: [
      {
        name: "amountOut",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "signedSum",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Account__UnauthorizedDeploy",
    inputs: []
  },
  {
    type: "error",
    name: "Route__Unauthorized",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__ZeroAmount",
    inputs: []
  },
  {
    type: "error",
    name: "Module__InvalidAuthority",
    inputs: []
  },
  {
    type: "error",
    name: "Module__CallerNotAuthority",
    inputs: []
  },
  {
    type: "error",
    name: "Module__Reentrant",
    inputs: []
  },
  {
    type: "error",
    name: "Access__Unauthorized",
    inputs: []
  },
  {
    type: "error",
    name: "Permission__Unauthorized",
    inputs: []
  },
  {
    type: "error",
    name: "Dictate__ContractNotRegistered",
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
    name: "Register__InvalidImpl",
    inputs: []
  },
  {
    type: "error",
    name: "Register__InvalidToken",
    inputs: []
  },
  {
    type: "error",
    name: "Register__UnknownToken",
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
    name: "Register__WntNotSet",
    inputs: []
  },
  {
    type: "error",
    name: "Register__InvalidProvider",
    inputs: []
  },
  {
    type: "error",
    name: "Gate__InvalidModule",
    inputs: []
  },
  {
    type: "error",
    name: "Intent__InvalidChainId",
    inputs: [
      {
        name: "signed",
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
    name: "Intent__StaleSignature",
    inputs: [
      {
        name: "signedBlock",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "currentBlock",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "maxBlockDelay",
        internalType: "uint256",
        type: "uint256"
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
    name: "Intent__TokenNotRegistered",
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
    name: "Intent__ProviderNotAllowed",
    inputs: [
      {
        name: "provider",
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
    name: "Intent__RelayFeeExceedsCap",
    inputs: [
      {
        name: "actual",
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
    name: "Allocate__ZeroAmount",
    inputs: []
  },
  {
    type: "error",
    name: "Allocate__ZeroAcceptableNav",
    inputs: []
  },
  {
    type: "error",
    name: "Allocate__PreMintSupplyMismatch",
    inputs: [
      {
        name: "current",
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
    name: "Allocate__PuppetListNotSorted",
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
    name: "Allocate__ListLengthMismatch",
    inputs: [
      {
        name: "puppetsLen",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "bodiesLen",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "sigsLen",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "Mandate__EmptyRules",
    inputs: []
  },
  {
    type: "error",
    name: "Mandate__FundListNotSorted",
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
    name: "Mandate__SelfFund",
    inputs: [
      {
        name: "user",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Share__ZeroShares",
    inputs: []
  },
  {
    type: "error",
    name: "Share__ZeroWeightAdded",
    inputs: []
  },
  {
    type: "error",
    name: "Share__MasterCannotSell",
    inputs: []
  },
  {
    type: "error",
    name: "Share__Empty",
    inputs: []
  },
  {
    type: "error",
    name: "Share__RelayFeeTooHigh",
    inputs: []
  },
  {
    type: "error",
    name: "Share__NoWeightToCredit",
    inputs: []
  },
  {
    type: "error",
    name: "Share__CreditTooSmall",
    inputs: []
  },
  {
    type: "error",
    name: "Share__PoolDegraded",
    inputs: []
  },
  {
    type: "error",
    name: "Share__FundLiquidated",
    inputs: []
  },
  {
    type: "error",
    name: "Share__NotCreated",
    inputs: []
  },
  {
    type: "error",
    name: "Share__MasterMismatch",
    inputs: [
      {
        name: "derived",
        internalType: "address",
        type: "address"
      },
      {
        name: "declared",
        internalType: "address",
        type: "address"
      }
    ]
  },
  {
    type: "error",
    name: "Redeem__ZeroAcceptableNav",
    inputs: []
  },
  {
    type: "error",
    name: "Redeem__NothingToRetire",
    inputs: []
  },
  {
    type: "error",
    name: "Redeem__RelayFeeTooHigh",
    inputs: []
  },
  {
    type: "error",
    name: "Redeem__MasterSkinTooLow",
    inputs: []
  },
  {
    type: "error",
    name: "Redeem__DrainExceedsQueue",
    inputs: []
  },
  {
    type: "error",
    name: "Redeem__LiquidationRateTooSmall",
    inputs: []
  },
  {
    type: "error",
    name: "ShareToken__NotIssuer",
    inputs: []
  },
  {
    type: "error",
    name: "ShareToken__NotHubChain",
    inputs: [
      {
        name: "expected",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "current",
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
    name: "Balance__InvalidWithdraw",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__NothingToRecord",
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
    name: "Balance__RelayFeeTooHigh",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__ZeroSwapOutput",
    inputs: []
  },
  {
    type: "error",
    name: "Balance__InvalidDestinationChain",
    inputs: [
      {
        name: "expected",
        internalType: "uint256",
        type: "uint256"
      },
      {
        name: "provided",
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
    name: "NonceLib__InvalidNonceForAccount",
    inputs: [
      {
        name: "account",
        internalType: "address",
        type: "address"
      },
      {
        name: "nonce",
        internalType: "uint256",
        type: "uint256"
      }
    ]
  }
] as const
