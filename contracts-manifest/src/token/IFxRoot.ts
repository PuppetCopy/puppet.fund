export default [
  {
    "type": "function",
    "name": "sendMessageToChild",
    "inputs": [
      {
        "name": "_receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const
