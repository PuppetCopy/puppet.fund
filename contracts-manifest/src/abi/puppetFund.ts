export default [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_authority",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_accountModule",
        "type": "address",
        "internalType": "contract AccountModule"
      },
      {
        "name": "_mandateStore",
        "type": "address",
        "internalType": "contract MandateStore"
      },
      {
        "name": "_fundStore",
        "type": "address",
        "internalType": "contract FundStore"
      },
      {
        "name": "_escrowStore",
        "type": "address",
        "internalType": "contract EscrowStore"
      },
      {
        "name": "_shareImpl",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_wnt",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "accountModule",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract AccountModule"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "allocate",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct Fund.AllocateIntent",
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
            "name": "shareToken",
            "type": "address",
            "internalType": "contract ShareToken"
          },
          {
            "name": "valuation",
            "type": "tuple",
            "internalType": "struct Fund.Valuation",
            "components": [
              {
                "name": "assetList",
                "type": "tuple[]",
                "internalType": "struct Fund.Asset[]",
                "components": [
                  {
                    "name": "chainId",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "token",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "id",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "amount",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "value",
                    "type": "uint256",
                    "internalType": "uint256"
                  }
                ]
              },
              {
                "name": "positionList",
                "type": "tuple[]",
                "internalType": "struct Fund.Position[]",
                "components": [
                  {
                    "name": "chainId",
                    "type": "uint256",
                    "internalType": "uint256"
                  },
                  {
                    "name": "venue",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "id",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "value",
                    "type": "uint256",
                    "internalType": "uint256"
                  }
                ]
              }
            ]
          },
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
            "type": "tuple",
            "internalType": "struct Fund.Price",
            "components": [
              {
                "name": "amount",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "value",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "credit",
            "type": "tuple",
            "internalType": "struct Fund.Credit",
            "components": [
              {
                "name": "chainId",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "total",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "feeTotal",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "allocationList",
            "type": "tuple[]",
            "internalType": "struct Fund.Allocation[]",
            "components": [
              {
                "name": "puppet",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "mandate",
                "type": "tuple",
                "internalType": "struct MandateLib.Mandate",
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
                    "name": "exitCap",
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
                  }
                ]
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
        "name": "_structHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_valuation",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_coSig",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_ownerSignature",
        "type": "bytes",
        "internalType": "bytes"
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
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "authMap",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "selector",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "authority",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
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
    "name": "fundStore",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract FundStore"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "mandateStore",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract MandateStore"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setAccess",
    "inputs": [
      {
        "name": "_user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_selector",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "shareImpl",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "wnt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "error",
    "name": "Access__CallerNotAuthority",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Access__InvalidAuthority",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Access__Reentrant",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Access__Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Account__InvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Balance__ZeroAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Fund__AllocationListNotSorted",
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
    "name": "Fund__CreditFeeMismatch",
    "inputs": [
      {
        "name": "signed",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "billed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Fund__CreditNotIncreasing",
    "inputs": [
      {
        "name": "credited",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "total",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Fund__CreditTokenMismatch",
    "inputs": [
      {
        "name": "credit",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "round",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Fund__NotAccount",
    "inputs": [
      {
        "name": "puppet",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Fund__UnitPriceMismatch",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Gate__InvalidModule",
    "inputs": []
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
    "name": "Mandate__Cooldown",
    "inputs": [
      {
        "name": "puppet",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allocatedAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cooldownPeriod",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Redeem__Open",
    "inputs": [
      {
        "name": "id",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "SafeCastOverflowedUintDowncast",
    "inputs": [
      {
        "name": "bits",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  }
] as const
