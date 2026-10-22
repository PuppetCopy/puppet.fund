export default [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_authority",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "name": "book",
    "inputs": [
      {
        "name": "_master",
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
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bookedMap",
    "inputs": [
      {
        "name": "master",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "booked",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getCredit",
    "inputs": [
      {
        "name": "_master",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct FundStore.Credit",
        "components": [
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
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getHolding",
    "inputs": [
      {
        "name": "_master",
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
        "internalType": "struct FundStore.Holding",
        "components": [
          {
            "name": "allocatedAt",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "redeemedAt",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "queued",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "cost",
            "type": "uint80",
            "internalType": "uint80"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRedemption",
    "inputs": [
      {
        "name": "_master",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct FundStore.Redemption",
        "components": [
          {
            "name": "id",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "fraction",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "fee",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "masterPay",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "queued",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "owedLeft",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "potLeft",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
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
    "name": "heldMap",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "held",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pay",
    "inputs": [
      {
        "name": "_master",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_to",
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
    "name": "setCredit",
    "inputs": [
      {
        "name": "_master",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_credit",
        "type": "tuple",
        "internalType": "struct FundStore.Credit",
        "components": [
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
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setHolding",
    "inputs": [
      {
        "name": "_master",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_holder",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_holding",
        "type": "tuple",
        "internalType": "struct FundStore.Holding",
        "components": [
          {
            "name": "allocatedAt",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "redeemedAt",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "queued",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "cost",
            "type": "uint80",
            "internalType": "uint80"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRedemption",
    "inputs": [
      {
        "name": "_master",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_redemption",
        "type": "tuple",
        "internalType": "struct FundStore.Redemption",
        "components": [
          {
            "name": "id",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "fraction",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "fee",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "masterPay",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "queued",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "owedLeft",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "potLeft",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
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
    "name": "Balance__ZeroAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FundStore__Unbooked",
    "inputs": [
      {
        "name": "master",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "booked",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "FundStore__Unfunded",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "held",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "TransferUtils__EmptyTokenTransferGasLimit",
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
    "name": "TransferUtils__InvalidReceiver",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferUtils__NativeTransferError",
    "inputs": [
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
  },
  {
    "type": "error",
    "name": "TransferUtils__TokenTransferError",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
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
