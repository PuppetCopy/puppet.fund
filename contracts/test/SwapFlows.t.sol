// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {V2Base} from "./Base.t.sol";
import {PuppetGate, SWAP_INTENT_TYPEHASH, RECOGNIZE_INTENT_TYPEHASH} from "src/PuppetGate.sol";
import {
    FundGate,
    SWAP_INTENT_TYPEHASH as FUND_SWAP_INTENT_TYPEHASH,
    RECOGNIZE_INTENT_TYPEHASH as FUND_RECOGNIZE_INTENT_TYPEHASH
} from "src/FundGate.sol";
import {HubGate, WITHDRAW_INTENT_TYPEHASH} from "src/HubGate.sol";
import {SwapLib, SWAP_PARAMS_TYPEHASH} from "src/utils/SwapLib.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {FundAccountLib} from "src/utils/FundAccountLib.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {Error} from "src/utils/Error.sol";
import {MockBridgeProvider} from "./mock/MockBridgeProvider.t.sol";
import {MockSwapProvider} from "./mock/MockSwapProvider.t.sol";
import {MockReentrantProvider} from "./mock/MockReentrantProvider.t.sol";

contract SwapFlowsTest is V2Base {
    function test_swap_local_credits_output() public {
        Puppet memory p = _makePuppet("SR");
        address route = accountModule.predictRoute(address(p.acct));
        bytes32 domain = _domainSep("PuppetGate", address(puppetGate));

        uint inputAmount = 100e6;
        uint fee = 2e6;
        uint outputAmount = 5e16;
        usdc.mint(route, inputAmount);

        MockSwapProvider provider = new MockSwapProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);
        vm.deal(address(this), outputAmount);
        wnt.deposit{value: outputAmount}();
        wnt.transfer(address(provider), outputAmount);

        bytes memory pcd =
            abi.encodeCall(MockSwapProvider.swap, (address(usdc), inputAmount - fee, address(wnt), outputAmount, route));
        PuppetGate.SwapIntent memory intent =
            _localSwap(p.user, p.nonce, address(provider), pcd, inputAmount, outputAmount, block.chainid);
        bytes32 digest = _digest(domain, _swapStructHash(p.user, intent));
        puppetGate.swap(intent, _sign(p.key, digest), _sign(attestorKey, digest), fee);

        assertEq(usdc.balanceOf(address(provider)), inputAmount - fee, "provider consumed settler from route");
        assertEq(usdc.balanceOf(feeReceiver), fee, "relayer fee from route");
        assertEq(usdc.balanceOf(route), 0, "route input drained");
        assertEq(wnt.balanceOf(address(p.acct)), outputAmount, "output forwarded to account");
        assertEq(wnt.balanceOf(route), 0, "no output surplus left in route");
        assertEq(p.acct.signedBalanceOf(address(usdc)), 0, "no input signed (route source)");
        assertEq(p.acct.signedBalanceOf(address(wnt)), outputAmount, "output signed credited");
    }

    function test_swap_local_surplus_stays_in_route() public {
        Puppet memory p = _makePuppet("SP");
        address route = accountModule.predictRoute(address(p.acct));
        bytes32 domain = _domainSep("PuppetGate", address(puppetGate));

        uint inputAmount = 100e6;
        uint fee = 2e6;
        uint outputAmount = 5e16;
        uint delivered = 6e16;
        usdc.mint(route, inputAmount);

        MockSwapProvider provider = new MockSwapProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);
        vm.deal(address(this), delivered);
        wnt.deposit{value: delivered}();
        wnt.transfer(address(provider), delivered);

        bytes memory pcd =
            abi.encodeCall(MockSwapProvider.swap, (address(usdc), inputAmount - fee, address(wnt), delivered, route));
        PuppetGate.SwapIntent memory intent =
            _localSwap(p.user, p.nonce, address(provider), pcd, inputAmount, outputAmount, block.chainid);
        bytes32 digest = _digest(domain, _swapStructHash(p.user, intent));
        puppetGate.swap(intent, _sign(p.key, digest), _sign(attestorKey, digest), fee);

        assertEq(p.acct.signedBalanceOf(address(wnt)), outputAmount, "only outputAmount credited to signed");
        assertEq(wnt.balanceOf(address(p.acct)), outputAmount, "account holds credited amount");
        assertEq(wnt.balanceOf(route), delivered - outputAmount, "positive-slippage surplus stays in route");
    }

    function test_swap_creates_account() public {
        (address user, uint key) = makeAddrAndKey("SC");
        address acct = accountModule.predictPuppetAccount(_params(user));
        address route = accountModule.predictRoute(acct);
        bytes32 domain = _domainSep("PuppetGate", address(puppetGate));

        uint inputAmount = 100e6;
        uint fee = 2e6;
        uint outputAmount = 5e16;
        usdc.mint(route, inputAmount);

        MockSwapProvider provider = new MockSwapProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);
        vm.deal(address(this), outputAmount);
        wnt.deposit{value: outputAmount}();
        wnt.transfer(address(provider), outputAmount);

        bytes memory pcd =
            abi.encodeCall(MockSwapProvider.swap, (address(usdc), inputAmount - fee, address(wnt), outputAmount, route));
        PuppetGate.SwapIntent memory intent =
            _localSwap(user, 0, address(provider), pcd, inputAmount, outputAmount, block.chainid);
        assertEq(acct.code.length, 0, "account not yet deployed");
        bytes32 digest = _digest(domain, _swapStructHash(user, intent));
        puppetGate.swap(intent, _signDeploy(key), "", _sign(key, digest), _sign(attestorKey, digest), fee);

        assertGt(acct.code.length, 0, "account deployed by swap");
        assertEq(usdc.balanceOf(route), 0, "route drained");
        assertEq(wnt.balanceOf(acct), outputAmount, "output delivered");
        assertEq(PuppetAccount(payable(acct)).signedBalanceOf(address(wnt)), outputAmount, "output signed credited");
    }

    function test_swap_crosschain_sweeps_route() public {
        Puppet memory p = _makePuppet("CC");
        address route = accountModule.predictRoute(address(p.acct));
        vm.chainId(8453);
        bytes32 domain = _domainSep("PuppetGate", address(puppetGate));

        uint inputAmount = 100e6;
        uint fee = 2e6;
        uint settler = inputAmount - fee;
        usdc.mint(route, inputAmount);

        MockBridgeProvider provider = new MockBridgeProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);
        bytes memory pcd = abi.encodeCall(
            MockBridgeProvider.fill, (address(usdc), settler, address(usdc), settler, address(p.acct), HUB_CHAIN_ID)
        );
        PuppetGate.SwapIntent memory intent =
            _localSwap(p.user, p.nonce, address(provider), pcd, inputAmount, settler, HUB_CHAIN_ID);
        bytes32 digest = _digest(domain, _swapStructHash(p.user, intent));
        puppetGate.swap(intent, _sign(p.key, digest), _sign(attestorKey, digest), fee);

        assertEq(provider.openCount(), 1, "provider filled");
        assertEq(usdc.balanceOf(address(provider)), settler, "provider consumed settler");
        assertEq(usdc.balanceOf(feeReceiver), fee, "relayer fee");
        assertEq(usdc.balanceOf(route), 0, "route drained");
        assertEq(p.acct.signedBalanceOf(address(usdc)), 0, "no local credit (output on dest)");
    }

    function test_withdraw_swap_spends_signed_balance() public {
        Puppet memory p = _makePuppet("BW");
        address route = accountModule.predictRoute(address(p.acct));

        uint inputAmount = 100e6;
        uint destChain = 8453;
        _seedSignedUsdc(address(p.acct), inputAmount);

        MockBridgeProvider provider = new MockBridgeProvider();
        bytes memory pcd = abi.encodeCall(
            MockBridgeProvider.fill, (address(usdc), inputAmount, address(usdc), 99e6, p.user, destChain)
        );

        HubGate.WithdrawIntent memory intent = HubGate.WithdrawIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            inputToken: address(usdc),
            outputToken: address(usdc),
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
                WITHDRAW_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
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
        hubGate.withdraw(intent, _sign(p.key, digest), _sign(attestorKey, digest), 0);

        assertEq(provider.openCount(), 1, "provider filled");
        assertEq(usdc.balanceOf(address(provider)), inputAmount, "provider pulled from account");
        assertEq(p.acct.signedBalanceOf(address(usdc)), 0, "signed balance debited");
        assertEq(usdc.balanceOf(address(p.acct)), 0, "account drained");
        assertEq(usdc.balanceOf(route), 0, "route untouched");
    }

    function test_swap_provider_not_allowed_reverts() public {
        Puppet memory p = _makePuppet("PN");
        address route = accountModule.predictRoute(address(p.acct));
        usdc.mint(route, 100e6);
        bytes32 domain = _domainSep("PuppetGate", address(puppetGate));

        MockSwapProvider provider = new MockSwapProvider();
        bytes memory pcd =
            abi.encodeCall(MockSwapProvider.swap, (address(usdc), 98e6, address(wnt), 5e16, route));
        PuppetGate.SwapIntent memory intent =
            _localSwap(p.user, p.nonce, address(provider), pcd, 100e6, 5e16, block.chainid);
        bytes32 digest = _digest(domain, _swapStructHash(p.user, intent));

        vm.expectRevert(abi.encodeWithSelector(Error.Intent__ProviderNotAllowed.selector, address(provider)));
        puppetGate.swap(intent, _sign(p.key, digest), _sign(attestorKey, digest), 2e6);
    }

    function test_swap_local_reverts_on_output_shortfall() public {
        Puppet memory p = _makePuppet("SF");
        address route = accountModule.predictRoute(address(p.acct));
        uint inputAmount = 100e6;
        uint fee = 2e6;
        usdc.mint(route, inputAmount);
        bytes32 domain = _domainSep("PuppetGate", address(puppetGate));

        MockSwapProvider provider = new MockSwapProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);
        vm.deal(address(this), 4e16);
        wnt.deposit{value: 4e16}();
        wnt.transfer(address(provider), 4e16);

        bytes memory pcd =
            abi.encodeCall(MockSwapProvider.swap, (address(usdc), inputAmount - fee, address(wnt), 4e16, route));
        PuppetGate.SwapIntent memory intent =
            _localSwap(p.user, p.nonce, address(provider), pcd, inputAmount, 5e16, block.chainid);
        bytes32 digest = _digest(domain, _swapStructHash(p.user, intent));

        vm.expectRevert();
        puppetGate.swap(intent, _sign(p.key, digest), _sign(attestorKey, digest), fee);
    }

    function test_fundgate_swap_fromroute_local() public {
        Puppet memory master = _makePuppet("FM");
        FundAccountLib.FundAccountInitParams memory fundParams = _fundParams(address(master.acct));
        address fund = accountModule.predictFundAccount(fundParams);
        address fundRoute = accountModule.predictRoute(fund);
        uint inputAmount = 100e6;
        uint fee = 2e6;
        uint outputAmount = 5e16;
        usdc.mint(fundRoute, inputAmount);

        MockSwapProvider provider = new MockSwapProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);
        vm.deal(address(this), outputAmount);
        wnt.deposit{value: outputAmount}();
        wnt.transfer(address(provider), outputAmount);

        bytes memory pcd = abi.encodeCall(
            MockSwapProvider.swap, (address(usdc), inputAmount - fee, address(wnt), outputAmount, fundRoute)
        );
        FundGate.SwapIntent memory intent = FundGate.SwapIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: master.nonce,
            chainId: block.chainid,
            fundParams: fundParams,
            swap: SwapLib.SwapParams({
                inputToken: address(usdc),
                outputToken: address(wnt),
                provider: address(provider),
                providerCallData: pcd,
                inputAmount: inputAmount,
                outputAmount: outputAmount
            }),
            destinationChainId: block.chainid,
            fromRoute: true
        });
        bytes32 digest = _digest(fundGateDomain, _fundSwapStructHash(master.user, intent));
        fundGate.swap(intent, _sign(master.key, digest), _sign(attestorKey, digest), fee);

        assertGt(fund.code.length, 0, "fund deployed by swap");
        assertEq(usdc.balanceOf(fundRoute), 0, "fund route drained");
        assertEq(wnt.balanceOf(fund), outputAmount, "output forwarded to fund");
        assertEq(FundAccount(payable(fund)).signedBalanceOf(address(wnt)), outputAmount, "fund output signed credited");
    }

    function test_fundgate_swap_fromroute_crosschain() public {
        vm.chainId(8453);
        bytes32 domain = _domainSep("FundGate", address(fundGate));
        Puppet memory master = _makePuppet("FRX");
        FundAccountLib.FundAccountInitParams memory fundParams = _fundParams(address(master.acct));
        address fund = accountModule.predictFundAccount(fundParams);
        address fundRoute = accountModule.predictRoute(fund);
        uint inputAmount = 100e6;
        uint fee = 2e6;
        uint settler = inputAmount - fee;
        usdc.mint(fundRoute, inputAmount);

        MockBridgeProvider provider = new MockBridgeProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);
        bytes memory pcd = abi.encodeCall(
            MockBridgeProvider.fill, (address(usdc), settler, address(usdc), settler, fund, HUB_CHAIN_ID)
        );
        FundGate.SwapIntent memory intent = FundGate.SwapIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: master.nonce,
            chainId: block.chainid,
            fundParams: fundParams,
            swap: SwapLib.SwapParams({
                inputToken: address(usdc),
                outputToken: address(usdc),
                provider: address(provider),
                providerCallData: pcd,
                inputAmount: inputAmount,
                outputAmount: settler
            }),
            destinationChainId: HUB_CHAIN_ID,
            fromRoute: true
        });
        bytes32 digest = _digest(domain, _fundSwapStructHash(master.user, intent));
        fundGate.swap(intent, _sign(master.key, digest), _sign(attestorKey, digest), fee);

        assertGt(fund.code.length, 0, "fund deployed by swap");
        assertEq(usdc.balanceOf(fundRoute), 0, "fund route drained");
        assertEq(provider.openCount(), 1, "provider filled");
        assertEq(usdc.balanceOf(address(provider)), settler, "provider consumed settler");
        assertEq(usdc.balanceOf(feeReceiver), fee, "relayer fee");
        assertEq(FundAccount(payable(fund)).signedBalanceOf(address(usdc)), 0, "no local credit (output bridged)");
    }

    function test_fundgate_swap_fromsigned_internal() public {
        Puppet memory master = _makePuppet("FS");
        FundAccountLib.FundAccountInitParams memory fundParams = _fundParams(address(master.acct));
        address fund = accountModule.predictFundAccount(fundParams);
        address fundRoute = accountModule.predictRoute(fund);
        uint seed = 100e6;
        uint inputAmount = 50e6;
        uint fee = 1e6;
        uint outputAmount = 2e16;

        // seed the fund's signed USDC via recognize (deploys the fund + credits route -> signed)
        usdc.mint(fundRoute, seed);
        _fundRecognize(master, fundParams, address(usdc), seed, 0);
        assertEq(FundAccount(payable(fund)).signedBalanceOf(address(usdc)), seed, "fund seeded with signed USDC");

        MockSwapProvider provider = new MockSwapProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);
        vm.deal(address(this), outputAmount);
        wnt.deposit{value: outputAmount}();
        wnt.transfer(address(provider), outputAmount);

        // internal rebalance: signed USDC -> signed WETH, DEX delivers output to the fund itself
        bytes memory pcd =
            abi.encodeCall(MockSwapProvider.swap, (address(usdc), inputAmount - fee, address(wnt), outputAmount, fund));
        FundGate.SwapIntent memory intent = FundGate.SwapIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: master.nonce + 1,
            chainId: block.chainid,
            fundParams: fundParams,
            swap: SwapLib.SwapParams({
                inputToken: address(usdc),
                outputToken: address(wnt),
                provider: address(provider),
                providerCallData: pcd,
                inputAmount: inputAmount,
                outputAmount: outputAmount
            }),
            destinationChainId: block.chainid,
            fromRoute: false
        });
        bytes32 digest = _digest(fundGateDomain, _fundSwapStructHash(master.user, intent));
        fundGate.swap(intent, _sign(master.key, digest), _sign(attestorKey, digest), fee);

        assertEq(FundAccount(payable(fund)).signedBalanceOf(address(usdc)), seed - inputAmount, "input signed debited");
        assertEq(FundAccount(payable(fund)).signedBalanceOf(address(wnt)), outputAmount, "output signed credited");
        assertEq(wnt.balanceOf(fund), outputAmount, "output delivered to fund");
        assertEq(usdc.balanceOf(feeReceiver), fee, "relayer fee from fund");
    }

    function test_recognize_creates_puppet_account() public {
        (address user, uint key) = makeAddrAndKey("RC");
        address acct = accountModule.predictPuppetAccount(_params(user));
        address route = accountModule.predictRoute(acct);
        uint amount = 100e6;
        uint fee = 2e6;
        usdc.mint(route, amount);

        PuppetGate.RecognizeIntent memory intent = PuppetGate.RecognizeIntent({
            params: _params(user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: 0,
            chainId: block.chainid,
            token: address(usdc),
            amount: amount
        });
        bytes32 structHash = keccak256(
            abi.encode(
                RECOGNIZE_INTENT_TYPEHASH,
                _hashAccount(user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.token,
                intent.amount
            )
        );
        bytes32 digest = _digest(puppetGateDomain, structHash);
        assertEq(acct.code.length, 0, "PA not deployed yet");
        puppetGate.recognize(intent, _signDeploy(key), "", _sign(key, digest), _sign(attestorKey, digest), fee);

        assertGt(acct.code.length, 0, "PA deployed by recognize");
        assertEq(PuppetAccount(payable(acct)).signedBalanceOf(address(usdc)), amount - fee, "signed credited net of fee");
        assertEq(usdc.balanceOf(route), 0, "route swept");
    }

    function test_fundgate_recognize_creates_master_and_fund() public {
        (address user, uint key) = makeAddrAndKey("FC");
        address master = accountModule.predictPuppetAccount(_params(user));
        FundAccountLib.FundAccountInitParams memory fundParams = _fundParams(master);
        address fund = accountModule.predictFundAccount(fundParams);
        address fundRoute = accountModule.predictRoute(fund);
        uint amount = 100e6;
        uint fee = 2e6;
        usdc.mint(fundRoute, amount);

        FundGate.RecognizeIntent memory intent = FundGate.RecognizeIntent({
            params: _params(user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: 0,
            chainId: block.chainid,
            fundParams: fundParams,
            token: address(usdc),
            amount: amount
        });
        bytes32 structHash = keccak256(
            abi.encode(
                FUND_RECOGNIZE_INTENT_TYPEHASH,
                _hashAccount(user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                _hashFundParams(fundParams),
                intent.token,
                intent.amount
            )
        );
        bytes32 digest = _digest(fundGateDomain, structHash);
        assertEq(master.code.length, 0, "master not deployed yet");
        fundGate.recognize(intent, _signDeploy(key), "", _sign(key, digest), _sign(attestorKey, digest), fee);

        assertGt(master.code.length, 0, "master deployed by recognize");
        assertGt(fund.code.length, 0, "fund deployed by recognize");
        assertEq(
            FundAccount(payable(fund)).signedBalanceOf(address(usdc)), amount - fee, "fund signed credited net of fee"
        );
    }

    function test_fundgate_swap_fromsigned_crosschain() public {
        vm.chainId(8453);
        bytes32 domain = _domainSep("FundGate", address(fundGate));
        Puppet memory master = _makePuppet("FX");
        FundAccountLib.FundAccountInitParams memory fundParams = _fundParams(address(master.acct));
        address fund = accountModule.predictFundAccount(fundParams);
        accountModule.createFundAccount(master.user, fundParams);
        uint seed = 100e6;
        uint inputAmount = 50e6;
        uint fee = 1e6;
        uint settler = inputAmount - fee;
        _seedSignedUsdc(fund, seed);

        MockBridgeProvider provider = new MockBridgeProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);
        bytes memory pcd = abi.encodeCall(
            MockBridgeProvider.fill, (address(usdc), settler, address(usdc), settler, fund, HUB_CHAIN_ID)
        );
        FundGate.SwapIntent memory intent = FundGate.SwapIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: master.nonce,
            chainId: block.chainid,
            fundParams: fundParams,
            swap: SwapLib.SwapParams({
                inputToken: address(usdc),
                outputToken: address(usdc),
                provider: address(provider),
                providerCallData: pcd,
                inputAmount: inputAmount,
                outputAmount: settler
            }),
            destinationChainId: HUB_CHAIN_ID,
            fromRoute: false
        });
        bytes32 digest = _digest(domain, _fundSwapStructHash(master.user, intent));
        fundGate.swap(intent, _sign(master.key, digest), _sign(attestorKey, digest), fee);

        assertEq(provider.openCount(), 1, "provider filled");
        assertEq(usdc.balanceOf(address(provider)), settler, "provider consumed settler");
        assertEq(usdc.balanceOf(feeReceiver), fee, "relayer fee from fund");
        assertEq(
            FundAccount(payable(fund)).signedBalanceOf(address(usdc)), seed - inputAmount, "input signed debited, no output credit"
        );
    }

    function _fundRecognize(
        Puppet memory master,
        FundAccountLib.FundAccountInitParams memory fundParams,
        address token,
        uint amount,
        uint fee
    ) internal {
        FundGate.RecognizeIntent memory intent = FundGate.RecognizeIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: master.nonce,
            chainId: block.chainid,
            fundParams: fundParams,
            token: token,
            amount: amount
        });
        bytes32 structHash = keccak256(
            abi.encode(
                FUND_RECOGNIZE_INTENT_TYPEHASH,
                _hashAccount(master.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                _hashFundParams(intent.fundParams),
                intent.token,
                intent.amount
            )
        );
        bytes32 digest = _digest(fundGateDomain, structHash);
        fundGate.recognize(intent, _sign(master.key, digest), _sign(attestorKey, digest), fee);
    }

    function test_fundgate_recognize_credits_route() public {
        Puppet memory master = _makePuppet("FR");
        FundAccountLib.FundAccountInitParams memory fundParams = _fundParams(address(master.acct));
        address fund = accountModule.predictFundAccount(fundParams);
        address fundRoute = accountModule.predictRoute(fund);
        uint amount = 100e6;
        uint fee = 2e6;
        usdc.mint(fundRoute, amount);

        FundGate.RecognizeIntent memory intent = FundGate.RecognizeIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: master.nonce,
            chainId: block.chainid,
            fundParams: fundParams,
            token: address(usdc),
            amount: amount
        });
        bytes32 structHash = keccak256(
            abi.encode(
                FUND_RECOGNIZE_INTENT_TYPEHASH,
                _hashAccount(master.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                _hashFundParams(intent.fundParams),
                intent.token,
                intent.amount
            )
        );
        bytes32 digest = _digest(fundGateDomain, structHash);
        fundGate.recognize(intent, _sign(master.key, digest), _sign(attestorKey, digest), fee);

        assertGt(fund.code.length, 0, "fund deployed by recognize");
        assertEq(usdc.balanceOf(fundRoute), 0, "fund route drained");
        assertEq(FundAccount(payable(fund)).signedBalanceOf(address(usdc)), amount - fee, "fund signed credited net of fee");
        assertEq(usdc.balanceOf(feeReceiver), fee, "fee paid");
    }

    function test_swap_reentrancy_blocked() public {
        Puppet memory p = _makePuppet("RE");
        address route = accountModule.predictRoute(address(p.acct));
        usdc.mint(route, 100e6);
        bytes32 domain = _domainSep("PuppetGate", address(puppetGate));

        MockReentrantProvider provider = new MockReentrantProvider();
        vm.prank(owner);
        register.setProvider(address(provider), type(uint).max);

        // arm the provider to re-enter recognize() on the same account during the swap's DEX leg
        PuppetGate.RecognizeIntent memory rIntent = PuppetGate.RecognizeIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce + 1,
            chainId: block.chainid,
            token: address(usdc),
            amount: 10e6
        });
        bytes32 rHash = keccak256(
            abi.encode(
                RECOGNIZE_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
                rIntent.blockNumber,
                rIntent.deadline,
                rIntent.acceptableRelayFee,
                rIntent.nonce,
                rIntent.chainId,
                rIntent.token,
                rIntent.amount
            )
        );
        bytes32 rDigest = _digest(domain, rHash);
        provider.arm(
            address(puppetGate),
            abi.encodeWithSignature(
                "recognize(((address,address),uint256,uint256,uint256,uint256,uint256,address,uint256),bytes,bytes,uint256)",
                rIntent,
                _sign(p.key, rDigest),
                _sign(attestorKey, rDigest),
                uint(0)
            )
        );

        bytes memory pcd =
            abi.encodeCall(MockReentrantProvider.swap, (address(usdc), 98e6, address(wnt), 5e16, route));
        PuppetGate.SwapIntent memory intent =
            _localSwap(p.user, p.nonce, address(provider), pcd, 100e6, 5e16, block.chainid);
        bytes32 digest = _digest(domain, _swapStructHash(p.user, intent));

        vm.expectRevert(Error.Module__Reentrant.selector);
        puppetGate.swap(intent, _sign(p.key, digest), _sign(attestorKey, digest), 2e6);
    }

    function _localSwap(
        address _user,
        uint _nonce,
        address _provider,
        bytes memory _pcd,
        uint _inputAmount,
        uint _outputAmount,
        uint _destinationChainId
    ) internal view returns (PuppetGate.SwapIntent memory) {
        return PuppetGate.SwapIntent({
            params: _params(_user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 2e6,
            nonce: _nonce,
            chainId: block.chainid,
            swap: SwapLib.SwapParams({
                inputToken: address(usdc),
                outputToken: _destinationChainId == block.chainid ? address(wnt) : address(usdc),
                provider: _provider,
                providerCallData: _pcd,
                inputAmount: _inputAmount,
                outputAmount: _outputAmount
            }),
            destinationChainId: _destinationChainId
        });
    }

    function _hashSwapParams(
        SwapLib.SwapParams memory _swap
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

    function _swapStructHash(
        address _user,
        PuppetGate.SwapIntent memory _intent
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SWAP_INTENT_TYPEHASH,
                _hashAccount(_user, address(0)),
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
                _hashSwapParams(_intent.swap),
                _intent.destinationChainId
            )
        );
    }

    function _fundSwapStructHash(
        address _user,
        FundGate.SwapIntent memory _intent
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FUND_SWAP_INTENT_TYPEHASH,
                _hashAccount(_user, address(0)),
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
                _hashFundParams(_intent.fundParams),
                _hashSwapParams(_intent.swap),
                _intent.destinationChainId,
                _intent.fromRoute
            )
        );
    }
}
