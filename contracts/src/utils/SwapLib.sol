// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAccount} from "./interfaces/IAccount.sol";
import {CallLib} from "./CallLib.sol";
import {NATIVE_TOKEN} from "./Native.sol";
import {Error} from "./Error.sol";
import {IntentLib} from "./IntentLib.sol";
import {Register} from "../core/Register.sol";

bytes32 constant SWAP_PARAMS_TYPEHASH = keccak256(
    "SwapParams(address inputToken,uint256 inputAmount,address outputToken,uint256 outputAmount,address provider,bytes providerCallData)"
);

library SwapLib {
    struct SwapParams {
        address inputToken;
        uint inputAmount;
        address outputToken;
        uint outputAmount;
        address provider;
        bytes providerCallData;
    }

    function hashSwap(
        SwapParams calldata _swap
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SWAP_PARAMS_TYPEHASH,
                _swap.inputToken,
                _swap.inputAmount,
                _swap.outputToken,
                _swap.outputAmount,
                _swap.provider,
                keccak256(_swap.providerCallData)
            )
        );
    }

    function verify(
        Register _register,
        SwapParams calldata _swap,
        uint _relayFee,
        uint _maxRelayFeeBps
    ) internal view {
        if (_swap.inputAmount == 0) revert Error.Balance__NothingToSwap();
        if (_swap.outputAmount == 0) revert Error.Balance__ZeroSwapOutput();
        if (_swap.provider == address(0)) revert Error.Intent__InvalidProvider();
        IntentLib.verifyRelayFeeRatio(_relayFee, _swap.inputAmount, _maxRelayFeeBps);
        IntentLib.verifyRegisteredTokenAndCap(_register, _swap.inputToken, _swap.inputAmount);
    }

    function calls(
        address _inputToken,
        uint _inputAmount,
        address _feeReceiver,
        uint _fee,
        address _provider,
        bytes memory _providerCallData,
        uint _gasLimit
    ) internal pure returns (IAccount.Call[] memory legs_) {
        uint _settled = _inputAmount - _fee;

        if (_inputToken == NATIVE_TOKEN) {
            legs_ = new IAccount.Call[](2);
            legs_[0] = IAccount.Call({target: _provider, value: _settled, gasLimit: 0, callData: _providerCallData});
        } else {
            legs_ = new IAccount.Call[](4);
            legs_[0] = IAccount.Call({
                target: _inputToken,
                value: 0,
                gasLimit: _gasLimit,
                callData: abi.encodeCall(IERC20.approve, (_provider, _settled))
            });
            legs_[1] = IAccount.Call({target: _provider, value: 0, gasLimit: 0, callData: _providerCallData});
            legs_[2] = IAccount.Call({
                target: _inputToken,
                value: 0,
                gasLimit: _gasLimit,
                callData: abi.encodeCall(IERC20.approve, (_provider, 0))
            });
        }

        legs_[legs_.length - 1] = CallLib.pay(_inputToken, _feeReceiver, _fee, _gasLimit);
    }
}
