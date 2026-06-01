// This file is auto-generated. Do not edit manually.
// Source: gmx-io/gmx-synthetics contracts/error/Errors.sol

export const gmxErrorAbi = [
  {
    "type": "error",
    "name": "ActionAlreadySignalled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ActionNotSignalled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AdlNotEnabled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AdlNotRequired",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "pnlToPoolFactor"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxPnlFactorForAdl"
      }
    ]
  },
  {
    "type": "error",
    "name": "ArrayOutOfBoundsBytes",
    "inputs": [
      {
        "internalType": "bytes[]",
        "type": "bytes[]",
        "name": "values"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "index"
      },
      {
        "internalType": "string",
        "type": "string",
        "name": "label"
      }
    ]
  },
  {
    "type": "error",
    "name": "ArrayOutOfBoundsUint256",
    "inputs": [
      {
        "internalType": "uint256[]",
        "type": "uint256[]",
        "name": "values"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "index"
      },
      {
        "internalType": "string",
        "type": "string",
        "name": "label"
      }
    ]
  },
  {
    "type": "error",
    "name": "AttemptedBridgeAmountTooHigh",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minRequiredFeeAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "feeAmountCurrentChain"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "amountToBridgeOut"
      }
    ]
  },
  {
    "type": "error",
    "name": "AvailableFeeAmountIsZero",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "feeToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "buybackToken"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "availableFeeAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "BlockNumbersNotSorted",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minOracleBlockNumber"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "prevMinOracleBlockNumber"
      }
    ]
  },
  {
    "type": "error",
    "name": "BridgedAmountNotSufficient",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minRequiredFeeAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "currentChainFeeAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "BridgeOutNotSupportedDuringShift",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BridgingBalanceArrayMismatch",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "balancesLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "targetBalancesLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "BridgingTransactionFailed",
    "inputs": [
      {
        "internalType": "bytes",
        "type": "bytes",
        "name": "result"
      }
    ]
  },
  {
    "type": "error",
    "name": "BuybackAndFeeTokenAreEqual",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "feeToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "buybackToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "ChainlinkPriceFeedNotUpdated",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "timestamp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "heartbeatDuration"
      }
    ]
  },
  {
    "type": "error",
    "name": "CollateralAlreadyClaimed",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "adjustedClaimableAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "claimedAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "CompactedArrayOutOfBounds",
    "inputs": [
      {
        "internalType": "uint256[]",
        "type": "uint256[]",
        "name": "compactedValues"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "index"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "slotIndex"
      },
      {
        "internalType": "string",
        "type": "string",
        "name": "label"
      }
    ]
  },
  {
    "type": "error",
    "name": "ConfigValueExceedsAllowedRange",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "baseKey"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "value"
      }
    ]
  },
  {
    "type": "error",
    "name": "DataListLengthExceeded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DataStreamIdAlreadyExistsForToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "DeadlinePassed",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "currentTimestamp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "deadline"
      }
    ]
  },
  {
    "type": "error",
    "name": "DepositNotFound",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "DisabledFeature",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "DisabledMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "DuplicateClaimTerms",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "existingDistributionId"
      }
    ]
  },
  {
    "type": "error",
    "name": "DuplicatedIndex",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "index"
      },
      {
        "internalType": "string",
        "type": "string",
        "name": "label"
      }
    ]
  },
  {
    "type": "error",
    "name": "DuplicatedMarketInSwapPath",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "EdgeDataStreamIdAlreadyExistsForToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyAccount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyAddressInMarketTokenBalanceValidation",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyChainlinkPriceFeed",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyChainlinkPriceFeedMultiplier",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyClaimableAmount",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyClaimFeesMarket",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyDataStreamFeedId",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyDataStreamMultiplier",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyDeposit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyDepositAmounts",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyDepositAmountsAfterSwap",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyFundingAccount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyGlv",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyGlvDeposit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyGlvDepositAmounts",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyGlvMarketAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyGlvTokenSupply",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyGlvWithdrawal",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyGlvWithdrawalAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyHoldingAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyMarket",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyMarketPrice",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyMarketTokenSupply",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyMultichainTransferInAmount",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "account"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyMultichainTransferOutAmount",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "account"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyOrder",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyPeer",
    "inputs": [
      {
        "internalType": "uint32",
        "type": "uint32",
        "name": "eid"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyPosition",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyPositionImpactWithdrawalAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyPrimaryPrice",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyReceiver",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyReduceLentAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyRelayFeeAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyShift",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyShiftAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptySizeDeltaInTokens",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyTarget",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyTokenTranferGasLimit",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyValidatedPrices",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyWithdrawal",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyWithdrawalAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EndOfOracleSimulation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EventItemNotFound",
    "inputs": [
      {
        "internalType": "string",
        "type": "string",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExternalCallFailed",
    "inputs": [
      {
        "internalType": "bytes",
        "type": "bytes",
        "name": "data"
      }
    ]
  },
  {
    "type": "error",
    "name": "FeeBatchNotFound",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "FeeDistributionAlreadyCompleted",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "lastDistributionTime"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "startOfCurrentWeek"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvAlreadyExists",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "salt"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvDepositNotFound",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvDisabledMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvEnabledMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvInsufficientMarketTokenBalance",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "marketTokenBalance"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "marketTokenAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvInvalidLongToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "provided"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expected"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvInvalidShortToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "provided"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expected"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvMarketAlreadyExists",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvMaxMarketCountExceeded",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "glvMaxMarketCount"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvMaxMarketTokenBalanceAmountExceeded",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxMarketTokenBalanceAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "marketTokenBalanceAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvMaxMarketTokenBalanceUsdExceeded",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxMarketTokenBalanceUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "marketTokenBalanceUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvNameTooLong",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GlvNegativeMarketPoolValue",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvNonZeroMarketBalance",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvNotFound",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvShiftIntervalNotYetPassed",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "currentTimestamp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "lastGlvShiftExecutedAt"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "glvShiftMinInterval"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvShiftMaxLossExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "effectivePriceImpactFactor"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "glvMaxShiftPriceImpactFactor"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvShiftNotFound",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvSymbolTooLong",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GlvUnsupportedMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "glv"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "GlvWithdrawalNotFound",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "GmEmptySigner",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "signerIndex"
      }
    ]
  },
  {
    "type": "error",
    "name": "GmInvalidBlockNumber",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minOracleBlockNumber"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "currentBlockNumber"
      }
    ]
  },
  {
    "type": "error",
    "name": "GmInvalidMinMaxBlockNumber",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minOracleBlockNumber"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxOracleBlockNumber"
      }
    ]
  },
  {
    "type": "error",
    "name": "GmMaxOracleSigners",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "oracleSigners"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxOracleSigners"
      }
    ]
  },
  {
    "type": "error",
    "name": "GmMaxPricesNotSorted",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "price"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "prevPrice"
      }
    ]
  },
  {
    "type": "error",
    "name": "GmMaxSignerIndex",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "signerIndex"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxSignerIndex"
      }
    ]
  },
  {
    "type": "error",
    "name": "GmMinOracleSigners",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "oracleSigners"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minOracleSigners"
      }
    ]
  },
  {
    "type": "error",
    "name": "GmMinPricesNotSorted",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "price"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "prevPrice"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientBuybackOutputAmount",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "feeToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "buybackToken"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "outputAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minOutputAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientCollateralAmount",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "collateralAmount"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "collateralDeltaAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientCollateralUsd",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "remainingCollateralUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientExecutionFee",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minExecutionFee"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "executionFee"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientExecutionGas",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "startingGas"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "estimatedGasLimit"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minAdditionalGasForExecution"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientExecutionGasForErrorHandling",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "startingGas"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minHandleErrorGas"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientFee",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "feeProvided"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "feeRequired"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientFunds",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientFundsToPayForCosts",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "remainingCostUsd"
      },
      {
        "internalType": "string",
        "type": "string",
        "name": "step"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientGasForAutoCancellation",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "gas"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minHandleExecutionErrorGas"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientGasForCancellation",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "gas"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minHandleExecutionErrorGas"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientGasLeft",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "gas"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "estimatedGasLimit"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientGasLeftForCallback",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "gasToBeForwarded"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "callbackGasLimit"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientHandleExecutionErrorGas",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "gas"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minHandleExecutionErrorGas"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientImpactPoolValueForWithdrawal",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "withdrawalAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "poolValue"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "totalPendingImpactAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientMarketTokens",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "balance"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expected"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientMultichainBalance",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "account"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "balance"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "amount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientMultichainNativeFee",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "msgValue"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientNativeTokenAmount",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "msgValue"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expectedNativeValue"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientOutputAmount",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "outputAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minOutputAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientPoolAmount",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "poolAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "amount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientRelayFee",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "requiredRelayFee"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "availableFeeAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientReserve",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "reservedUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxReservedUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientReserveForOpenInterest",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "reservedUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxReservedUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientSwapOutputAmount",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "outputAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minOutputAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientWntAmountForExecutionFee",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "wntAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "executionFee"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidAdl",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "nextPnlToPoolFactor"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "pnlToPoolFactor"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidAmountInForFeeBatch",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "amountIn"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "remainingAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidBaseKey",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "baseKey"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidBlockRangeSet",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "largestMinBlockNumber"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "smallestMaxBlockNumber"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidBridgeOutToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidBuybackToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "buybackToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidCancellationReceiverForSubaccountOrder",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "cancellationReceiver"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedCancellationReceiver"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClaimableFactor",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "value"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClaimableReductionFactor",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "value"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClaimAffiliateRewardsInput",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "marketsLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClaimCollateralInput",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "marketsLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "timeKeysLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClaimFundingFeesInput",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "marketsLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClaimTermsSignature",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "recoveredSigner"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedSigner"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClaimTermsSignatureForContract",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedSigner"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidClaimUiFeesInput",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "marketsLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidCollateralTokenForMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidContributorToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDataStreamBidAsk",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "int192",
        "type": "int192",
        "name": "bid"
      },
      {
        "internalType": "int192",
        "type": "int192",
        "name": "ask"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDataStreamFeedId",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "feedId"
      },
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "expectedFeedId"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDataStreamPrices",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "int192",
        "type": "int192",
        "name": "bid"
      },
      {
        "internalType": "int192",
        "type": "int192",
        "name": "ask"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDataStreamSpreadReductionFactor",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "spreadReductionFactor"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDecreaseOrderSize",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sizeDeltaUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "positionSizeInUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDecreasePositionSwapType",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "decreasePositionSwapType"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDestinationChainId",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "desChainId"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDistributionState",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "distributionStateUint"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidEdgeDataStreamBidAsk",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "bid"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "ask"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidEdgeDataStreamExpo",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "expo"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidEdgeDataStreamPrices",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "bid"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "ask"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidEdgeSignature",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "recoverError"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidEdgeSigner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidEid",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "eid"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidExecutionFee",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "executionFee"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minExecutionFee"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxExecutionFee"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidExecutionFeeForMigration",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "totalExecutionFee"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "msgValue"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidExternalCallInput",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "targetsLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "dataListLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidExternalCalls",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sendTokensLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sendAmountsLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidExternalCallTarget",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "target"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidExternalReceiversInput",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "refundTokensLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "refundReceiversLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidFeeBatchTokenIndex",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokenIndex"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "feeBatchTokensLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidFeedPrice",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "price"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidFeeReceiver",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "receiver"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidGlpAmount",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "totalGlpAmountToRedeem"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "totalGlpAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidGlvDepositInitialLongToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "initialLongToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidGlvDepositInitialShortToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "initialShortToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidGlvDepositSwapPath",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "longTokenSwapPathLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "shortTokenSwapPathLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidGmMedianMinMaxPrice",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minPrice"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxPrice"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidGmOraclePrice",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidGmSignature",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "recoveredSigner"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedSigner"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidGmSignerMinMaxPrice",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minPrice"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxPrice"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidHoldingAddress",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "account"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidInitializer",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidKeeperForFrozenOrder",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "keeper"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidMarketTokenBalance",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "balance"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expectedMinBalance"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidMarketTokenBalanceForClaimableFunding",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "balance"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "claimableFundingFeeAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidMarketTokenBalanceForCollateralAmount",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "balance"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "collateralAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidMinGlvTokensForFirstGlvDeposit",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minGlvTokens"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expectedMinGlvTokens"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidMinMarketTokensForFirstDeposit",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minMarketTokens"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expectedMinMarketTokens"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidMinMaxForPrice",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "min"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "max"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidMultichainEndpoint",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "endpoint"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidMultichainProvider",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "provider"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidNativeTokenSender",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "msgSender"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOracleProvider",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "provider"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOracleProviderForToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "provider"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedProvider"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOracleSetPricesDataParam",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "dataLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOracleSetPricesProvidersParam",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "providersLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOracleSigner",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "signer"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOrderPrices",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "primaryPriceMin"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "primaryPriceMax"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "triggerPrice"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "orderType"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOutputToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "tokenOut"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedTokenOut"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidParams",
    "inputs": [
      {
        "internalType": "string",
        "type": "string",
        "name": "reason"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPermitSpender",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "spender"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedSpender"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPoolValueForDeposit",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "poolValue"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPoolValueForWithdrawal",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "poolValue"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPositionImpactPoolDistributionRate",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "distributionAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "positionImpactPoolAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPositionMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPositionSizeValues",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sizeInUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sizeInTokens"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPrimaryPricesForSimulation",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "primaryTokensLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "primaryPricesLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidReceiver",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "receiver"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidReceiverForFirstDeposit",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "receiver"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedReceiver"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidReceiverForFirstGlvDeposit",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "receiver"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedReceiver"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidReceiverForSubaccountOrder",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "receiver"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedReceiver"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidRecoveredSigner",
    "inputs": [
      {
        "internalType": "string",
        "type": "string",
        "name": "signatureType"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "recovered"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "recoveredFromMinified"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedSigner"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidReferralRewardToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSetContributorPaymentInput",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "amountsLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSetMaxTotalContributorTokenAmountInput",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "amountsLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSignature",
    "inputs": [
      {
        "internalType": "string",
        "type": "string",
        "name": "signatureType"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSizeDeltaForAdl",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sizeDeltaUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "positionSizeInUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSrcChainId",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "srcChainId"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSubaccountApprovalDesChainId",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "desChainId"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSubaccountApprovalNonce",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "storedNonce"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "nonce"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSubaccountApprovalSubaccount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSwapMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSwapOutputToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "outputToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedOutputToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSwapPathForV1",
    "inputs": [
      {
        "internalType": "address[]",
        "type": "address[]",
        "name": "path"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "bridgingToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidTimelockDelay",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "timelockDelay"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidTokenIn",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "tokenIn"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidTransferRequestsLength",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTrustedSignerAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidUiFeeFactor",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "uiFeeFactor"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxUiFeeFactor"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidUserDigest",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "digest"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidVersion",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "version"
      }
    ]
  },
  {
    "type": "error",
    "name": "JitEmptyShiftParams",
    "inputs": []
  },
  {
    "type": "error",
    "name": "JitInvalidToMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedMarket"
      }
    ]
  },
  {
    "type": "error",
    "name": "JitUnsupportedOrderType",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "orderType"
      }
    ]
  },
  {
    "type": "error",
    "name": "KeeperAmountMismatch",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "wntForKeepers"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "wntToKeepers"
      }
    ]
  },
  {
    "type": "error",
    "name": "KeeperArrayLengthMismatch",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "keepersLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "keeperTargetBalancesLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "keeperVersionsLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "LiquidatablePosition",
    "inputs": [
      {
        "internalType": "string",
        "type": "string",
        "name": "reason"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "remainingCollateralUsd"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "minCollateralUsd"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "minCollateralUsdForLeverage"
      }
    ]
  },
  {
    "type": "error",
    "name": "LongTokensAreNotEqual",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "fromMarketLongToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "toMarketLongToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "MarketAlreadyExists",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "salt"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "existingMarketAddress"
      }
    ]
  },
  {
    "type": "error",
    "name": "MarketNotFound",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaskIndexOutOfBounds",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "index"
      },
      {
        "internalType": "string",
        "type": "string",
        "name": "label"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxAutoCancelOrdersExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "count"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxAutoCancelOrders"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxBuybackPriceAgeExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "priceTimestamp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "buybackMaxPriceAge"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "currentTimestamp"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxCallbackGasLimitExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "callbackGasLimit"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxCallbackGasLimit"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxCollateralSumExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "collateralSum"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxCollateralSum"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxDataListLengthExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "dataLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxDataLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxEsGmxReferralRewardsAmountExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensForReferralRewards"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxEsGmxReferralRewards"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxFundingFactorPerSecondLimitExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxFundingFactorPerSecond"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "limit"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxLendableFactorForWithdrawalsExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "poolUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxLendableUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "lentUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxOpenInterestExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "openInterest"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxOpenInterest"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxOracleTimestampRangeExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "range"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxRange"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxPoolAmountExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "poolAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxPoolAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxPoolUsdForDepositExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "poolUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxPoolUsdForDeposit"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxPriceAgeExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "oracleTimestamp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "currentTimestamp"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxReferralRewardsExceeded",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "cumulativeTransferAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensForReferralRewards"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxRefPriceDeviationExceeded",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "price"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "refPrice"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxRefPriceDeviationFactor"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxRelayFeeSwapForSubaccountExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "feeUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxFeeUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxSubaccountActionCountExceeded",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "account"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "subaccount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "count"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxCount"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxSwapPathLengthExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "swapPathLengh"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxSwapPathLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxTimelockDelayExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "timelockDelay"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxTotalCallbackGasLimitForAutoCancelOrdersExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "totalCallbackGasLimit"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxTotalCallbackGasLimit"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxTotalContributorTokenAmountExceeded",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "totalAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxTotalAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxWntFromTreasuryExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxWntFromTreasury"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "additionalWntFromTreasury"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxWntReferralRewardsInUsdAmountExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "wntReferralRewardsInUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxWntReferralRewardsInUsdAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxWntReferralRewardsInUsdExceeded",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "wntReferralRewardsInUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxWntReferralRewardsInUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "MinContributorPaymentIntervalBelowAllowedRange",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "interval"
      }
    ]
  },
  {
    "type": "error",
    "name": "MinContributorPaymentIntervalNotYetPassed",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minPaymentInterval"
      }
    ]
  },
  {
    "type": "error",
    "name": "MinGlvTokens",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "received"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expected"
      }
    ]
  },
  {
    "type": "error",
    "name": "MinLongTokens",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "received"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expected"
      }
    ]
  },
  {
    "type": "error",
    "name": "MinMarketTokens",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "received"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expected"
      }
    ]
  },
  {
    "type": "error",
    "name": "MinPositionSize",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "positionSizeInUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minPositionSizeUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "MinShortTokens",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "received"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expected"
      }
    ]
  },
  {
    "type": "error",
    "name": "NegativeExecutionPrice",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "executionPrice"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "price"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "positionSizeInUsd"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "priceImpactUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sizeDeltaUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "NonAtomicOracleProvider",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "provider"
      }
    ]
  },
  {
    "type": "error",
    "name": "NonEmptyExternalCallsForSubaccountOrder",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NonEmptyTokensWithPrices",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "tokensWithPricesLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "OpenInterestCannotBeUpdatedForSwapOnlyMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "OraclePriceOutdated",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OracleProviderAlreadyExistsForToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "oracle"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "OracleProviderMinChangeDelayNotYetPassed",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "provider"
      }
    ]
  },
  {
    "type": "error",
    "name": "OracleTimestampsAreLargerThanRequestExpirationTime",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxOracleTimestamp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "requestTimestamp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "requestExpirationTime"
      }
    ]
  },
  {
    "type": "error",
    "name": "OracleTimestampsAreSmallerThanRequired",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minOracleTimestamp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "expectedTimestamp"
      }
    ]
  },
  {
    "type": "error",
    "name": "OrderAlreadyFrozen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OrderNotFound",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "OrderNotFulfillableAtAcceptablePrice",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "price"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "acceptablePrice"
      }
    ]
  },
  {
    "type": "error",
    "name": "OrderNotUpdatable",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "orderType"
      }
    ]
  },
  {
    "type": "error",
    "name": "OrderTypeCannotBeCreated",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "orderType"
      }
    ]
  },
  {
    "type": "error",
    "name": "OrderValidFromTimeNotReached",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "validFromTime"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "currentTimestamp"
      }
    ]
  },
  {
    "type": "error",
    "name": "OutdatedReadResponse",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "timestamp"
      }
    ]
  },
  {
    "type": "error",
    "name": "PnlFactorExceededForLongs",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "pnlToPoolFactor"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxPnlFactor"
      }
    ]
  },
  {
    "type": "error",
    "name": "PnlFactorExceededForShorts",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "pnlToPoolFactor"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxPnlFactor"
      }
    ]
  },
  {
    "type": "error",
    "name": "PnlOvercorrected",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "nextPnlToPoolFactor"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minPnlFactorForAdl"
      }
    ]
  },
  {
    "type": "error",
    "name": "PositionNotFound",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "PositionShouldNotBeLiquidated",
    "inputs": [
      {
        "internalType": "string",
        "type": "string",
        "name": "reason"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "remainingCollateralUsd"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "minCollateralUsd"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "minCollateralUsdForLeverage"
      }
    ]
  },
  {
    "type": "error",
    "name": "PriceAlreadySet",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "minPrice"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "maxPrice"
      }
    ]
  },
  {
    "type": "error",
    "name": "PriceFeedAlreadyExistsForToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      }
    ]
  },
  {
    "type": "error",
    "name": "PriceImpactLargerThanOrderSize",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "priceImpactUsd"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sizeDeltaUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReductionExceedsLentAmount",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "lentAmount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "totalReductionAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReferralCodeAlreadyExists",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "code"
      }
    ]
  },
  {
    "type": "error",
    "name": "RelayCalldataTooLong",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "calldataLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "RelayEmptyBatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RemovalShouldNotBeSkipped",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "listKey"
      },
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "entityKey"
      }
    ]
  },
  {
    "type": "error",
    "name": "RequestNotYetCancellable",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "requestAge"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "requestExpirationAge"
      },
      {
        "internalType": "string",
        "type": "string",
        "name": "requestType"
      }
    ]
  },
  {
    "type": "error",
    "name": "SelfTransferNotSupported",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "receiver"
      }
    ]
  },
  {
    "type": "error",
    "name": "SendEthToKeeperFailed",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "keeper"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sendAmount"
      },
      {
        "internalType": "bytes",
        "type": "bytes",
        "name": "result"
      }
    ]
  },
  {
    "type": "error",
    "name": "SequencerDown",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SequencerGraceDurationNotYetPassed",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "timeSinceUp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "sequencerGraceDuration"
      }
    ]
  },
  {
    "type": "error",
    "name": "ShiftFromAndToMarketAreEqual",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "ShiftNotFound",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "ShortTokensAreNotEqual",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "fromMarketLongToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "toMarketLongToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "SignalTimeNotYetPassed",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "signalTime"
      }
    ]
  },
  {
    "type": "error",
    "name": "SubaccountApprovalDeadlinePassed",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "currentTimestamp"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "deadline"
      }
    ]
  },
  {
    "type": "error",
    "name": "SubaccountApprovalExpired",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "account"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "subaccount"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "deadline"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "currentTimestamp"
      }
    ]
  },
  {
    "type": "error",
    "name": "SubaccountIntegrationIdDisabled",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "integrationId"
      }
    ]
  },
  {
    "type": "error",
    "name": "SubaccountNotAuthorized",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "account"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "subaccount"
      }
    ]
  },
  {
    "type": "error",
    "name": "SwapPriceImpactExceedsAmountIn",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "amountAfterFees"
      },
      {
        "internalType": "int256",
        "type": "int256",
        "name": "negativeImpactAmount"
      }
    ]
  },
  {
    "type": "error",
    "name": "SwapsNotAllowedForAtomicWithdrawal",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "longTokenSwapPathLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "shortTokenSwapPathLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "SyncConfigInvalidInputLengths",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "marketsLength"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "parametersLength"
      }
    ]
  },
  {
    "type": "error",
    "name": "SyncConfigInvalidMarketFromData",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "marketFromData"
      }
    ]
  },
  {
    "type": "error",
    "name": "SyncConfigUpdatesDisabledForMarket",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "SyncConfigUpdatesDisabledForMarketParameter",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      },
      {
        "internalType": "string",
        "type": "string",
        "name": "parameter"
      }
    ]
  },
  {
    "type": "error",
    "name": "SyncConfigUpdatesDisabledForParameter",
    "inputs": [
      {
        "internalType": "string",
        "type": "string",
        "name": "parameter"
      }
    ]
  },
  {
    "type": "error",
    "name": "ThereMustBeAtLeastOneRoleAdmin",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ThereMustBeAtLeastOneTimelockMultiSig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TokenPermitsNotAllowedForMultichain",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TokenTransferError",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "receiver"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "amount"
      }
    ]
  },
  {
    "type": "error",
    "name": "Uint256AsBytesLengthExceeds32Bytes",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "length"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnableToGetBorrowingFactorEmptyPoolUsd",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnableToGetCachedTokenPrice",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnableToGetFundingFactorEmptyOpenInterest",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnableToGetOppositeToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "inputToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnableToPayOrderFee",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnableToPayOrderFeeFromCollateral",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnableToWithdrawCollateral",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "estimatedRemainingCollateralUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "msgSender"
      },
      {
        "internalType": "string",
        "type": "string",
        "name": "role"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedBorrowingFactor",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "positionBorrowingFactor"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "cumulativeBorrowingFactor"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedMarket",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnexpectedPoolValue",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "poolValue"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedPositionState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnexpectedRelayFeeToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "feeToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedFeeToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedRelayFeeTokenAfterSwap",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "feeToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedFeeToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedTokenForVirtualInventory",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "token"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "market"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedValidFromTime",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "orderType"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnsupportedOrderType",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "orderType"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnsupportedOrderTypeForAutoCancellation",
    "inputs": [
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "orderType"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnsupportedRelayFeeToken",
    "inputs": [
      {
        "internalType": "address",
        "type": "address",
        "name": "feeToken"
      },
      {
        "internalType": "address",
        "type": "address",
        "name": "expectedFeeToken"
      }
    ]
  },
  {
    "type": "error",
    "name": "UsdDeltaExceedsLongOpenInterest",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "usdDelta"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "longOpenInterest"
      }
    ]
  },
  {
    "type": "error",
    "name": "UsdDeltaExceedsPoolValue",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "usdDelta"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "poolUsd"
      }
    ]
  },
  {
    "type": "error",
    "name": "UsdDeltaExceedsShortOpenInterest",
    "inputs": [
      {
        "internalType": "int256",
        "type": "int256",
        "name": "usdDelta"
      },
      {
        "internalType": "uint256",
        "type": "uint256",
        "name": "shortOpenInterest"
      }
    ]
  },
  {
    "type": "error",
    "name": "WithdrawalNotFound",
    "inputs": [
      {
        "internalType": "bytes32",
        "type": "bytes32",
        "name": "key"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroTreasuryAddress",
    "inputs": []
  }
] as const
