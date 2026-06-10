// This file is auto-generated from forge-artifacts/Issue.sol/Issue.json
// Do not edit manually.

export default [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_authority",
        "type": "address",
        "internalType": "contract IAuthority"
      },
      {
        "name": "_accountModule",
        "type": "address",
        "internalType": "contract Account"
      },
      {
        "name": "_shareTokenImpl",
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
        "internalType": "contract Account"
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
        "internalType": "contract IAuthority"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "burn",
    "inputs": [
      {
        "name": "_shareToken",
        "type": "address",
        "internalType": "contract ShareToken"
      },
      {
        "name": "_from",
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
    "name": "createShareToken",
    "inputs": [
      {
        "name": "_shareParams",
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
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "mint",
    "inputs": [
      {
        "name": "_shareToken",
        "type": "address",
        "internalType": "contract ShareToken"
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
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "mintMany",
    "inputs": [
      {
        "name": "_shareToken",
        "type": "address",
        "internalType": "contract ShareToken"
      },
      {
        "name": "_toList",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "_amountList",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "predict",
    "inputs": [
      {
        "name": "_shareParams",
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
      }
    ],
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
    "name": "predictFund",
    "inputs": [
      {
        "name": "_shareParams",
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
      }
    ],
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
    "name": "shareTokenImpl",
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
    "name": "transferFrom",
    "inputs": [
      {
        "name": "_shareToken",
        "type": "address",
        "internalType": "contract ShareToken"
      },
      {
        "name": "_from",
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
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "verifyShareToken",
    "inputs": [
      {
        "name": "_shareParams",
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
      }
    ],
    "outputs": [
      {
        "name": "shareToken_",
        "type": "address",
        "internalType": "address"
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
    "name": "Share__InvalidImpl",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Share__NotCreated",
    "inputs": []
  }
] as const
