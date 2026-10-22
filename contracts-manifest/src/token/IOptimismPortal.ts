export default [
  {
    "type": "function",
    "name": "depositTransaction",
    "inputs": [
      {
        "name": "_to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_gasLimit",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_isCreation",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "_data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  }
] as const
