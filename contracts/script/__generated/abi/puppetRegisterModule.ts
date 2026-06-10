// This file is auto-generated from forge-artifacts/RegisterModule.sol/RegisterModule.json
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
        "name": "_hubChainId",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "getTokenInfo",
    "inputs": [
      {
        "name": "_tokenId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RegisterModule.TokenInfo",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "contract IERC20"
          },
          {
            "name": "cap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "hubToken",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getWnt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IWNT"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hubChainId",
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
    "name": "registerToken",
    "inputs": [
      {
        "name": "_tokenId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_token",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "_cap",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_hubToken",
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
    "name": "setWnt",
    "inputs": [
      {
        "name": "_tokenId",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "type": "function",
    "name": "tokenRegistryMap",
    "inputs": [
      {
        "name": "tokenId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hubToken",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "wntBaseTokenId",
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
    "type": "error",
    "name": "Access__Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Account__InvalidBaseTokenId",
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
    "name": "Register__InvalidHubToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Register__SelfHubTokenOnSpoke",
    "inputs": [
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "Register__TokenSwapForbidden",
    "inputs": [
      {
        "name": "tokenId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "registered",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "attempted",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Register__UnknownBaseTokenId",
    "inputs": [
      {
        "name": "baseTokenId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "Register__WntNotSet",
    "inputs": []
  }
] as const
