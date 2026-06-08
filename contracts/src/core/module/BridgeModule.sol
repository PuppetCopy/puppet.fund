// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Access} from "../../utils/auth/Access.sol";
import {CallLib} from "../../utils/CallLib.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";
import {AccountModule} from "./AccountModule.sol";
import {IAccount} from "../interface/IAccount.sol";
import {TransientRoute} from "../TransientRoute.sol";

contract BridgeModule is Access {
    struct BridgeCall {
        IAccount account;
        address transientRoute;
        IERC20 inputToken;
        address provider;
        bytes providerCallData;
        uint inputAmount;
        uint actualRelayFee;
        bool fromTransientRoute;
        uint nonce;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function bridge(
        BridgeCall calldata _call,
        AccountModule _accountModule,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        address _feeReceiver,
        uint _transferGasLimit
    ) external auth {
        uint _settlerInputAmount = _call.inputAmount - _call.actualRelayFee;

        IAccount.Call[] memory _bridgeCalls =
            new IAccount.Call[](_call.fromTransientRoute && _call.actualRelayFee > 0 ? 4 : 3);
        _bridgeCalls[0] = CallLib.approveCall(_call.inputToken, _call.provider, _settlerInputAmount, _transferGasLimit);
        _bridgeCalls[1] =
            IAccount.Call({target: _call.provider, value: 0, gasLimit: 0, callData: _call.providerCallData});
        _bridgeCalls[2] = CallLib.approveCall(_call.inputToken, _call.provider, 0, _transferGasLimit);

        IAccount.Call[] memory _calls;
        uint _amountOut;
        uint _dispatchRelayFee;
        address _dispatchFeeReceiver;
        if (_call.fromTransientRoute) {
            if (_call.actualRelayFee > 0) {
                _bridgeCalls[3] =
                    CallLib.transferCall(_call.inputToken, _feeReceiver, _call.actualRelayFee, _transferGasLimit);
            }
            _calls = new IAccount.Call[](1);
            _calls[0] = IAccount.Call({
                target: _call.transientRoute,
                value: 0,
                gasLimit: 0,
                callData: abi.encodeCall(TransientRoute.execute, (_bridgeCalls))
            });
        } else {
            _calls = _bridgeCalls;
            _amountOut = _settlerInputAmount;
            _dispatchRelayFee = _call.actualRelayFee;
            _dispatchFeeReceiver = _feeReceiver;
        }

        _accountModule.dispatch(
            _call.account,
            _calls,
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _call.nonce,
            _call.fromTransientRoute ? IERC20(address(0)) : _call.inputToken,
            0,
            _amountOut,
            _dispatchRelayFee,
            _dispatchFeeReceiver,
            _transferGasLimit
        );
    }
}
