// This file is auto-generated from forge-artifacts/Attest.sol/Attest.json
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
    "name": "execute",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "contract IAccount"
      },
      {
        "name": "_callList",
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
        "name": "_transferList",
        "type": "tuple[]",
        "internalType": "struct IAccount.SignTransfer[]",
        "components": [
          {
            "name": "tokenId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "token",
            "type": "address",
            "internalType": "contract IERC20"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amountOut",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
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
      }
    ],
    "outputs": [
      {
        "name": "signedPostBalanceList_",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "postBalanceList_",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "resultList_",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "executeMandate",
    "inputs": [
      {
        "name": "_puppet",
        "type": "address",
        "internalType": "contract IAccount"
      },
      {
        "name": "_callList",
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
        "name": "_transferList",
        "type": "tuple[]",
        "internalType": "struct IAccount.SignTransfer[]",
        "components": [
          {
            "name": "tokenId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "token",
            "type": "address",
            "internalType": "contract IERC20"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amountOut",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "_mandateDigest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_mandate",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "signedPostBalanceList_",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "postBalanceList_",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "resultList_",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
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
    "name": "Account__InvalidSignature",
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
  }
] as const
