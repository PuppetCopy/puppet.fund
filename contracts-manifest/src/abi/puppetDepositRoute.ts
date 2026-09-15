export default [
  {
    "type": "receive",
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "execute",
    "inputs": [
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
    "outputs": [
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
    "name": "module",
    "inputs": [],
    "outputs": [
      {
        "name": "module_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "user",
    "inputs": [],
    "outputs": [
      {
        "name": "user_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "error",
    "name": "Account__ForbiddenTarget",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Account__UnauthorizedCaller",
    "inputs": []
  }
] as const
