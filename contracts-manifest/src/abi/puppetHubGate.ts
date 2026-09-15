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
        "name": "_bondStore",
        "type": "address",
        "internalType": "contract BondStore"
      },
      {
        "name": "_bondToken",
        "type": "address",
        "internalType": "address"
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
      },
      {
        "name": "_bond",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "draw",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct HubGate.DrawIntent",
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
            "name": "spokeChainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "cycle",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "lossList",
            "type": "tuple[]",
            "internalType": "struct HubGate.Loss[]",
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
              }
            ]
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
    "name": "mandate",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct HubGate.MandateIntent",
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
            "name": "bond",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "mandateList",
            "type": "tuple[]",
            "internalType": "struct AccountLib.Mandate[]",
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
          },
          {
            "name": "signatureList",
            "type": "bytes[]",
            "internalType": "bytes[]"
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
    "name": "unbond",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct HubGate.UnbondIntent",
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
            "name": "amount",
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
    "name": "Account__InvalidSignature",
    "inputs": []
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
    "name": "Balance__InvalidDeposit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Balance__ZeroAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Bond__InsufficientBalance",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "held",
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
    "name": "Bond__WrongToken",
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
    "name": "Mandate__ListLengthMismatch",
    "inputs": [
      {
        "name": "mandates",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "signatures",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Mandate__ListNotSorted",
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
