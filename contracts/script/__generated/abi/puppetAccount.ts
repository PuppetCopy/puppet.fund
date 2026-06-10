// This file is auto-generated from forge-artifacts/Account.sol/Account.json
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
        "name": "_attest",
        "type": "address",
        "internalType": "contract Attest"
      },
      {
        "name": "_puppetAccountImpl",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_fundAccountImpl",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_routeImpl",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "attest",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Attest"
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
    "name": "canCall",
    "inputs": [
      {
        "name": "_selector",
        "type": "bytes4",
        "internalType": "bytes4"
      },
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
    "name": "createFundAccount",
    "inputs": [
      {
        "name": "_signer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "account_",
        "type": "address",
        "internalType": "contract FundAccount"
      },
      {
        "name": "route_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createPuppetAccount",
    "inputs": [
      {
        "name": "_params",
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
        "name": "_userDeploySig",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_signerProof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "account_",
        "type": "address",
        "internalType": "contract PuppetAccount"
      },
      {
        "name": "route_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "dispatch",
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
      },
      {
        "name": "_nonce",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "dispatchMandate",
    "inputs": [
      {
        "name": "_puppet",
        "type": "address",
        "internalType": "contract IAccount"
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
    "name": "fundAccountImpl",
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
    "name": "isNonceConsumed",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_nonce",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "predictFundAccount",
    "inputs": [
      {
        "name": "_signer",
        "type": "address",
        "internalType": "address"
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
    "name": "predictPuppetAccount",
    "inputs": [
      {
        "name": "_params",
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
    "name": "predictRoute",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "address"
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
    "name": "puppetAccountImpl",
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
    "name": "routeImpl",
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
    "name": "setPermission",
    "inputs": [
      {
        "name": "_selector",
        "type": "bytes4",
        "internalType": "bytes4"
      },
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
    "type": "function",
    "name": "verifyFundAccount",
    "inputs": [
      {
        "name": "_signer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract FundAccount"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifyPuppetAccount",
    "inputs": [
      {
        "name": "_params",
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract PuppetAccount"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "error",
    "name": "Account__InvalidUser",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Account__NotDeployed",
    "inputs": [
      {
        "name": "predicted",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Account__UnauthorizedDeploy",
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
    "name": "Permission__Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Register__InvalidImpl",
    "inputs": []
  }
] as const
