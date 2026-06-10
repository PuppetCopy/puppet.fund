// This file is auto-generated from forge-artifacts/AccountGate.sol/AccountGate.json
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
        "name": "_walletDeposit",
        "type": "address",
        "internalType": "contract Deposit"
      },
      {
        "name": "_register",
        "type": "address",
        "internalType": "contract RegisterToken"
      },
      {
        "name": "_hubChainId",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "bridge",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct AccountGate.BridgeIntent",
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
            "name": "tokenId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "provider",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "providerCallData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "inputAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "outputAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "destinationChainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expires",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "fillDeadline",
            "type": "uint32",
            "internalType": "uint32"
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
    "name": "createPuppetAccount",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct Account.CreatePuppetAccountIntent",
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
            "name": "tokenId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "initialDepositAmount",
            "type": "uint256",
            "internalType": "uint256"
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
    "name": "deposit",
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
        "name": "_tokenId",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "depositWnt",
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
    "outputs": [],
    "stateMutability": "payable"
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
    "name": "recognize",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct AccountGate.RecognizeIntent",
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
            "name": "tokenId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amount",
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
    "name": "Deposit__InsufficientBalance",
    "inputs": [
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "required",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Deposit__InvalidDestinationChain",
    "inputs": [
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "provided",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Deposit__NothingToBridge",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Deposit__NothingToRecord",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Deposit__RelayFeeTooHigh",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Deposit__SameChainBridge",
    "inputs": [
      {
        "name": "destinationChainId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Deposit__ZeroBridgeOutput",
    "inputs": []
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
