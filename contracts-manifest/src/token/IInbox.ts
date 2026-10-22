export default [
  {
    "type": "function",
    "name": "calculateRetryableSubmissionFee",
    "inputs": [
      {
        "name": "_dataLength",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_baseFee",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "createRetryableTicket",
    "inputs": [
      {
        "name": "_to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_l2CallValue",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_maxSubmissionCost",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_excessFeeRefundAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_callValueRefundAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_gasLimit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_maxFeePerGas",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  }
] as const
