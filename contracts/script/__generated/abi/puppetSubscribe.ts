// This file is auto-generated from forge-artifacts/Subscribe.sol/Subscribe.json
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
    "name": "subscribe",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct Subscribe.SubscribeIntent",
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
            "name": "baseTokenId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "rules",
            "type": "tuple[]",
            "internalType": "struct RuleLib.Rule[]",
            "components": [
              {
                "name": "fund",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "body",
                "type": "bytes",
                "internalType": "bytes"
              },
              {
                "name": "mandate",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          }
        ]
      },
      {
        "name": "_accountGate",
        "type": "address",
        "internalType": "contract Account"
      },
      {
        "name": "_store",
        "type": "address",
        "internalType": "contract AllocateStore"
      },
      {
        "name": "_base",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "_baseTokenId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_digest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_routerDomainSeparator",
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
        "name": "_feeReceiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_actualRelayFee",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_transferGasLimit",
        "type": "uint256",
        "internalType": "uint256"
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
  },
  {
    "type": "error",
    "name": "Subscribe__EmptyRules",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Subscribe__FundListNotSorted",
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
    "name": "Subscribe__SelfSubscribe",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
] as const
