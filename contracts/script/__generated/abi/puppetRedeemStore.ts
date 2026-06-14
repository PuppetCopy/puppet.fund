// This file is auto-generated from forge-artifacts/RedeemStore.sol/RedeemStore.json
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
    "name": "closeFund",
    "inputs": [
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_closeRate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "closeRateMap",
    "inputs": [
      {
        "name": "fund",
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
    "name": "closedEpochAccruedMap",
    "inputs": [
      {
        "name": "fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "epoch",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "creditPool",
    "inputs": [
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "accruedPerStake_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "totalStake_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "deletePosition",
    "inputs": [
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
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getPool",
    "inputs": [
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RedeemStore.Pool",
        "components": [
          {
            "name": "epoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "accruedPerStake",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalStake",
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
    "name": "getPosition",
    "inputs": [
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
        "type": "tuple",
        "internalType": "struct RedeemStore.Position",
        "components": [
          {
            "name": "epoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "stake",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "cursor",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "accrued",
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
    "name": "getTokenBalance",
    "inputs": [
      {
        "name": "_token",
        "type": "address",
        "internalType": "contract IERC20"
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
    "name": "poolMap",
    "inputs": [
      {
        "name": "fund",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "epoch",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "accruedPerStake",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "totalStake",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionMap",
    "inputs": [
      {
        "name": "fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "holder",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "epoch",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "stake",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cursor",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "accrued",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "recognize",
    "inputs": [
      {
        "name": "_token",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "_amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rotatePool",
    "inputs": [
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
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
    "name": "setPool",
    "inputs": [
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_pool",
        "type": "tuple",
        "internalType": "struct RedeemStore.Pool",
        "components": [
          {
            "name": "epoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "accruedPerStake",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalStake",
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
    "name": "setPosition",
    "inputs": [
      {
        "name": "_fund",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_holder",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_position",
        "type": "tuple",
        "internalType": "struct RedeemStore.Position",
        "components": [
          {
            "name": "epoch",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "stake",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "cursor",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "accrued",
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
    "name": "signedBalanceMap",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
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
    "type": "function",
    "name": "transferOut",
    "inputs": [
      {
        "name": "_token",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "_receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_gasLimit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
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
    "name": "Share__CreditTooSmall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Share__NoStakeToCredit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferUtils__EmptyTokenTransferGasLimit",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ]
  },
  {
    "type": "error",
    "name": "TransferUtils__InvalidReceiver",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferUtils__TokenTransferError",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "receiver",
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
] as const
