// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Test} from "forge-std/src/Test.sol";
import {grantGate} from "./util/grantGate.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {AccountModule} from "src/core/module/AccountModule.sol";
import {CREATE_MASTER_ACCOUNT_INTENT_TYPEHASH} from "src/core/module/AccountModule.sol";
import {WalletDepositModule} from "src/core/module/WalletDepositModule.sol";
import {Dictate} from "src/core/Dictate.sol";
import {TransientRoute} from "src/core/TransientRoute.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {MasterAccount} from "src/core/MasterAccount.sol";
import {RegisterModule} from "src/core/module/RegisterModule.sol";
import {
    SpokeGate,
    BRIDGE_HUB_INTENT_TYPEHASH,
    BRIDGE_INTENT_TYPEHASH as MASTER_BRIDGE_INTENT_TYPEHASH,
    OPERATE_INTENT_TYPEHASH,
    MASTER_SIGN_RECORDED_BALANCE_INTENT_TYPEHASH
} from "src/spoke/SpokeGate.sol";
import {CoreGate, SIGN_TRANSIENT_ROUTE_BALANCE_INTENT_TYPEHASH} from "src/core/CoreGate.sol";
import {Attest} from "src/core/Attest.sol";
import {IAccount} from "src/core/interface/IAccount.sol";
import {ACCOUNT_TYPEHASH, AccountLib} from "src/core/AccountLib.sol";
import {Error} from "src/utils/Error.sol";

import {MockERC20} from "./mock/MockERC20.t.sol";
import {MockWNT} from "./mock/MockWNT.t.sol";
import {IWNT} from "src/utils/interfaces/IWNT.sol";

contract MockSpokePool {
    address public lastDepositor;
    address public lastRecipient;
    address public lastInputToken;
    address public lastOutputToken;
    uint public lastInputAmount;
    uint public lastOutputAmount;
    uint public lastDestinationChainId;
    uint public depositCount;

    function depositV3(
        address _depositor,
        address _recipient,
        address _inputToken,
        address _outputToken,
        uint _inputAmount,
        uint _outputAmount,
        uint _destinationChainId,
        address,
        /*_exclusiveRelayer*/
        uint32,
        /*_quoteTimestamp*/
        uint32,
        /*_fillDeadline*/
        uint32,
        /*_exclusivityDeadline*/
        bytes calldata /*_message*/
    ) external payable {
        SafeERC20.safeTransferFrom(IERC20(_inputToken), msg.sender, address(this), _inputAmount);
        lastDepositor = _depositor;
        lastRecipient = _recipient;
        lastInputToken = _inputToken;
        lastOutputToken = _outputToken;
        lastInputAmount = _inputAmount;
        lastOutputAmount = _outputAmount;
        lastDestinationChainId = _destinationChainId;
        depositCount++;
    }
}

contract BridgeHubE2ETest is Test {
    bytes32 constant USDC_ID = keccak256("USDC");
    uint constant TRANSFER_GAS_LIMIT = 200_000;
    uint constant HUB_CHAIN_ID = 42_161;
    uint constant ORIGIN_CHAIN_ID = 8453;

    address owner = makeAddr("Owner");
    address attestor;
    uint attestorKey;
    address user;
    uint userKey;
    address feeReceiver = makeAddr("FeeReceiver");

    MockERC20 usdc;
    MockWNT weth;
    Dictate dictate;
    AccountModule accountGate;
    RegisterModule register;
    CoreGate coreGate;
    SpokeGate walletGate;
    WalletDepositModule walletDeposit;
    MockSpokePool spokePool;
    address depositPuppetAccountAddr;
    bytes32 walletDomainSeparator;

    PuppetAccount puppet;
    TransientRoute transientRoute;
    AccountLib.AccountInitParams params;

    uint nonce;

    function setUp() public {
        (attestor, attestorKey) = makeAddrAndKey("Attestor");
        (user, userKey) = makeAddrAndKey("User");

        vm.startPrank(owner);
        usdc = new MockERC20("USDC", "USDC", 6);
        weth = new MockWNT();
        dictate = new Dictate(owner);

        register = new RegisterModule(dictate, HUB_CHAIN_ID);

        PuppetAccount accountImpl = new PuppetAccount();
        TransientRoute depositPuppetAccount = new TransientRoute();
        MasterAccount masterPuppetAccount = new MasterAccount();
        depositPuppetAccountAddr = address(depositPuppetAccount);
        Attest attest = new Attest(dictate);
        accountGate = new AccountModule(
            dictate, attest, address(accountImpl), address(depositPuppetAccount), address(masterPuppetAccount)
        );
        dictate.setAccess(attest, address(accountGate));

        walletDeposit = new WalletDepositModule(dictate, register);

        spokePool = new MockSpokePool();

        coreGate = new CoreGate(
            dictate, accountGate, walletDeposit, register,
            CoreGate.Config({
                attestor: attestor,
                feeReceiver: feeReceiver,
                transferGasLimit: TRANSFER_GAS_LIMIT,
                maxBlockDelay: 5,
                maxRelayFeeBps: 1000
            })
        );
        walletGate = new SpokeGate(
            dictate, accountGate, register, HUB_CHAIN_ID,
            SpokeGate.Config({
                attestor: attestor,
                feeReceiver: feeReceiver,
                transferGasLimit: TRANSFER_GAS_LIMIT,
                maxBlockDelay: 5,
                acrossSpokePool: address(spokePool),
                maxRelayFeeBps: 1000
            })
        );
        dictate.setAccess(walletDeposit, address(coreGate));
        dictate.setAccess(walletDeposit, address(this));
        grantGate(dictate, accountGate, address(coreGate));
        grantGate(dictate, accountGate, address(walletGate));
        grantGate(dictate, accountGate, address(this));
        dictate.setAccess(register, address(this));
        vm.stopPrank();
        vm.chainId(HUB_CHAIN_ID);
        register.registerToken(USDC_ID, IERC20(address(usdc)), 0, address(usdc));
        register.registerToken(keccak256("WETH"), IERC20(address(weth)), 0, address(weth));
        register.setWnt(keccak256("WETH"));

        params = AccountLib.AccountInitParams({
            user: user, name: bytes32("Puppet"), baseTokenId: USDC_ID, signer: address(0)
        });

        (puppet,) = accountGate.createPuppetAccount(params, _signDeployAuth(userKey), "");
        transientRoute = TransientRoute(payable(accountGate.predictTransientRoute(address(puppet))));

        walletDomainSeparator = _domainSeparator("SpokeGate", address(walletGate));
    }

    function test_registerToken_revertsOnSelfHubTokenOnSpoke() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        bytes32 _spokeUsdcId = keccak256("SPOKE_USDC");
        vm.expectRevert(
            abi.encodeWithSelector(Error.Register__SelfHubTokenOnSpoke.selector, ORIGIN_CHAIN_ID, address(usdc))
        );
        register.registerToken(_spokeUsdcId, IERC20(address(usdc)), 0, address(usdc));
    }

    function test_registerToken_allowsSelfHubTokenOnHub() public {
        vm.chainId(HUB_CHAIN_ID);
        bytes32 _hubUsdcId = keccak256("HUB_USDC");
        register.registerToken(_hubUsdcId, IERC20(address(usdc)), 0, address(usdc));
        assertEq(register.getTokenInfo(_hubUsdcId).hubToken, address(usdc));
    }

    function test_e2e_bridge_then_recognize_full_flow() public {
        uint inputAmount = 100e6;
        uint bridgeFee = 1e6;
        uint relayFee = 1e6;
        uint acrossInputAmount = inputAmount - relayFee;
        uint expectedOutputAmount = acrossInputAmount - bridgeFee;

        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, inputAmount);

        SpokeGate.BridgeHubIntent memory intent =
            _buildBridge({_inputAmount: inputAmount, _bridgeFee: bridgeFee, _relayFee: relayFee});
        bytes32 digest = _bridgeDigest(intent);
        nonce++;
        walletGate.bridgeHub(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), relayFee);

        assertEq(usdc.balanceOf(address(puppet)), 0, "origin puppet fully swept");
        assertEq(usdc.balanceOf(address(spokePool)), acrossInputAmount, "bridge pool received input minus relayFee");
        assertEq(usdc.balanceOf(feeReceiver), relayFee, "feeReceiver paid origin relayFee");
        assertEq(puppet.signedBalance(), 0, "origin puppet signedBalance net zero");

        assertEq(spokePool.depositCount(), 1);
        assertEq(spokePool.lastInputAmount(), acrossInputAmount);
        assertEq(spokePool.lastOutputAmount(), expectedOutputAmount);
        assertEq(spokePool.lastDestinationChainId(), HUB_CHAIN_ID);
        assertEq(spokePool.lastDepositor(), address(puppet));
        assertEq(spokePool.lastRecipient(), address(transientRoute), "Across recipient = hub TransientRoute");
        assertEq(spokePool.lastInputToken(), address(usdc));
        assertEq(spokePool.lastOutputToken(), address(usdc));

        vm.chainId(HUB_CHAIN_ID);
        usdc.mint(address(transientRoute), expectedOutputAmount);
        assertEq(usdc.balanceOf(address(transientRoute)), expectedOutputAmount, "TR credited via Across fill");

        CoreGate.SignTransientRouteBalanceIntent memory recognizeIntent = CoreGate.SignTransientRouteBalanceIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: params,
            amount: expectedOutputAmount,
            acceptableRelayFee: 0,
            nonce: nonce,
            chainId: block.chainid
        });
        bytes32 recognizeStructHash = keccak256(
            abi.encode(
                SIGN_TRANSIENT_ROUTE_BALANCE_INTENT_TYPEHASH,
                _hashAccount(recognizeIntent.params),
                recognizeIntent.blockNumber,
                recognizeIntent.deadline,
                recognizeIntent.acceptableRelayFee,
                recognizeIntent.nonce,
                recognizeIntent.chainId,
                recognizeIntent.amount
            )
        );
        bytes32 recognizeDigest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator("CoreGate", address(coreGate)), recognizeStructHash)
        );
        coreGate.signTransientRouteBalance(
            recognizeIntent, _signDigest(userKey, recognizeDigest), _signDigest(attestorKey, recognizeDigest), 0
        );

        assertEq(usdc.balanceOf(address(puppet)), expectedOutputAmount, "puppet credited bridged amount");
        assertEq(usdc.balanceOf(feeReceiver), relayFee, "feeReceiver paid only origin leg");
        assertEq(puppet.signedBalance(), expectedOutputAmount, "signedBalance reflects credit");
    }

    function test_e2e_universal_create2_address_matches_across_chains() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        address originPrediction =
            AccountLib.predictTransientRoute(depositPuppetAccountAddr, address(accountGate), address(puppet));

        vm.chainId(HUB_CHAIN_ID);
        address hubPrediction =
            AccountLib.predictTransientRoute(depositPuppetAccountAddr, address(accountGate), address(puppet));

        assertEq(originPrediction, hubPrediction, "transientRoute address universal across chains");
        assertEq(originPrediction, address(transientRoute), "matches deployed instance");
    }

    function test_e2e_partial_bridge_leaves_origin_surplus() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, 200e6);

        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 100e6, _bridgeFee: 1e6, _relayFee: 1e6});
        bytes32 digest = _bridgeDigest(intent);
        nonce++;
        walletGate.bridgeHub(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 1e6);

        assertEq(usdc.balanceOf(address(puppet)), 100e6, "surplus stays in origin account");
        assertEq(usdc.balanceOf(address(spokePool)), 99e6);
        assertEq(usdc.balanceOf(feeReceiver), 1e6);
        assertEq(puppet.signedBalance(), 100e6, "remainder still signed");
    }

    function test_bridge_zero_balance_reverts() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 0, _bridgeFee: 0, _relayFee: 0});
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert(Error.Deposit__NothingToBridge.selector);
        walletGate.bridgeHub(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 0);
    }

    function test_bridge_bridgeFee_eq_input_reverts() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, 50e6);
        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 50e6, _bridgeFee: 50e6, _relayFee: 0});
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__BridgeFeeExceedsInput.selector, 50e6, 50e6));
        walletGate.bridgeHub(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 0);
    }

    function test_bridge_underfunded_reverts() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, 40e6);

        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 50e6, _bridgeFee: 1e6, _relayFee: 1e6});
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__InsufficientBalance.selector, 40e6, 50e6));
        walletGate.bridgeHub(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 1e6);
    }

    function test_bridge_requires_auth() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, 50e6);
        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 50e6, _bridgeFee: 1e6, _relayFee: 0});
        bytes32 digest = _bridgeDigest(intent);
        bytes memory sig = _signDigest(userKey, digest);
        (, uint attackerKey) = makeAddrAndKey("Attacker");
        bytes memory att = _signDigest(attackerKey, digest);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        walletGate.bridgeHub(intent, sig, att, 0);
    }

    function test_bridge_wrong_signer_reverts() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, 100e6);
        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 50e6, _bridgeFee: 1e6, _relayFee: 0});
        bytes32 digest = _bridgeDigest(intent);
        (, uint attackerKey) = makeAddrAndKey("Attacker");
        bytes memory sig = _signDigest(attackerKey, digest);
        bytes memory att = _signDigest(attestorKey, digest);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        walletGate.bridgeHub(intent, sig, att, 0);
    }

    function test_bridge_nonce_reuse_reverts() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, 200e6);

        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 50e6, _bridgeFee: 1e6, _relayFee: 0});
        bytes32 digest1 = _bridgeDigest(intent);
        nonce++;
        walletGate.bridgeHub(intent, _signDigest(userKey, digest1), _signDigest(attestorKey, digest1), 0);

        bytes32 digest2 = _bridgeDigest(intent);
        vm.expectRevert();
        walletGate.bridgeHub(intent, _signDigest(userKey, digest2), _signDigest(attestorKey, digest2), 0);
    }

    function test_bridge_no_relayFee_passthrough() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, 100e6);

        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 100e6, _bridgeFee: 1e6, _relayFee: 0});
        bytes32 digest = _bridgeDigest(intent);
        nonce++;
        walletGate.bridgeHub(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 0);

        assertEq(usdc.balanceOf(address(puppet)), 0);
        assertEq(usdc.balanceOf(address(spokePool)), 100e6);
        assertEq(usdc.balanceOf(feeReceiver), 0);
        assertEq(puppet.signedBalance(), 0);
    }

    function test_bridge_wrong_output_token_reverts() public {
        address wrongHubToken = makeAddr("WrongHubTokenOnArbitrum");

        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, 100e6);

        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 100e6, _bridgeFee: 1e6, _relayFee: 0});
        intent.outputToken = IERC20(wrongHubToken);
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert(
            abi.encodeWithSelector(Error.Deposit__BaseTokenMismatch.selector, USDC_ID, address(usdc), wrongHubToken)
        );
        walletGate.bridgeHub(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 0);
    }

    function test_bridge_non_hub_destination_reverts() public {
        vm.chainId(ORIGIN_CHAIN_ID);
        _seedAccounted(puppet, 100e6);

        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_inputAmount: 100e6, _bridgeFee: 1e6, _relayFee: 0});
        intent.destinationChainId = 1;
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__InvalidDestinationChain.selector, HUB_CHAIN_ID, 1));
        walletGate.bridgeHub(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 0);
    }

    function test_depositWnt_wraps_and_credits_DA() public {
        address wethPuppet = makeAddr("WethPuppetDA");
        uint amount = 0.5 ether;
        vm.deal(address(this), amount);

        assertEq(weth.balanceOf(wethPuppet), 0, "DA starts with no WETH");

        walletDeposit.depositWnt{value: amount}(user, wethPuppet, IWNT(address(weth)), TRANSFER_GAS_LIMIT);

        assertEq(weth.balanceOf(wethPuppet), amount, "DA receives WETH equal to msg.value");
        assertEq(address(weth).balance, amount, "WETH contract holds the native ETH");
        assertEq(address(walletDeposit).balance, 0, "WalletDepositModule holds no ETH");
    }

    function test_depositWnt_zero_value_reverts() public {
        vm.expectRevert(Error.WalletDeposit__ZeroAmount.selector);
        walletDeposit.depositWnt{value: 0}(user, makeAddr("WethPuppetDA"), IWNT(address(weth)), TRANSFER_GAS_LIMIT);
    }

    function test_depositWnt_unauthorized_caller_reverts() public {
        vm.deal(makeAddr("Attacker"), 0.1 ether);
        vm.prank(makeAddr("Attacker"));
        vm.expectRevert(Error.Access__Unauthorized.selector);
        walletDeposit.depositWnt{value: 0.1 ether}(user, makeAddr("DA"), IWNT(address(weth)), TRANSFER_GAS_LIMIT);
    }

    function test_setWnt_revertsOnUnknownBaseTokenId() public {
        vm.chainId(HUB_CHAIN_ID);
        bytes32 _unknown = keccak256("UNKNOWN");
        vm.expectRevert(abi.encodeWithSelector(Error.Register__UnknownBaseTokenId.selector, _unknown));
        register.setWnt(_unknown);
    }

    function test_getWnt_revertsWhenUnset() public {
        vm.chainId(HUB_CHAIN_ID);
        RegisterModule freshRegister = new RegisterModule(dictate, HUB_CHAIN_ID);
        vm.expectRevert(Error.Register__WntNotSet.selector);
        freshRegister.getWnt();
    }

    function test_master_bridge_fromAccount() public {
        _createMaster(params, userKey);
        address master = address(accountGate.verifyMasterAccount(params));
        address masterDA = accountGate.predictTransientRoute(master);
        uint amount = 100e6;
        usdc.mint(master, amount);
        vm.store(master, bytes32(uint(0)), bytes32(amount));

        vm.chainId(ORIGIN_CHAIN_ID);
        SpokeGate.BridgeIntent memory intent = _buildMasterBridge(false, amount, 1e6, 1e6);
        bytes32 digest = _masterBridgeDigest(intent);
        walletGate.bridge(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 1e6);

        assertEq(spokePool.lastDepositor(), master, "depositor = master account");
        assertEq(spokePool.lastRecipient(), masterDA, "recipient = master TransientRoute");
        assertEq(spokePool.lastInputAmount(), amount - 1e6, "across input = total minus relayFee");
        assertEq(usdc.balanceOf(feeReceiver), 1e6, "feeReceiver paid");
        assertEq(MasterAccount(payable(master)).signedBalance(), 0, "master signedBalance swept");
    }

    function test_master_bridge_fromTransientRoute() public {
        _createMaster(params, userKey);
        address master = address(accountGate.verifyMasterAccount(params));
        address masterDA = accountGate.predictTransientRoute(master);
        uint amount = 100e6;
        usdc.mint(masterDA, amount);

        vm.chainId(ORIGIN_CHAIN_ID);
        SpokeGate.BridgeIntent memory intent = _buildMasterBridge(true, amount, 1e6, 1e6);
        bytes32 digest = _masterBridgeDigest(intent);
        walletGate.bridge(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 1e6);

        assertEq(spokePool.lastDepositor(), masterDA, "depositor = master TransientRoute");
        assertEq(spokePool.lastRecipient(), masterDA, "recipient = master TransientRoute");
        assertEq(usdc.balanceOf(masterDA), 0, "master DA spent: input plus relayFee");
        assertEq(usdc.balanceOf(feeReceiver), 1e6, "feeReceiver paid from DA");
        assertEq(MasterAccount(payable(master)).signedBalance(), 0, "master signedBalance untouched");
    }

    function test_master_operate() public {
        _createMaster(params, userKey);
        address master = address(accountGate.verifyMasterAccount(params));
        uint amount = 50e6;
        usdc.mint(master, amount);
        vm.store(master, bytes32(uint(0)), bytes32(amount));

        IAccount.Call[] memory _emptyCalls = new IAccount.Call[](0);
        SpokeGate.OperateIntent memory intent = SpokeGate.OperateIntent({
            params: params,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: 1,
            chainId: block.chainid,
            baseToken: IERC20(address(usdc)),
            callList: _emptyCalls,
            amountIn: 0,
            amountOut: 0
        });
        bytes32 _sh = keccak256(
            abi.encode(
                OPERATE_INTENT_TYPEHASH,
                _hashAccount(params),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.baseToken,
                keccak256(abi.encode(intent.callList)),
                intent.amountIn,
                intent.amountOut
            )
        );
        bytes32 _dom = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SpokeGate"),
                keccak256("1"),
                block.chainid,
                address(walletGate)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _dom, _sh));

        walletGate.operate(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 0);

        assertEq(MasterAccount(payable(master)).signedBalance(), amount, "signedBalance unchanged by no-op operate");
    }

    function test_master_signRecordedBalance() public {
        _createMaster(params, userKey);
        address master = address(accountGate.verifyMasterAccount(params));
        address masterDA = accountGate.predictTransientRoute(master);
        uint amount = 75e6;
        usdc.mint(masterDA, amount);

        SpokeGate.MasterSignRecordedBalanceIntent memory intent = SpokeGate.MasterSignRecordedBalanceIntent({
            params: params,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: 1,
            chainId: block.chainid,
            amount: amount,
            fromTransientRoute: true
        });
        bytes32 digest = _masterSignRecordedBalanceDigest(intent);

        walletGate.signRecordedBalance(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 0);

        assertEq(usdc.balanceOf(masterDA), 0, "TR fully swept");
        assertEq(usdc.balanceOf(master), amount, "master received TR funds");
        assertEq(MasterAccount(payable(master)).signedBalance(), amount, "master signedBalance credited");
    }

    function test_master_signRecordedBalance_refundPath() public {
        _createMaster(params, userKey);
        address master = address(accountGate.verifyMasterAccount(params));
        address masterDA = accountGate.predictTransientRoute(master);
        uint amount = 40e6;
        usdc.mint(master, amount);

        SpokeGate.MasterSignRecordedBalanceIntent memory intent = SpokeGate.MasterSignRecordedBalanceIntent({
            params: params,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: 1,
            chainId: block.chainid,
            amount: amount,
            fromTransientRoute: false
        });
        bytes32 digest = _masterSignRecordedBalanceDigest(intent);

        walletGate.signRecordedBalance(intent, _signDigest(userKey, digest), _signDigest(attestorKey, digest), 0);

        assertEq(usdc.balanceOf(masterDA), 0, "TR untouched");
        assertEq(usdc.balanceOf(master), amount, "master balance unchanged");
        assertEq(MasterAccount(payable(master)).signedBalance(), amount, "refund credited to signedBalance");
    }

    function _masterSignRecordedBalanceDigest(
        SpokeGate.MasterSignRecordedBalanceIntent memory _intent
    ) internal view returns (bytes32) {
        bytes32 _structHash = keccak256(
            abi.encode(
                MASTER_SIGN_RECORDED_BALANCE_INTENT_TYPEHASH,
                _hashAccount(_intent.params),
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
                _intent.fromTransientRoute,
                _intent.amount
            )
        );
        return
            keccak256(abi.encodePacked("\x19\x01", _domainSeparator("SpokeGate", address(walletGate)), _structHash));
    }

    function _buildMasterBridge(
        bool _fromTransientRoute,
        uint _inputAmount,
        uint _bridgeFee,
        uint _relayFee
    ) internal view returns (SpokeGate.BridgeIntent memory) {
        return SpokeGate.BridgeIntent({
            params: params,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: _relayFee,
            nonce: 1,
            chainId: block.chainid,
            fromTransientRoute: _fromTransientRoute,
            inputToken: IERC20(address(usdc)),
            outputToken: IERC20(address(usdc)),
            inputAmount: _inputAmount,
            bridgeFee: _bridgeFee,
            destinationChainId: 1,
            exclusiveRelayer: address(0),
            quoteTimestamp: uint32(block.timestamp),
            fillDeadline: uint32(block.timestamp + 3600),
            exclusivityDeadline: 0
        });
    }

    function _masterBridgeDigest(
        SpokeGate.BridgeIntent memory _intent
    ) internal view returns (bytes32) {
        bytes32 _structHash = keccak256(
            abi.encode(
                MASTER_BRIDGE_INTENT_TYPEHASH,
                _hashAccount(_intent.params),
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
                _intent.fromTransientRoute,
                _intent.inputToken,
                _intent.outputToken,
                _intent.inputAmount,
                _intent.bridgeFee,
                _intent.destinationChainId,
                _intent.exclusiveRelayer,
                _intent.quoteTimestamp,
                _intent.fillDeadline,
                _intent.exclusivityDeadline
            )
        );
        return
            keccak256(abi.encodePacked("\x19\x01", _domainSeparator("SpokeGate", address(walletGate)), _structHash));
    }

    function _buildBridge(
        uint _inputAmount,
        uint _bridgeFee,
        uint _relayFee
    ) internal view returns (SpokeGate.BridgeHubIntent memory) {
        return _buildBridge({_fromTransientRoute: false, _inputAmount: _inputAmount, _bridgeFee: _bridgeFee, _relayFee: _relayFee});
    }

    function _buildBridge(
        bool _fromTransientRoute,
        uint _inputAmount,
        uint _bridgeFee,
        uint _relayFee
    ) internal view returns (SpokeGate.BridgeHubIntent memory) {
        return SpokeGate.BridgeHubIntent({
            params: params,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: _relayFee,
            nonce: nonce,
            chainId: block.chainid,
            fromTransientRoute: _fromTransientRoute,
            inputToken: IERC20(address(usdc)),
            outputToken: IERC20(address(usdc)),
            inputAmount: _inputAmount,
            bridgeFee: _bridgeFee,
            destinationChainId: HUB_CHAIN_ID,
            exclusiveRelayer: address(0),
            quoteTimestamp: uint32(block.timestamp),
            fillDeadline: uint32(block.timestamp + 3600),
            exclusivityDeadline: 0
        });
    }

    function _bridgeDigest(
        SpokeGate.BridgeHubIntent memory _intent
    ) internal view returns (bytes32) {
        bytes32 _structHash = keccak256(
            abi.encode(
                BRIDGE_HUB_INTENT_TYPEHASH,
                _hashAccount(_intent.params),
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
                _intent.fromTransientRoute,
                _intent.inputToken,
                _intent.outputToken,
                _intent.inputAmount,
                _intent.bridgeFee,
                _intent.destinationChainId,
                _intent.exclusiveRelayer,
                _intent.quoteTimestamp,
                _intent.fillDeadline,
                _intent.exclusivityDeadline
            )
        );
        return
            keccak256(
                abi.encodePacked("\x19\x01", _domainSeparator("SpokeGate", address(walletGate)), _structHash)
            );
    }

    function _seedAccounted(
        PuppetAccount _acct,
        uint _amount
    ) internal {
        usdc.mint(address(_acct), _amount);
        vm.store(address(_acct), bytes32(uint(0)), bytes32(_amount));
    }

    function _createMaster(
        AccountLib.AccountInitParams memory _p,
        uint _userKey
    ) internal {
        AccountModule.CreateMasterAccountIntent memory _mi = AccountModule.CreateMasterAccountIntent({
            params: _p,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: 0,
            chainId: block.chainid,
            initialDepositAmount: 0
        });
        bytes32 _sh = keccak256(
            abi.encode(
                CREATE_MASTER_ACCOUNT_INTENT_TYPEHASH,
                _hashAccount(_p),
                _mi.blockNumber,
                _mi.deadline,
                _mi.acceptableRelayFee,
                _mi.nonce,
                _mi.chainId,
                _mi.initialDepositAmount
            )
        );
        bytes32 _dom = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SpokeGate"),
                keccak256("1"),
                block.chainid,
                address(walletGate)
            )
        );
        bytes32 _d = keccak256(abi.encodePacked("\x19\x01", _dom, _sh));
        walletGate.createMasterAccount(
            _mi, _signDeployAuth(_userKey), "", _signDigest(_userKey, _d), _signDigest(attestorKey, _d), 0
        );
    }

    function _hashAccount(
        AccountLib.AccountInitParams memory _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(ACCOUNT_TYPEHASH, _p.user, _p.name, _p.baseTokenId, _p.signer));
    }

    function _domainSeparator(
        string memory _name,
        address _verifying
    ) internal view returns (bytes32) {
        bytes32 _typeHash =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        return
            keccak256(abi.encode(_typeHash, keccak256(bytes(_name)), keccak256(bytes("1")), block.chainid, _verifying));
    }

    function _signDeployAuth(
        uint _key
    ) internal pure returns (bytes memory) {
        bytes memory _msg = bytes("Puppet: Authorize session key");
        bytes32 _digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", vm.toString(_msg.length), _msg));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key, _digest);
        return abi.encodePacked(r, s, v);
    }

    function _signDigest(
        uint _key,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key, _digest);
        return abi.encodePacked(r, s, v);
    }
}
