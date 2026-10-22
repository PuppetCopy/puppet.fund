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
        "name": "_fundModule",
        "type": "address",
        "internalType": "contract Fund"
      },
      {
        "name": "_redeemModule",
        "type": "address",
        "internalType": "contract Redeem"
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
      },
      {
        "name": "_attestorEndpointList",
        "type": "string[]",
        "internalType": "string[]"
      },
      {
        "name": "_canonicalTokenList",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "_maxCohortSize",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_performanceFee",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_websiteRelease",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
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
        "name": "_coSig",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_ownerSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "attestorEndpoints",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string[]",
        "internalType": "string[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createFund",
    "inputs": [
      {
        "name": "_symbol",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_pixels",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_keySignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_approval",
        "type": "bytes",
        "internalType": "bytes"
      },
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
        "name": "_coSig",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_ownerSignature",
        "type": "bytes",
        "internalType": "bytes"
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
    "name": "fundModule",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Fund"
      }
    ],
    "stateMutability": "view"
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
    "name": "isCanonical",
    "inputs": [
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
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
            "name": "epoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "mandateList",
            "type": "tuple[]",
            "internalType": "struct MandateLib.Mandate[]",
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
    "name": "maxCohortSize",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "performanceFee",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "redeem",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct Redeem.RedeemIntent",
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
            "name": "fraction",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "join",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "_coSig",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_holderList",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "redeemCohort",
    "inputs": [
      {
        "name": "_shareToken",
        "type": "address",
        "internalType": "contract ShareToken"
      },
      {
        "name": "_holderList",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "redeemModule",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Redeem"
      }
    ],
    "stateMutability": "view"
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
    "name": "sell",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct Redeem.SellIntent",
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
            "name": "shares",
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
    "name": "verifyShare",
    "inputs": [
      {
        "name": "_master",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_shareToken",
        "type": "address",
        "internalType": "contract ShareToken"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "websiteRelease",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
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
    "name": "Fund__ShareMismatch",
    "inputs": [
      {
        "name": "master",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "shareToken",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Fund__TokenNotCanonical",
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
    "name": "Gate__InvalidCanonicalToken",
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
    "name": "Gate__NoAttestorEndpoint",
    "inputs": []
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
    "name": "Mandate__InvalidAllocationRate",
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
    "name": "Mandate__InvalidExitCap",
    "inputs": [
      {
        "name": "exitCap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Mandate__InvalidSkin",
    "inputs": [
      {
        "name": "skin",
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
    "name": "Mandate__StaleEpoch",
    "inputs": [
      {
        "name": "signedEpoch",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "epoch",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ShareToken__InvalidGrid",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ShareToken__InvalidPixel",
    "inputs": [
      {
        "name": "cell",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "color",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ShareToken__InvalidSymbol",
    "inputs": [
      {
        "name": "symbol",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  }
] as const
