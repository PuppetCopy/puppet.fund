// This file is auto-generated from forge-artifacts/Redeem.sol/Redeem.json
// Do not edit manually.

export default [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_authority",
        "type": "address",
        "internalType": "contract IAuthority"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "authority",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IAuthority"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "canCall",
    "inputs": [
      {
        "name": "_user",
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
    "name": "claim",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct Redeem.ClaimIntent",
        "components": [
          {
            "name": "params",
            "type": "tuple",
            "internalType": "struct AccountLib.AccountInitParams",
            "components": [
              {
                "name": "user",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "signer",
                "type": "address",
                "internalType": "address"
              }
            ]
          },
          {
            "name": "blockNumber",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "acceptableRelayFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "chainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "share",
            "type": "tuple",
            "internalType": "struct ShareLib.ShareInitParams",
            "components": [
              {
                "name": "master",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "baseTokenId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "name",
                "type": "bytes32",
                "internalType": "bytes32"
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
        "name": "_store",
        "type": "address",
        "internalType": "contract RedeemStore"
      },
      {
        "name": "_accountGate",
        "type": "address",
        "internalType": "contract Account"
      },
      {
        "name": "_shareGate",
        "type": "address",
        "internalType": "contract Issue"
      },
      {
        "name": "_baseToken",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_digest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_userSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_attestorSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_attestor",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_transferGasLimit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_feeReceiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_actualRelayFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "paidAmount_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getClaimable",
    "inputs": [
      {
        "name": "_store",
        "type": "address",
        "internalType": "contract RedeemStore"
      },
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_holder",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "name": "getUnsoldShares",
    "inputs": [
      {
        "name": "_store",
        "type": "address",
        "internalType": "contract RedeemStore"
      },
      {
        "name": "_shareToken",
        "type": "address",
        "internalType": "contract ShareToken"
      },
      {
        "name": "_holder",
        "type": "address",
        "internalType": "address"
      }
    ],
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
            "name": "params",
            "type": "tuple",
            "internalType": "struct AccountLib.AccountInitParams",
            "components": [
              {
                "name": "user",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "signer",
                "type": "address",
                "internalType": "address"
              }
            ]
          },
          {
            "name": "blockNumber",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "acceptableRelayFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "chainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "share",
            "type": "tuple",
            "internalType": "struct ShareLib.ShareInitParams",
            "components": [
              {
                "name": "master",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "baseTokenId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "name",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "sharesOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "acceptableNetAssetValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalShareSupply",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "acceptableShares",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "_store",
        "type": "address",
        "internalType": "contract RedeemStore"
      },
      {
        "name": "_accountGate",
        "type": "address",
        "internalType": "contract Account"
      },
      {
        "name": "_shareGate",
        "type": "address",
        "internalType": "contract Issue"
      },
      {
        "name": "_baseToken",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_digest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_userSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_attestorSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_attestor",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_transferGasLimit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_feeReceiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_actualRelayFee",
        "type": "uint256",
        "internalType": "uint256"
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
            "name": "params",
            "type": "tuple",
            "internalType": "struct AccountLib.AccountInitParams",
            "components": [
              {
                "name": "user",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "signer",
                "type": "address",
                "internalType": "address"
              }
            ]
          },
          {
            "name": "blockNumber",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "acceptableRelayFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "chainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "share",
            "type": "tuple",
            "internalType": "struct ShareLib.ShareInitParams",
            "components": [
              {
                "name": "master",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "baseTokenId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "name",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "sharesOut",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "_holder",
        "type": "address",
        "internalType": "contract IAccount"
      },
      {
        "name": "_store",
        "type": "address",
        "internalType": "contract RedeemStore"
      },
      {
        "name": "_accountGate",
        "type": "address",
        "internalType": "contract Account"
      },
      {
        "name": "_shareGate",
        "type": "address",
        "internalType": "contract Issue"
      },
      {
        "name": "_baseToken",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_digest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_userSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_attestorSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_attestor",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_transferGasLimit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_feeReceiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_actualRelayFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
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
        "name": "_enabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "_interfaceId",
        "type": "bytes4",
        "internalType": "bytes4"
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
    "type": "error",
    "name": "Access__Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Module__CallerNotAuthority",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Module__InvalidAuthority",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Module__Reentrant",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Redeem__NothingToRetire",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Redeem__RelayFeeTooHigh",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Redeem__SupplyMismatch",
    "inputs": [
      {
        "name": "current",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Redeem__ZeroAcceptableNav",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Share__Empty",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Share__InsufficientClaimable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Share__RelayFeeTooHigh",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Share__ZeroShares",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Share__ZeroStakeAdded",
    "inputs": []
  }
] as const
