export default [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_authority",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_chain",
        "type": "address",
        "internalType": "contract IChain"
      },
      {
        "name": "_accountImpl",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_routeImpl",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_resetPeriod",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "accountBlockMap",
    "inputs": [
      {
        "name": "account",
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
    "name": "accountImpl",
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
    "name": "chain",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IChain"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createAccount",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_signer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_keySignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_userSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "designatorHash",
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
    "type": "function",
    "name": "dispatch",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "contract IAccount"
      },
      {
        "name": "_attestor",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_digest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_signature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_executionData",
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
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "forcedWithdrawal",
    "inputs": [
      {
        "name": "_account",
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
      },
      {
        "name": "_to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "lastAttestedAt",
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
    "name": "lastCallBlock",
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
    "name": "markConsumed",
    "inputs": [
      {
        "name": "_digest",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "predictDepositRoute",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "record",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_digest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_executionData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "resetPeriod",
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
    "name": "userOf",
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
    "type": "event",
    "name": "AccountCall",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "source",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "digest",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "modulePrevBlock",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "accountPrevBlock",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "blockTimestamp",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "signature",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      },
      {
        "name": "executionData",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      },
      {
        "name": "callList",
        "type": "tuple[]",
        "indexed": false,
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
        "name": "resultList",
        "type": "bytes[]",
        "indexed": false,
        "internalType": "bytes[]"
      }
    ],
    "anonymous": false
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
    "name": "Account__AttestorAlive",
    "inputs": [
      {
        "name": "quietSince",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Account__DigestConsumed",
    "inputs": [
      {
        "name": "digest",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "Account__InvalidImpl",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Account__InvalidResetPeriod",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Account__InvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Account__InvalidUser",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Account__NotDelegated",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Account__SessionExpired",
    "inputs": [
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nowTs",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Account__SessionTooLong",
    "inputs": [
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxTtl",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Account__UnauthorizedCaller",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Chain__NotSet",
    "inputs": []
  }
] as const
