// This file is auto-generated from forge-artifacts/Bridge.sol/Bridge.json
// Do not edit manually.

export default [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_inputSettler",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_outputSettler",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "buildOpen",
    "inputs": [
      {
        "name": "_order",
        "type": "tuple",
        "internalType": "struct BridgeOrder",
        "components": [
          {
            "name": "depositor",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "inputToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "outputToken",
            "type": "address",
            "internalType": "address"
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
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "inputOracle",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "outputOracle",
            "type": "bytes32",
            "internalType": "bytes32"
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
      }
    ],
    "outputs": [
      {
        "name": "settler_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "openData_",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "inputSettler",
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
    "name": "outputSettler",
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
    "name": "Bridge__UnconfiguredOracle",
    "inputs": []
  }
] as const
