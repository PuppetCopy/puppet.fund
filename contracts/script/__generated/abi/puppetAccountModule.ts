// This file is auto-generated from forge-artifacts/AccountModule.sol/AccountModule.json
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
        "name": "_transientRouteImpl",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_masterAccountImpl",
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
    "name": "createMasterAccount",
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
            "name": "name",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "baseTokenId",
            "type": "bytes32",
            "internalType": "bytes32"
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
        "internalType": "contract MasterAccount"
      },
      {
        "name": "transientRoute_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "depositRoute_",
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
            "name": "name",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "baseTokenId",
            "type": "bytes32",
            "internalType": "bytes32"
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
        "name": "transientRoute_",
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
      },
      {
        "name": "_baseToken",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "_amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_relayFee",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_feeReceiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_transferGasLimit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "signedPostBalance_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "postBalance_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "results_",
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
        "name": "_baseToken",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "_amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_transferGasLimit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "signedPostBalance_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "postBalance_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "results_",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "stateMutability": "nonpayable"
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
    "name": "masterAccountImpl",
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
    "name": "predictDepositRoute",
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
    "name": "predictMasterAccount",
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
            "name": "name",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "baseTokenId",
            "type": "bytes32",
            "internalType": "bytes32"
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
            "name": "name",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "baseTokenId",
            "type": "bytes32",
            "internalType": "bytes32"
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
    "name": "predictTransientRoute",
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
    "name": "transientRouteImpl",
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
    "name": "verifyMasterAccount",
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
            "name": "name",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "baseTokenId",
            "type": "bytes32",
            "internalType": "bytes32"
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
        "internalType": "contract MasterAccount"
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
            "name": "name",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "baseTokenId",
            "type": "bytes32",
            "internalType": "bytes32"
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
    "name": "Account__InvalidBaseTokenId",
    "inputs": []
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
