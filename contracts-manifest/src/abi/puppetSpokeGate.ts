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
        "name": "_depositModule",
        "type": "address",
        "internalType": "contract Deposit"
      },
      {
        "name": "_escrowStore",
        "type": "address",
        "internalType": "contract EscrowStore"
      },
      {
        "name": "_config",
        "type": "tuple",
        "internalType": "struct GateConfig",
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
            "name": "maxSwapRelayFeeBps",
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
        "internalType": "struct Deposit.SwapIntent",
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
            "name": "destinationChainId",
            "type": "uint256",
            "internalType": "uint256"
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
          }
        ]
      },
      {
        "name": "_coSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "depositEscrow",
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
    "name": "escrowStore",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract EscrowStore"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "fulfil",
    "inputs": [
      {
        "name": "_body",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_total",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_feeTotal",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_ownerSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_genesis",
        "type": "tuple",
        "internalType": "struct AccountLib.Genesis",
        "components": [
          {
            "name": "parent",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "key",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "approval",
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
    "name": "fundSwap",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct Deposit.SwapIntent",
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
            "name": "destinationChainId",
            "type": "uint256",
            "internalType": "uint256"
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
          }
        ]
      },
      {
        "name": "_coSig",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_genesis",
        "type": "tuple",
        "internalType": "struct AccountLib.Genesis",
        "components": [
          {
            "name": "parent",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "key",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "approval",
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
        "internalType": "struct GateConfig",
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
            "name": "maxSwapRelayFeeBps",
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
        "internalType": "struct SpokeGate.OperateIntent",
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
          },
          {
            "name": "tokenList",
            "type": "address[]",
            "internalType": "address[]"
          }
        ]
      },
      {
        "name": "_coSig",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_genesis",
        "type": "tuple",
        "internalType": "struct AccountLib.Genesis",
        "components": [
          {
            "name": "parent",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "key",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "approval",
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
    "name": "requestReturn",
    "inputs": [
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "retireEscrow",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct LiquidityGate.RetireEscrowIntent",
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
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "_coSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "returnEscrow",
    "inputs": [
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
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
        "internalType": "struct Deposit.SwapIntent",
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
            "name": "destinationChainId",
            "type": "uint256",
            "internalType": "uint256"
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
          }
        ]
      },
      {
        "name": "_coSig",
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
    "name": "Account__NotDelegated",
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
    "name": "Gate__InvalidModule",
    "inputs": []
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
    "name": "Intent__DuplicateToken",
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
    "name": "Intent__ZeroRelayFee",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
] as const
