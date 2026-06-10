// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {V2Base} from "./Base.t.sol";
import {AccountGate, BRIDGE_INTENT_TYPEHASH} from "src/AccountGate.sol";
import {HubGate, WITHDRAW_TO_BRIDGE_INTENT_TYPEHASH} from "src/HubGate.sol";
import {MockBridgeProvider} from "./mock/MockBridgeProvider.t.sol";

contract BridgeFlowsTest is V2Base {
    function test_bridge_runs_to_completion() public {
        Puppet memory p = _makePuppet("P");
        address route = accountModule.predictRoute(address(p.acct));
        vm.chainId(8453);
        bytes32 spokeAccountGateDomain = _domainSep("AccountGate", address(accountGate));

        uint inputAmount = 100e6;
        uint fee = 2e6;
        uint settler = inputAmount - fee;
        usdc.mint(route, inputAmount);

        MockBridgeProvider provider = new MockBridgeProvider();
        bytes memory pcd = abi.encodeCall(
            MockBridgeProvider.fill, (address(usdc), settler, address(usdc), settler, address(p.acct), HUB_CHAIN_ID)
        );

        AccountGate.BridgeIntent memory intent = AccountGate.BridgeIntent({
            params: _params(p.user),
            tokenId: USDC_ID,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: p.nonce,
            chainId: block.chainid,
            provider: address(provider),
            providerCallData: pcd,
            inputAmount: inputAmount,
            outputAmount: settler,
            destinationChainId: HUB_CHAIN_ID,
            expires: uint32(block.timestamp + 3600),
            fillDeadline: uint32(block.timestamp + 7200)
        });
        bytes32 structHash = keccak256(
            abi.encode(
                BRIDGE_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
                intent.tokenId,
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.provider,
                keccak256(intent.providerCallData),
                intent.inputAmount,
                intent.outputAmount,
                intent.destinationChainId,
                intent.expires,
                intent.fillDeadline
            )
        );
        bytes32 digest = _digest(spokeAccountGateDomain, structHash);
        accountGate.bridge(intent, _sign(p.key, digest), _sign(attestorKey, digest), fee);

        assertEq(usdc.balanceOf(address(provider)), settler, "provider consumed settler");
        assertEq(usdc.balanceOf(feeReceiver), fee, "relayer fee");
        assertEq(usdc.balanceOf(route), 0, "route drained");
    }

    function test_withdrawToBridge_runs_to_completion() public {
        Puppet memory p = _makePuppet("BW");
        address route = accountModule.predictRoute(address(p.acct));

        uint inputAmount = 100e6;
        uint destChain = 8453;
        usdc.mint(route, inputAmount);

        MockBridgeProvider provider = new MockBridgeProvider();
        bytes memory pcd = abi.encodeCall(
            MockBridgeProvider.fill, (address(usdc), inputAmount, address(usdc), 99e6, p.user, destChain)
        );

        HubGate.WithdrawToBridgeIntent memory intent = HubGate.WithdrawToBridgeIntent({
            params: _params(p.user),
            tokenId: USDC_ID,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            inputToken: IERC20(address(usdc)),
            outputToken: IERC20(address(usdc)),
            inputAmount: inputAmount,
            outputAmount: 99e6,
            destinationChainId: destChain,
            provider: address(provider),
            providerCallData: pcd,
            expires: 0,
            fillDeadline: 0
        });
        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAW_TO_BRIDGE_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
                intent.tokenId,
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.inputToken,
                intent.outputToken,
                intent.inputAmount,
                intent.outputAmount,
                intent.destinationChainId,
                intent.provider,
                keccak256(pcd),
                intent.expires,
                intent.fillDeadline
            )
        );
        bytes32 digest = _digest(hubGateDomain, structHash);
        hubGate.withdrawToBridge(intent, _sign(p.key, digest), _sign(attestorKey, digest), 0);

        assertEq(provider.openCount(), 1, "provider filled");
        assertEq(usdc.balanceOf(address(provider)), inputAmount, "settler pulled to provider");
        assertEq(usdc.balanceOf(route), 0, "route drained");
    }
}
