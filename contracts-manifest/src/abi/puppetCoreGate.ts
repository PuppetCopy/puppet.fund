export default [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_accountModule",
        "type": "address",
        "internalType": "contract AccountModule"
      },
      {
        "name": "_register",
        "type": "address",
        "internalType": "contract Register"
      },
      {
        "name": "_depositModule",
        "type": "address",
        "internalType": "contract Deposit"
      },
      {
        "name": "_config",
        "type": "tuple",
        "internalType": "struct BaseGate.Config",
        "components": [
          {
            "name": "attestor",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feeReceiver",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "transferGasLimit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxIntentTtl",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxRelayFeeBps",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "performanceFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxCohortSize",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "credit",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_claim",
        "type": "tuple",
        "internalType": "struct Deposit.ScheduledCredit",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "fee",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "_claimSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_genesis",
        "type": "tuple",
        "internalType": "struct AccountLib.Genesis",
        "components": [
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "key",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "user",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "depositAcross",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct Deposit.DepositSwap",
        "components": [
          {
            "name": "header",
            "type": "tuple",
            "internalType": "struct AccountLib.IntentHeader",
            "components": [
              {
                "name": "account",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "user",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "nonce",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "feeToken",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "fee",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "swap",
            "type": "tuple",
            "internalType": "struct SwapLib.SwapParams",
            "components": [
              {
                "name": "inputToken",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "inputAmount",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "outputToken",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "outputAmount",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "provider",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "providerCallData",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "destinationChainId",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "_intentSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_genesis",
        "type": "tuple",
        "internalType": "struct AccountLib.Genesis",
        "components": [
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "key",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "user",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "depositModule",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Deposit"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "depositRoute",
    "inputs": [
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "getConfig",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct BaseGate.Config",
        "components": [
          {
            "name": "attestor",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feeReceiver",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "transferGasLimit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxIntentTtl",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxRelayFeeBps",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "performanceFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxCohortSize",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "operate",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct CoreGate.OperateIntent",
        "components": [
          {
            "name": "header",
            "type": "tuple",
            "internalType": "struct AccountLib.IntentHeader",
            "components": [
              {
                "name": "account",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "user",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "nonce",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "feeToken",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "fee",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "creditList",
            "type": "address[]",
            "internalType": "address[]"
          },
          {
            "name": "cycle",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "collateral",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "skin",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "backed",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "backingList",
            "type": "tuple[]",
            "internalType": "struct AccountLib.Backing[]",
            "components": [
              {
                "name": "puppet",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "matchable",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "stake",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "mandate",
                "type": "tuple",
                "internalType": "struct AccountLib.Mandate",
                "components": [
                  {
                    "name": "master",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "skin",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "allocationRate",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "cooldownPeriod",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "expiry",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "tokenIdList",
                    "type": "bytes32[]",
                    "internalType": "bytes32[]"
                  }
                ]
              }
            ]
          },
          {
            "name": "callList",
            "type": "tuple[]",
            "internalType": "struct IAccount.Call[]",
            "components": [
              {
                "name": "target",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "value",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "gasLimit",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "callData",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          }
        ]
      },
      {
        "name": "_intentSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settle",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct CoreGate.SettleIntent",
        "components": [
          {
            "name": "header",
            "type": "tuple",
            "internalType": "struct AccountLib.IntentHeader",
            "components": [
              {
                "name": "account",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "user",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "nonce",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "feeToken",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "fee",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "cycle",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "gainList",
            "type": "tuple[]",
            "internalType": "struct CoreGate.Outcome[]",
            "components": [
              {
                "name": "puppet",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "amount",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "mandate",
                "type": "tuple",
                "internalType": "struct AccountLib.Mandate",
                "components": [
                  {
                    "name": "master",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "skin",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "allocationRate",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "cooldownPeriod",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "expiry",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "tokenIdList",
                    "type": "bytes32[]",
                    "internalType": "bytes32[]"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "name": "_intentSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct CoreGate.WithdrawIntent",
        "components": [
          {
            "name": "header",
            "type": "tuple",
            "internalType": "struct AccountLib.IntentHeader",
            "components": [
              {
                "name": "account",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "user",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "nonce",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "feeToken",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "fee",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "swap",
            "type": "tuple",
            "internalType": "struct SwapLib.SwapParams",
            "components": [
              {
                "name": "inputToken",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "inputAmount",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "outputToken",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "outputAmount",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "provider",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "providerCallData",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "destinationChainId",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "_intentSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "error",
    "name": "Account__HeaderMismatch",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Account__InvalidUser",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Account__NonceMismatch",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Account__UnauthorizedCaller",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Balance__InsufficientBalance",
    "inputs": [
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "required",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Balance__InvalidWithdraw",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Balance__NothingToSwap",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Balance__NothingToWithdraw",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Balance__SwapOutputNotReceived",
    "inputs": [
      {
        "name": "outputToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "signed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Balance__ZeroSwapOutput",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Credit__ListNotSorted",
    "inputs": [
      {
        "name": "prev",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "curr",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Gate__InvalidAllocationRate",
    "inputs": [
      {
        "name": "rate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Gate__InvalidCohortCap",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Gate__InvalidModule",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Gate__InvalidPerformanceFee",
    "inputs": [
      {
        "name": "fee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Gate__InvalidRelayFeeBps",
    "inputs": [
      {
        "name": "maxRelayFeeBps",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Gate__ListTooLong",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Gate__MasterAsPuppet",
    "inputs": [
      {
        "name": "master",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__AmountExceedsCap",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__DeadlineTooFar",
    "inputs": [
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentTimestamp",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxIntentTtl",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__ExpiredDeadline",
    "inputs": [
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentTimestamp",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__FeeTokenMismatch",
    "inputs": [
      {
        "name": "signed",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "actual",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__InvalidProvider",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Intent__RelayFeeRatioExceeded",
    "inputs": [
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBps",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__TokenNotValuable",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__ZeroRelayFee",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Mandate__Expired",
    "inputs": [
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Mandate__Mismatch",
    "inputs": [
      {
        "name": "puppet",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "digest",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "Mandate__TokenNotListed",
    "inputs": [
      {
        "name": "puppet",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Operate__BackingExceedsCap",
    "inputs": [
      {
        "name": "puppet",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "stake",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Operate__BackingListNotSorted",
    "inputs": [
      {
        "name": "prev",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "curr",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Operate__BackingListTooLong",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Operate__SkinExceeded",
    "inputs": [
      {
        "name": "backed",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "collateral",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Settle__RowsNotSorted",
    "inputs": [
      {
        "name": "prev",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "curr",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
] as const
