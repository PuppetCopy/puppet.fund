export default [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "gateMap",
    "inputs": [
      {
        "name": "name",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "proxy",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
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
    "name": "removeAccess",
    "inputs": [
      {
        "name": "_target",
        "type": "address",
        "internalType": "contract Access"
      },
      {
        "name": "_user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAccess",
    "inputs": [
      {
        "name": "_target",
        "type": "address",
        "internalType": "contract Access"
      },
      {
        "name": "_user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setGate",
    "inputs": [
      {
        "name": "_name",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_impl",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "proxy_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AccessSet",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "Dictate__InvalidOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Dictate__Unauthorized",
    "inputs": []
  }
] as const
