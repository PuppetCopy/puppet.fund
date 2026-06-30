// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Error} from "./Error.sol";
import {IntentLib} from "./IntentLib.sol";
import {Register} from "../core/Register.sol";

bytes32 constant SWAP_PARAMS_TYPEHASH = keccak256(
    "SwapParams(address inputToken,address outputToken,address provider,bytes providerCallData,uint256 inputAmount,uint256 outputAmount)"
);

library SwapLib {
    struct SwapParams {
        address inputToken;
        address outputToken;
        address provider;
        bytes providerCallData;
        uint inputAmount;
        uint outputAmount;
    }

    function hashSwap(
        SwapParams calldata _swap
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SWAP_PARAMS_TYPEHASH,
                _swap.inputToken,
                _swap.outputToken,
                _swap.provider,
                keccak256(_swap.providerCallData),
                _swap.inputAmount,
                _swap.outputAmount
            )
        );
    }

    function verify(
        Register _register,
        uint _maxRelayFeeBps,
        SwapParams calldata _swap,
        uint _actualRelayFee
    ) internal view returns (address) {
        if (_swap.inputAmount == 0) revert Error.Balance__NothingToSwap();
        if (_swap.outputAmount == 0) revert Error.Balance__ZeroSwapOutput();
        if (_actualRelayFee >= _swap.inputAmount) revert Error.Balance__RelayFeeTooHigh();
        uint _providerCap = _register.providerCapMap(_swap.provider);
        if (_providerCap == 0) revert Error.Intent__ProviderNotAllowed(_swap.provider);
        if (_swap.inputAmount > _providerCap) revert Error.Intent__AmountExceedsCap(_swap.inputAmount, _providerCap);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _swap.inputAmount, _maxRelayFeeBps);
        IntentLib.verifyTokenAndCap(_register, _swap.inputToken, _swap.inputAmount);
        return _swap.inputToken;
    }
}
