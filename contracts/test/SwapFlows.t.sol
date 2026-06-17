// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {V2Base} from "./Base.t.sol";
import {AccountGate, SWAP_INTENT_TYPEHASH} from "src/AccountGate.sol";
import {HubGate, WITHDRAW_TO_SWAP_INTENT_TYPEHASH} from "src/HubGate.sol";
import {MockBridgeProvider} from "./mock/MockBridgeProvider.t.sol";

contract SwapFlowsTest is V2Base {
    function test_swap_runs_to_completion() public {
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

        AccountGate.SwapIntent memory intent = AccountGate.SwapIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: p.nonce,
            chainId: block.chainid,
            inputTokenId: USDC_ID,
            outputTokenId: USDC_ID,
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
                SWAP_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.inputTokenId,
                intent.outputTokenId,
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
        accountGate.swap(intent, _sign(p.key, digest), _sign(attestorKey, digest), fee);

        assertEq(usdc.balanceOf(address(provider)), settler, "provider consumed settler");
        assertEq(usdc.balanceOf(feeReceiver), fee, "relayer fee");
        assertEq(usdc.balanceOf(route), 0, "route drained");
    }

    function test_withdrawToSwap_runs_to_completion() public {
        Puppet memory p = _makePuppet("BW");
        address route = accountModule.predictRoute(address(p.acct));

        uint inputAmount = 100e6;
        uint destChain = 8453;
        usdc.mint(route, inputAmount);

        MockBridgeProvider provider = new MockBridgeProvider();
        bytes memory pcd = abi.encodeCall(
            MockBridgeProvider.fill, (address(usdc), inputAmount, address(usdc), 99e6, p.user, destChain)
        );

        HubGate.WithdrawToSwapIntent memory intent = HubGate.WithdrawToSwapIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            inputTokenId: USDC_ID,
            outputTokenId: USDC_ID,
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
                WITHDRAW_TO_SWAP_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.inputTokenId,
                intent.outputTokenId,
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
        hubGate.withdrawToSwap(intent, _sign(p.key, digest), _sign(attestorKey, digest), 0);

        assertEq(provider.openCount(), 1, "provider filled");
        assertEq(usdc.balanceOf(address(provider)), inputAmount, "settler pulled to provider");
        assertEq(usdc.balanceOf(route), 0, "route drained");
    }
}
