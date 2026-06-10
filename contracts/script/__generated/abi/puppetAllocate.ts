// This file is auto-generated from forge-artifacts/Allocate.sol/Allocate.json
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
    "name": "allocate",
    "inputs": [
      {
        "name": "_intent",
        "type": "tuple",
        "internalType": "struct Allocate.AllocateIntent",
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
            "name": "share",
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
          },
          {
            "name": "acceptableNetAssetValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalShareSupply",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "masterAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "puppetList",
            "type": "address[]",
            "internalType": "address[]"
          },
          {
            "name": "matchedAmountList",
            "type": "uint256[]",
            "internalType": "uint256[]"
          }
        ]
      },
      {
        "name": "_bodyList",
        "type": "bytes[]",
        "internalType": "bytes[]"
      },
      {
        "name": "_mandateList",
        "type": "bytes[]",
        "internalType": "bytes[]"
      },
      {
        "name": "_accountGate",
        "type": "address",
        "internalType": "contract Account"
      },
      {
        "name": "_shareGate",
        "type": "address",
        "internalType": "contract Issue"
      },
      {
        "name": "_store",
        "type": "address",
        "internalType": "contract AllocateStore"
      },
      {
        "name": "_redeemStore",
        "type": "address",
        "internalType": "contract RedeemStore"
      },
      {
        "name": "_base",
        "type": "address",
        "internalType": "contract IERC20"
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
        "name": "_transferGasLimit",
        "type": "uint256",
        "internalType": "uint256"
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
      }
    ],
    "outputs": [
      {
        "name": "fundAccountIn_",
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
    "name": "Allocate__ListLengthMismatch",
    "inputs": [
      {
        "name": "puppetsLen",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bodiesLen",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sigsLen",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "Allocate__PreMintSupplyMismatch",
    "inputs": [
      {
        "name": "current",
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
    "name": "Allocate__PuppetListNotSorted",
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
    "name": "Allocate__ZeroAcceptableNav",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Allocate__ZeroAmount",
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
    "name": "Share__Empty",
    "inputs": []
  }
] as const
