// This file is auto-generated from forge-artifacts/MasterGate.sol/MasterGate.json
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
        "internalType": "contract AccountModule"
      },
      {
        "name": "_register",
        "type": "address",
        "internalType": "contract RegisterModule"
      },
      {
        "name": "_config",
        "type": "tuple",
        "internalType": "struct BaseGate.Config",
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
            "name": "maxBlockDelay",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxRelayFeeBps",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
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
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct MasterGate.CreateFundAccountIntent",
        "components": [
          {
            "name": "master",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenId",
            "type": "bytes32",
            "internalType": "bytes32"
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
            "name": "sweepAmount",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
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
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getConfig",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct BaseGate.Config",
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
            "name": "maxBlockDelay",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxRelayFeeBps",
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
    "name": "operate",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct MasterGate.OperateIntent",
        "components": [
          {
            "name": "master",
            "type": "address",
            "internalType": "address"
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
            "name": "callList",
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
            "name": "transferList",
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
        ]
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
        "name": "_actualRelayFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "result_",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "stateMutability": "payable"
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
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
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
    "name": "Gate__InvalidModule",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Intent__AmountExceedsCap",
    "inputs": [
      {
        "name": "amount",
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
    "name": "Intent__InvalidChainId",
    "inputs": [
      {
        "name": "signed",
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
    "name": "Intent__RelayFeeExceedsCap",
    "inputs": [
      {
        "name": "actual",
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
    "name": "Intent__RelayFeeRatioExceeded",
    "inputs": [
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBps",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__StaleSignature",
    "inputs": [
      {
        "name": "signedBlock",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentBlock",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBlockDelay",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__TokenMismatch",
    "inputs": [
      {
        "name": "baseTokenId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "actual",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Intent__TokenNotRegistered",
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
    "name": "InvalidShortString",
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
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  }
] as const
