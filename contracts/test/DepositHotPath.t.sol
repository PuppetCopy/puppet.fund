// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Test} from "forge-std/src/Test.sol";
import {grantGate} from "./util/grantGate.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {AccountModule, CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH} from "src/core/module/AccountModule.sol";
import {Attest} from "src/core/Attest.sol";
import {Dictate} from "src/core/Dictate.sol";
import {TransientRoute} from "src/core/TransientRoute.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {MasterAccount} from "src/core/MasterAccount.sol";
import {RegisterModule} from "src/core/module/RegisterModule.sol";
import {WalletDepositModule} from "src/core/module/WalletDepositModule.sol";
import {ShareModule} from "src/hub/ShareModule.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {AllocateModule} from "src/hub/module/AllocateModule.sol";
import {AllocateStore} from "src/hub/AllocateStore.sol";
import {SubscribeModule} from "src/hub/module/SubscribeModule.sol";
import {RedeemModule} from "src/hub/module/RedeemModule.sol";
import {RedeemStore} from "src/hub/RedeemStore.sol";
import {HubGate, BRIDGE_TO_WALLET_INTENT_TYPEHASH} from "src/hub/HubGate.sol";
import {SpokeGate, BRIDGE_HUB_INTENT_TYPEHASH} from "src/spoke/SpokeGate.sol";
import {CoreGate, WITHDRAW_INTENT_TYPEHASH, SIGN_TRANSIENT_ROUTE_BALANCE_INTENT_TYPEHASH} from "src/core/CoreGate.sol";
import {ACROSS_SPOKE_POOL_ARBITRUM} from "./shared/Across.t.sol";
import {ACCOUNT_TYPEHASH, AccountLib} from "src/core/AccountLib.sol";
import {Error} from "src/utils/Error.sol";
import {IAccount} from "src/core/interface/IAccount.sol";

import {MockERC20} from "./mock/MockERC20.t.sol";
import {MockWNT} from "./mock/MockWNT.t.sol";

uint constant HUB_CHAIN_ID = 42_161;

contract MockSpokePool {
    struct DepositRecord {
        address depositor;
        address recipient;
        address inputToken;
        address outputToken;
        uint inputAmount;
        uint outputAmount;
        uint destinationChainId;
        address exclusiveRelayer;
        uint32 quoteTimestamp;
        uint32 fillDeadline;
        uint32 exclusivityDeadline;
        bytes message;
    }

    DepositRecord public lastDeposit;
    uint public depositCount;

    function depositV3(
        address _depositor,
        address _recipient,
        address _inputToken,
        address _outputToken,
        uint _inputAmount,
        uint _outputAmount,
        uint _destinationChainId,
        address _exclusiveRelayer,
        uint32 _quoteTimestamp,
        uint32 _fillDeadline,
        uint32 _exclusivityDeadline,
        bytes calldata _message
    ) external payable {
        SafeERC20.safeTransferFrom(IERC20(_inputToken), msg.sender, address(this), _inputAmount);
        lastDeposit = DepositRecord({
            depositor: _depositor,
            recipient: _recipient,
            inputToken: _inputToken,
            outputToken: _outputToken,
            inputAmount: _inputAmount,
            outputAmount: _outputAmount,
            destinationChainId: _destinationChainId,
            exclusiveRelayer: _exclusiveRelayer,
            quoteTimestamp: _quoteTimestamp,
            fillDeadline: _fillDeadline,
            exclusivityDeadline: _exclusivityDeadline,
            message: _message
        });
        depositCount++;
    }
}

contract DepositHotPathTest is Test {
    bytes32 constant USDC_ID = keccak256("USDC");
    uint constant TRANSFER_GAS_LIMIT = 100_000;

    address owner = makeAddr("Owner");
    address attestor;
    uint attestorKey;
    address feeReceiver = makeAddr("FeeReceiver");

    MockERC20 usdc;
    MockWNT wnt;

    Dictate dictate;
    AccountModule accountGate;
    RegisterModule register;
    HubGate hubGate;
    CoreGate coreGate;
    SpokeGate walletGate;

    bytes32 hubDomainSeparator;
    bytes32 walletDomainSeparator;
    bytes32 coreDomainSeparator;

    struct PuppetContext {
        PuppetAccount acct;
        address user;
        uint userKey;
        bytes32 name;
        bytes32 baseTokenId;
        uint nonce;
    }

    PuppetContext puppet;

    function setUp() public {
        vm.chainId(HUB_CHAIN_ID);
        (attestor, attestorKey) = makeAddrAndKey("Attestor");

        vm.startPrank(owner);

        usdc = new MockERC20("USDC", "USDC", 6);
        wnt = new MockWNT();
        dictate = new Dictate(owner);

        register = new RegisterModule(dictate, HUB_CHAIN_ID);

        PuppetAccount accountImpl = new PuppetAccount();
        TransientRoute depositPuppetAccount = new TransientRoute();
        MasterAccount masterPuppetAccount = new MasterAccount();
        Attest attest = new Attest(dictate);
        accountGate = new AccountModule(
            dictate, attest, address(accountImpl), address(depositPuppetAccount), address(masterPuppetAccount)
        );
        dictate.setAccess(attest, address(accountGate));

        ShareToken shareTokenImpl = new ShareToken();
        ShareModule shareGate = new ShareModule(dictate, address(shareTokenImpl));
        AllocateModule allocate = new AllocateModule(dictate);
        AllocateStore allocateStore = new AllocateStore(dictate);
        SubscribeModule subscribe = new SubscribeModule(dictate);
        RedeemModule redeem = new RedeemModule(dictate);
        RedeemStore redeemStore = new RedeemStore(dictate);

        WalletDepositModule walletDeposit = new WalletDepositModule(dictate, register);

        hubGate = new HubGate(
            dictate, accountGate, shareGate, allocate, allocateStore, subscribe, redeem, redeemStore, register,
            HubGate.Config({
                attestor: attestor,
                feeReceiver: feeReceiver,
                transferGasLimit: TRANSFER_GAS_LIMIT,
                maxBlockDelay: 5,
                acrossSpokePool: ACROSS_SPOKE_POOL_ARBITRUM,
                maxRelayFeeBps: 1000
            })
        );

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
                acrossSpokePool: ACROSS_SPOKE_POOL_ARBITRUM,
                maxRelayFeeBps: 1000
            })
        );


        dictate.setAccess(walletDeposit, address(coreGate));
        dictate.setAccess(allocateStore, address(subscribe));
        dictate.setAccess(allocateStore, address(allocate));
        dictate.setAccess(redeemStore, address(redeem));
        dictate.setAccess(shareGate, address(allocate));
        dictate.setAccess(shareGate, address(redeem));
        dictate.setAccess(subscribe, address(hubGate));
        dictate.setAccess(allocate, address(hubGate));
        dictate.setAccess(redeem, address(hubGate));

        grantGate(dictate, accountGate, address(subscribe));
        grantGate(dictate, accountGate, address(allocate));
        grantGate(dictate, accountGate, address(redeem));
        grantGate(dictate, accountGate, address(coreGate));
        grantGate(dictate, accountGate, address(walletGate));
        grantGate(dictate, accountGate, address(hubGate));

        dictate.setAccess(register, owner);
        register.registerToken(USDC_ID, IERC20(address(usdc)), 0, address(usdc));

        vm.stopPrank();

        hubDomainSeparator = _domainSeparator("HubGate", address(hubGate));
        walletDomainSeparator = _domainSeparator("SpokeGate", address(walletGate));
        coreDomainSeparator = _domainSeparator("CoreGate", address(coreGate));
        vm.mockCall(address(0x64), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(block.number));

        puppet = _makePuppet("PuppetAccount", bytes32("P"), USDC_ID);
    }

    function _makePuppet(
        string memory _label,
        bytes32 _name,
        bytes32 _baseTokenId
    ) internal returns (PuppetContext memory c) {
        (c.user, c.userKey) = makeAddrAndKey(_label);
        c.name = _name;
        c.baseTokenId = _baseTokenId;
        AccountLib.AccountInitParams memory p =
            AccountLib.AccountInitParams({user: c.user, name: _name, baseTokenId: _baseTokenId, signer: address(0)});
        AccountModule.CreatePuppetAccountIntent memory intent = AccountModule.CreatePuppetAccountIntent({
            params: p,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: 0,
            chainId: block.chainid,
            initialDepositAmount: 0
        });
        bytes32 _structHash = keccak256(
            abi.encode(
                CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH,
                _hashAccount(p),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.initialDepositAmount
            )
        );
        bytes32 _digest = _coreDigest(_structHash);
        coreGate.createPuppetAccount(
            intent,
            _signPuppetDeploy(c.userKey),
            "",
            _signDigest(c.userKey, _digest),
            _signDigest(attestorKey, _digest),
            0
        );
        c.acct = PuppetAccount(payable(accountGate.predictPuppetAccount(p)));
        c.nonce = 1;
    }

    function _signPuppetDeploy(
        uint _key
    ) internal pure returns (bytes memory) {
        bytes memory _msg = bytes("Puppet: Authorize session key");
        bytes32 _digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", vm.toString(_msg.length), _msg));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key, _digest);
        return abi.encodePacked(r, s, v);
    }

    function _params() internal view returns (AccountLib.AccountInitParams memory) {
        return AccountLib.AccountInitParams({
            user: puppet.user, name: puppet.name, baseTokenId: puppet.baseTokenId, signer: address(0)
        });
    }

    function _signDigest(
        uint _key,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key, _digest);
        return abi.encodePacked(r, s, v);
    }

    function _seedAccounted(
        PuppetAccount _acct,
        uint _amount
    ) internal {
        usdc.mint(address(_acct), _amount);
        vm.store(address(_acct), bytes32(uint(0)), bytes32(_amount));
    }

    function _buildWithdraw(
        uint _amount,
        uint _relayFee
    ) internal view returns (CoreGate.WithdrawIntent memory) {
        return CoreGate.WithdrawIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 1,
            params: _params(),
            amount: _amount,
            acceptableRelayFee: _relayFee,
            nonce: puppet.nonce,
            chainId: block.chainid
        });
    }

    function _withdrawDigest(
        CoreGate.WithdrawIntent memory _intent
    ) internal view returns (bytes32) {
        bytes32 _structHash = keccak256(
            abi.encode(
                WITHDRAW_INTENT_TYPEHASH,
                _hashAccount(_intent.params),
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
                _intent.amount
            )
        );
        return _coreDigest(_structHash);
    }

    function test_withdraw_pays_signed_amount_and_fee() public {
        _seedAccounted(puppet.acct, 150e6);

        CoreGate.WithdrawIntent memory intent = _buildWithdraw(150e6, 5e6);
        bytes32 digest = _withdrawDigest(intent);
        puppet.nonce++;
        coreGate.walletWithdraw(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );

        assertEq(usdc.balanceOf(puppet.user), 145e6, "receiver gets signed amount minus fee");
        assertEq(usdc.balanceOf(feeReceiver), 5e6);
        assertEq(usdc.balanceOf(address(puppet.acct)), 0, "no dust");
        assertEq(puppet.acct.signedBalance(), 0, "accounted balance reflects post-call state");
    }

    function test_withdraw_zero_amount_reverts() public {
        _seedAccounted(puppet.acct, 100e6);

        CoreGate.WithdrawIntent memory intent = _buildWithdraw(0, 1e6);
        bytes32 digest = _withdrawDigest(intent);

        vm.expectRevert(Error.Deposit__NothingToWithdraw.selector);
        coreGate.walletWithdraw(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_withdraw_insufficient_signed_reverts() public {
        _seedAccounted(puppet.acct, 5e6);

        CoreGate.WithdrawIntent memory intent = _buildWithdraw(10e6, 1e6);
        bytes32 digest = _withdrawDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__InsufficientBalance.selector, 5e6, 10e6));
        coreGate.walletWithdraw(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_withdraw_nonce_reuse_reverts() public {
        _seedAccounted(puppet.acct, 150e6);

        CoreGate.WithdrawIntent memory intent = _buildWithdraw(1e6, 0);
        bytes32 digest1 = _withdrawDigest(intent);
        puppet.nonce++;
        coreGate.walletWithdraw(
            intent, _signDigest(puppet.userKey, digest1), _signDigest(attestorKey, digest1), intent.acceptableRelayFee
        );

        _seedAccounted(puppet.acct, 10e6);
        CoreGate.WithdrawIntent memory intent2 = _buildWithdraw(1e6, 0);
        intent2.nonce = 0;
        bytes32 digest2 = _withdrawDigest(intent2);
        vm.expectRevert();
        coreGate.walletWithdraw(
            intent2, _signDigest(puppet.userKey, digest2), _signDigest(attestorKey, digest2), intent2.acceptableRelayFee
        );
    }

    function test_withdraw_requires_auth() public {
        _seedAccounted(puppet.acct, 150e6);

        CoreGate.WithdrawIntent memory intent = _buildWithdraw(1e6, 0);
        bytes32 digest = _withdrawDigest(intent);
        bytes memory sig = _signDigest(puppet.userKey, digest);
        bytes memory att = _signDigest(makeKey("Attacker"), digest);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        coreGate.walletWithdraw(intent, sig, att, intent.acceptableRelayFee);
    }

    function test_withdraw_wrong_signer_reverts() public {
        _seedAccounted(puppet.acct, 150e6);

        CoreGate.WithdrawIntent memory intent = _buildWithdraw(1e6, 0);
        bytes32 digest = _withdrawDigest(intent);
        bytes memory sig = _signDigest(makeKey("Attacker"), digest);
        bytes memory att = _signDigest(attestorKey, digest);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        coreGate.walletWithdraw(intent, sig, att, intent.acceptableRelayFee);
    }

    function test_withdraw_partial_leaves_remainder() public {
        _seedAccounted(puppet.acct, 150e6);

        CoreGate.WithdrawIntent memory intent = _buildWithdraw(40e6, 1e6);
        bytes32 digest = _withdrawDigest(intent);
        puppet.nonce++;
        coreGate.walletWithdraw(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );

        assertEq(usdc.balanceOf(puppet.user), 39e6, "receiver gets signed amount minus fee");
        assertEq(usdc.balanceOf(feeReceiver), 1e6, "relayer still paid");
        assertEq(usdc.balanceOf(address(puppet.acct)), 110e6, "remainder retained");
        assertEq(puppet.acct.signedBalance(), 110e6, "accounted reflects strict post-call delta");
    }

    function test_withdraw_partial_exceeds_balance_reverts() public {
        _seedAccounted(puppet.acct, 40e6);

        CoreGate.WithdrawIntent memory intent = _buildWithdraw(50e6, 1e6);
        bytes32 digest = _withdrawDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__InsufficientBalance.selector, 40e6, 50e6));
        coreGate.walletWithdraw(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function _buildBridge(
        uint _bridgeFee,
        uint _relayFee
    ) internal view returns (SpokeGate.BridgeHubIntent memory) {
        return _buildBridge({_fromTransientRoute: false, _inputAmount: 0, _bridgeFee: _bridgeFee, _relayFee: _relayFee});
    }

    function _buildBridge(
        bool _fromTransientRoute,
        uint _inputAmount,
        uint _bridgeFee,
        uint _relayFee
    ) internal view returns (SpokeGate.BridgeHubIntent memory) {
        return SpokeGate.BridgeHubIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 1,
            params: _params(),
            fromTransientRoute: _fromTransientRoute,
            inputToken: IERC20(address(usdc)),
            outputToken: IERC20(address(usdc)),
            inputAmount: _inputAmount,
            bridgeFee: _bridgeFee,
            destinationChainId: HUB_CHAIN_ID,
            exclusiveRelayer: address(0),
            quoteTimestamp: uint32(block.timestamp),
            fillDeadline: uint32(block.timestamp + 3600),
            exclusivityDeadline: 0,
            acceptableRelayFee: _relayFee,
            nonce: puppet.nonce,
            chainId: block.chainid
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
        return keccak256(abi.encodePacked("\x19\x01", walletDomainSeparator, _structHash));
    }

    function test_bridge_sweeps_balance_and_approves_and_pays_fee() public {
        _seedAccounted(puppet.acct, 150e6);

        vm.etch(ACROSS_SPOKE_POOL_ARBITRUM, address(new MockSpokePool()).code);

        SpokeGate.BridgeHubIntent memory intent =
            _buildBridge({_fromTransientRoute: false, _inputAmount: 150e6, _bridgeFee: 1e6, _relayFee: 5e6});
        bytes32 digest = _bridgeDigest(intent);
        puppet.nonce++;

        walletGate.bridgeHub(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );

        assertEq(usdc.balanceOf(ACROSS_SPOKE_POOL_ARBITRUM), 145e6, "spoke received full sweep");
        assertEq(usdc.balanceOf(feeReceiver), 5e6, "fee paid");
        assertEq(usdc.balanceOf(address(puppet.acct)), 0, "no dust");
        assertEq(MockSpokePool(ACROSS_SPOKE_POOL_ARBITRUM).depositCount(), 1);

        (,,,,, uint outputAmount,,,,,,) = MockSpokePool(ACROSS_SPOKE_POOL_ARBITRUM).lastDeposit();
        assertEq(outputAmount, 144e6, "outputAmount = inputAmount - bridgeFee");
    }

    function test_bridge_zero_balance_reverts() public {
        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_bridgeFee: 1e6, _relayFee: 1e6});
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert(Error.Deposit__NothingToBridge.selector);
        walletGate.bridgeHub(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_bridge_fee_covers_balance_reverts() public {
        _seedAccounted(puppet.acct, 3e6);
        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_bridgeFee: 1e6, _relayFee: 5e6});
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert();
        walletGate.bridgeHub(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_bridge_fee_equals_input_reverts() public {
        _seedAccounted(puppet.acct, 10e6);
        SpokeGate.BridgeHubIntent memory intent =
            _buildBridge({_fromTransientRoute: false, _inputAmount: 10e6, _bridgeFee: 9e6, _relayFee: 1e6});
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__BridgeFeeExceedsInput.selector, 9e6, 9e6));
        walletGate.bridgeHub(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_bridge_sweep_appliesRatioCapOnResolvedAmount() public {
        _seedAccounted(puppet.acct, 6e6);
        SpokeGate.BridgeHubIntent memory intent =
            _buildBridge({_fromTransientRoute: false, _inputAmount: 6e6, _bridgeFee: 1e6, _relayFee: 1e6});
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 1e6, 6e6, 1000));
        walletGate.bridgeHub(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_createPuppetAccount_appliesRatioCapOnInitialDeposit() public {
        (address _u, uint _k) = makeAddrAndKey("RatioCreate");
        AccountLib.AccountInitParams memory p =
            AccountLib.AccountInitParams({user: _u, name: bytes32("RC"), baseTokenId: USDC_ID, signer: address(0)});
        usdc.mint(accountGate.predictTransientRoute(accountGate.predictPuppetAccount(p)), 6e6);

        AccountModule.CreatePuppetAccountIntent memory intent = AccountModule.CreatePuppetAccountIntent({
            params: p,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 1e6,
            nonce: 0,
            chainId: block.chainid,
            initialDepositAmount: 6e6
        });
        bytes32 digest = _coreDigest(
            keccak256(
                abi.encode(
                    CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH,
                    _hashAccount(p),
                    intent.blockNumber,
                    intent.deadline,
                    intent.acceptableRelayFee,
                    intent.nonce,
                    intent.chainId,
                    intent.initialDepositAmount
                )
            )
        );

        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 1e6, 6e6, 1000));
        coreGate.createPuppetAccount(
            intent, _signPuppetDeploy(_k), "", _signDigest(_k, digest), _signDigest(attestorKey, digest), 1e6
        );
    }

    function test_bridge_partial_leaves_remainder() public {
        _seedAccounted(puppet.acct, 200e6);

        vm.etch(ACROSS_SPOKE_POOL_ARBITRUM, address(new MockSpokePool()).code);

        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_bridgeFee: 1e6, _relayFee: 5e6});
        intent.inputAmount = 50e6;
        bytes32 digest = _bridgeDigest(intent);
        puppet.nonce++;

        walletGate.bridgeHub(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );

        assertEq(usdc.balanceOf(ACROSS_SPOKE_POOL_ARBITRUM), 45e6, "spoke pulled inputAmount minus fee");
        assertEq(usdc.balanceOf(feeReceiver), 5e6);
        assertEq(usdc.balanceOf(address(puppet.acct)), 150e6, "remainder retained");

        (,,,,, uint outputAmount,,,,,,) = MockSpokePool(ACROSS_SPOKE_POOL_ARBITRUM).lastDeposit();
        assertEq(outputAmount, 44e6, "outputAmount = inputAmount - fee - bridgeFee");
    }

    function test_bridge_partial_exceeds_balance_reverts() public {
        _seedAccounted(puppet.acct, 40e6);

        SpokeGate.BridgeHubIntent memory intent = _buildBridge({_bridgeFee: 1e6, _relayFee: 5e6});
        intent.inputAmount = 50e6;
        bytes32 digest = _bridgeDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__InsufficientBalance.selector, 40e6, 50e6));
        walletGate.bridgeHub(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_bridge_requires_auth() public {
        _seedAccounted(puppet.acct, 150e6);
        SpokeGate.BridgeHubIntent memory intent =
            _buildBridge({_fromTransientRoute: false, _inputAmount: 150e6, _bridgeFee: 1e6, _relayFee: 5e6});
        bytes32 digest = _bridgeDigest(intent);
        bytes memory sig = _signDigest(puppet.userKey, digest);
        bytes memory att = _signDigest(makeKey("Attacker"), digest);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        walletGate.bridgeHub(intent, sig, att, intent.acceptableRelayFee);
    }

    function _fundAccount(
        address _account,
        uint _amount
    ) internal {
        usdc.mint(_account, _amount);
    }

    function _buildSignRecord(
        uint _amount,
        uint _relayFee
    ) internal view returns (CoreGate.SignTransientRouteBalanceIntent memory) {
        return CoreGate.SignTransientRouteBalanceIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 1,
            params: _params(),
            amount: _amount,
            acceptableRelayFee: _relayFee,
            nonce: puppet.nonce,
            chainId: block.chainid
        });
    }

    function _signRecordDigest(
        CoreGate.SignTransientRouteBalanceIntent memory _intent
    ) internal view returns (bytes32) {
        bytes32 _structHash = keccak256(
            abi.encode(
                SIGN_TRANSIENT_ROUTE_BALANCE_INTENT_TYPEHASH,
                _hashAccount(_intent.params),
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
                _intent.amount
            )
        );
        return _coreDigest(_structHash);
    }

    function test_signRecord_credits_signedBalance() public {
        usdc.mint(accountGate.predictTransientRoute(address(puppet.acct)), 100e6);

        CoreGate.SignTransientRouteBalanceIntent memory intent = _buildSignRecord(100e6, 0);
        bytes32 digest = _signRecordDigest(intent);
        coreGate.signTransientRouteBalance(intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), 0);

        assertEq(usdc.balanceOf(address(puppet.acct)), 100e6, "puppet credited full amount");
        assertEq(puppet.acct.signedBalance(), 100e6, "signed balance reflects inflow");
    }

    function test_signRecord_revertsOnZeroAmount() public {
        usdc.mint(accountGate.predictTransientRoute(address(puppet.acct)), 100e6);

        CoreGate.SignTransientRouteBalanceIntent memory intent = _buildSignRecord(0, 0);
        bytes32 digest = _signRecordDigest(intent);
        vm.expectRevert(Error.Deposit__NothingToRecord.selector);
        coreGate.signTransientRouteBalance(intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), 0);
    }

    function test_signRecord_paysRelayFee() public {
        usdc.mint(accountGate.predictTransientRoute(address(puppet.acct)), 100e6);

        CoreGate.SignTransientRouteBalanceIntent memory intent = _buildSignRecord(100e6, 5e6);
        bytes32 digest = _signRecordDigest(intent);
        coreGate.signTransientRouteBalance(intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), 5e6);

        assertEq(puppet.acct.signedBalance(), 95e6, "recognized net of relay fee");
        assertEq(usdc.balanceOf(address(puppet.acct)), 95e6, "account holds recognized net");
        assertEq(usdc.balanceOf(feeReceiver), 5e6, "keeper paid relay fee");
    }

    function test_signRecord_addsToExistingSigned() public {
        _seedAccounted(puppet.acct, 50e6);
        usdc.mint(accountGate.predictTransientRoute(address(puppet.acct)), 30e6);

        CoreGate.SignTransientRouteBalanceIntent memory intent = _buildSignRecord(30e6, 0);
        bytes32 digest = _signRecordDigest(intent);
        coreGate.signTransientRouteBalance(intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), 0);

        assertEq(puppet.acct.signedBalance(), 80e6, "recognize adds to existing signed balance");
        assertEq(usdc.balanceOf(address(puppet.acct)), 80e6, "account holds prior plus recognized");
    }

    function test_withdraw_native_unwraps_and_sends_eth() public {
        bytes32 wethId = keccak256("WETH");
        vm.startPrank(owner);
        register.registerToken(wethId, IERC20(address(wnt)), 0, address(wnt));
        register.setWnt(wethId);
        vm.stopPrank();
        PuppetContext memory wp = _makePuppet("WethUser", bytes32("WP"), wethId);

        vm.deal(address(this), 1 ether);
        wnt.deposit{value: 1 ether}();
        wnt.transfer(address(wp.acct), 1 ether);
        vm.store(address(wp.acct), bytes32(uint(0)), bytes32(uint(1 ether)));

        CoreGate.WithdrawIntent memory intent = CoreGate.WithdrawIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 1,
            params: AccountLib.AccountInitParams({
                user: wp.user, name: wp.name, baseTokenId: wethId, signer: address(0)
            }),
            amount: 1 ether,
            acceptableRelayFee: 0,
            nonce: wp.nonce,
            chainId: block.chainid
        });
        bytes32 digest = _withdrawDigest(intent);

        uint userBalBefore = wp.user.balance;
        coreGate.walletWithdrawWnt(intent, _signDigest(wp.userKey, digest), _signDigest(attestorKey, digest), 0);

        assertEq(wnt.balanceOf(address(wp.acct)), 0, "puppet WNT balance drained");
        assertEq(wp.user.balance - userBalBefore, 1 ether, "user EOA got 1 ETH");
        assertEq(IAccount(address(wp.acct)).signedBalance(), 0, "signedBalance decremented to zero");
    }

    function test_withdraw_native_with_fee_keeps_fee_in_weth() public {
        bytes32 wethId = keccak256("WETH");
        vm.startPrank(owner);
        register.registerToken(wethId, IERC20(address(wnt)), 0, address(wnt));
        register.setWnt(wethId);
        vm.stopPrank();
        PuppetContext memory wp = _makePuppet("WethUser2", bytes32("WP2"), wethId);

        vm.deal(address(this), 1 ether);
        wnt.deposit{value: 1 ether}();
        wnt.transfer(address(wp.acct), 1 ether);
        vm.store(address(wp.acct), bytes32(uint(0)), bytes32(uint(1 ether)));

        CoreGate.WithdrawIntent memory intent = CoreGate.WithdrawIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 1,
            params: AccountLib.AccountInitParams({
                user: wp.user, name: wp.name, baseTokenId: wethId, signer: address(0)
            }),
            amount: 1 ether,
            acceptableRelayFee: 0.05 ether,
            nonce: wp.nonce,
            chainId: block.chainid
        });
        bytes32 digest = _withdrawDigest(intent);

        uint userBalBefore = wp.user.balance;
        coreGate.walletWithdrawWnt(
            intent, _signDigest(wp.userKey, digest), _signDigest(attestorKey, digest), 0.05 ether
        );

        assertEq(wp.user.balance - userBalBefore, 0.95 ether, "user got amount minus fee as ETH");
        assertEq(wnt.balanceOf(feeReceiver), 0.05 ether, "feeReceiver paid in WNT");
        assertEq(wnt.balanceOf(address(wp.acct)), 0, "puppet drained");
    }

    function makeKey(
        string memory _label
    ) internal returns (uint _key) {
        (, _key) = makeAddrAndKey(_label);
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

    function _walletDigest(
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", walletDomainSeparator, _structHash));
    }

    function _coreDigest(
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", coreDomainSeparator, _structHash));
    }

    function _hubDigest(
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", hubDomainSeparator, _structHash));
    }

    function _buildBridgeToWallet(
        uint _inputAmount,
        uint _bridgeFee,
        uint _relayFee,
        uint _destinationChainId
    ) internal view returns (HubGate.BridgeToWalletIntent memory) {
        return HubGate.BridgeToWalletIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 1,
            params: _params(),
            inputToken: IERC20(address(usdc)),
            outputToken: IERC20(address(usdc)),
            inputAmount: _inputAmount,
            bridgeFee: _bridgeFee,
            destinationChainId: _destinationChainId,
            exclusiveRelayer: address(0),
            quoteTimestamp: uint32(block.timestamp),
            fillDeadline: uint32(block.timestamp + 3600),
            exclusivityDeadline: 0,
            acceptableRelayFee: _relayFee,
            nonce: puppet.nonce,
            chainId: block.chainid
        });
    }

    function _bridgeToWalletDigest(
        HubGate.BridgeToWalletIntent memory _intent
    ) internal view returns (bytes32) {
        bytes32 _structHash = keccak256(
            abi.encode(
                BRIDGE_TO_WALLET_INTENT_TYPEHASH,
                _hashAccount(_intent.params),
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
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
        return _hubDigest(_structHash);
    }

    function test_bridgeToWallet_pays_fee_and_bridges_to_user_eoa() public {
        _seedAccounted(puppet.acct, 100e6);
        vm.etch(ACROSS_SPOKE_POOL_ARBITRUM, address(new MockSpokePool()).code);

        HubGate.BridgeToWalletIntent memory intent = _buildBridgeToWallet({
            _inputAmount: 100e6,
            _bridgeFee: 1e6,
            _relayFee: 5e6,
            _destinationChainId: 8453
        });
        bytes32 digest = _bridgeToWalletDigest(intent);
        puppet.nonce++;

        hubGate.bridgeToWallet(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );

        assertEq(usdc.balanceOf(ACROSS_SPOKE_POOL_ARBITRUM), 95e6, "spoke received input minus relayFee");
        assertEq(usdc.balanceOf(feeReceiver), 5e6, "fee paid");
        assertEq(usdc.balanceOf(address(puppet.acct)), 0, "puppet drained");
        assertEq(puppet.acct.signedBalance(), 0, "signedBalance reflects drain");

        (address depositor, address recipient,,,, uint outputAmount, uint destChainId,,,,,) =
            MockSpokePool(ACROSS_SPOKE_POOL_ARBITRUM).lastDeposit();
        assertEq(depositor, address(puppet.acct), "depositor = puppet account");
        assertEq(recipient, puppet.user, "Across recipient = user EOA");
        assertEq(destChainId, 8453, "destination is spoke chain");
        assertEq(outputAmount, 94e6, "outputAmount = inputAmount - relayFee - bridgeFee");
    }

    function test_bridgeToWallet_zero_amount_reverts() public {
        _seedAccounted(puppet.acct, 100e6);

        HubGate.BridgeToWalletIntent memory intent =
            _buildBridgeToWallet({_inputAmount: 0, _bridgeFee: 0, _relayFee: 0, _destinationChainId: 8453});
        bytes32 digest = _bridgeToWalletDigest(intent);

        vm.expectRevert(Error.Deposit__NothingToBridge.selector);
        hubGate.bridgeToWallet(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_bridgeToWallet_requires_auth() public {
        _seedAccounted(puppet.acct, 100e6);

        HubGate.BridgeToWalletIntent memory intent =
            _buildBridgeToWallet({_inputAmount: 50e6, _bridgeFee: 1e6, _relayFee: 1e6, _destinationChainId: 8453});
        bytes32 digest = _bridgeToWalletDigest(intent);
        bytes memory sig = _signDigest(puppet.userKey, digest);
        bytes memory att = _signDigest(makeKey("Attacker"), digest);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hubGate.bridgeToWallet(intent, sig, att, intent.acceptableRelayFee);
    }

    function test_bridgeToWallet_same_chain_reverts() public {
        _seedAccounted(puppet.acct, 100e6);

        HubGate.BridgeToWalletIntent memory intent = _buildBridgeToWallet({
            _inputAmount: 50e6,
            _bridgeFee: 1e6,
            _relayFee: 1e6,
            _destinationChainId: HUB_CHAIN_ID
        });
        bytes32 digest = _bridgeToWalletDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__SameChainBridge.selector, HUB_CHAIN_ID));
        hubGate.bridgeToWallet(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_bridgeToWallet_underfunded_reverts() public {
        _seedAccounted(puppet.acct, 30e6);

        HubGate.BridgeToWalletIntent memory intent =
            _buildBridgeToWallet({_inputAmount: 50e6, _bridgeFee: 1e6, _relayFee: 1e6, _destinationChainId: 8453});
        bytes32 digest = _bridgeToWalletDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__InsufficientBalance.selector, 30e6, 50e6));
        hubGate.bridgeToWallet(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_bridgeToWallet_fee_exceeds_input_reverts() public {
        _seedAccounted(puppet.acct, 50e6);

        HubGate.BridgeToWalletIntent memory intent =
            _buildBridgeToWallet({_inputAmount: 50e6, _bridgeFee: 50e6, _relayFee: 0, _destinationChainId: 8453});
        bytes32 digest = _bridgeToWalletDigest(intent);

        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__BridgeFeeExceedsInput.selector, 50e6, 50e6));
        hubGate.bridgeToWallet(
            intent, _signDigest(puppet.userKey, digest), _signDigest(attestorKey, digest), intent.acceptableRelayFee
        );
    }

    function test_bridgeToWallet_nonce_reuse_reverts() public {
        _seedAccounted(puppet.acct, 200e6);
        vm.etch(ACROSS_SPOKE_POOL_ARBITRUM, address(new MockSpokePool()).code);

        HubGate.BridgeToWalletIntent memory intent =
            _buildBridgeToWallet({_inputAmount: 50e6, _bridgeFee: 1e6, _relayFee: 1e6, _destinationChainId: 8453});
        bytes32 digest1 = _bridgeToWalletDigest(intent);
        puppet.nonce++;
        hubGate.bridgeToWallet(
            intent, _signDigest(puppet.userKey, digest1), _signDigest(attestorKey, digest1), intent.acceptableRelayFee
        );

        HubGate.BridgeToWalletIntent memory intent2 =
            _buildBridgeToWallet({_inputAmount: 50e6, _bridgeFee: 1e6, _relayFee: 1e6, _destinationChainId: 8453});
        intent2.nonce = 0;
        bytes32 digest2 = _bridgeToWalletDigest(intent2);
        vm.expectRevert();
        hubGate.bridgeToWallet(
            intent2, _signDigest(puppet.userKey, digest2), _signDigest(attestorKey, digest2), intent2.acceptableRelayFee
        );
    }

}
