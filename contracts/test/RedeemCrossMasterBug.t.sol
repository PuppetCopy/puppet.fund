// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Test} from "forge-std/src/Test.sol";
import {grantGate} from "./util/grantGate.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AccountModule} from "src/core/module/AccountModule.sol";
import {Dictate} from "src/core/Dictate.sol";
import {TransientRoute} from "src/core/TransientRoute.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {MasterAccount} from "src/core/MasterAccount.sol";
import {ShareModule} from "src/hub/ShareModule.sol";
import {RegisterModule} from "src/core/module/RegisterModule.sol";
import {AllocateModule, ALLOCATE_INTENT_TYPEHASH} from "src/hub/module/AllocateModule.sol";
import {AllocateStore} from "src/hub/AllocateStore.sol";
import {RuleLib} from "src/hub/RuleLib.sol";
import {IAccount} from "src/core/interface/IAccount.sol";
import {Attest} from "src/core/Attest.sol";
import {
    RedeemModule,
    SELL_INTENT_TYPEHASH,
    CLAIM_INTENT_TYPEHASH,
    FULFILL_INTENT_TYPEHASH
} from "src/hub/module/RedeemModule.sol";
import {RedeemStore} from "src/hub/RedeemStore.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {SubscribeModule, SUBSCRIBE_INTENT_TYPEHASH} from "src/hub/module/SubscribeModule.sol";
import {BaseGate} from "src/utils/BaseGate.sol";
import {HubGate} from "src/HubGate.sol";
import {AccountLib, ACCOUNT_TYPEHASH} from "src/core/AccountLib.sol";
import {Error} from "src/utils/Error.sol";

import {MockERC20} from "./mock/MockERC20.t.sol";

uint constant HUB_CHAIN_ID = 42_161;
uint constant TRANSFER_GAS_LIMIT = 200_000;
bytes32 constant USDC_ID = keccak256("USDC");

contract RedeemModuleCrossMasterBugTest is Test {
    address owner = makeAddr("Owner");
    address feeReceiver = makeAddr("FeeReceiver");

    address attestor;
    uint attestorKey;
    address user1;
    uint key1;
    address user2;
    uint key2;
    address userA;
    uint keyA;
    address userB;
    uint keyB;

    MockERC20 usdc;
    Dictate dictate;
    AccountModule accountGate;
    ShareModule shareGate;
    RegisterModule register;
    SubscribeModule subscribe;
    AllocateModule allocate;
    AllocateStore allocateStore;
    RedeemModule redeem;
    RedeemStore redeemStore;
    HubGate router;

    bytes32 domainSeparator;
    address master1Pool;
    address master2Pool;
    address master1KeyPersonal;
    address master2KeyPersonal;
    PuppetAccount puppetA;
    PuppetAccount puppetB;

    mapping(address puppet => mapping(address master => bytes)) internal _testBody;
    mapping(address puppet => mapping(address master => bytes)) internal _testSig;
    mapping(address puppet => mapping(address master => uint)) internal _testMatched;

    uint _nonceCounter;

    function setUp() public {
        vm.chainId(HUB_CHAIN_ID);
        (attestor, attestorKey) = makeAddrAndKey("Attestor");
        (user1, key1) = makeAddrAndKey("Master1");
        (user2, key2) = makeAddrAndKey("Master2");
        (userA, keyA) = makeAddrAndKey("PuppetA");
        (userB, keyB) = makeAddrAndKey("PuppetB");

        vm.startPrank(owner);

        usdc = new MockERC20("USDC", "USDC", 6);
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
        shareGate = new ShareModule(dictate, address(shareTokenImpl));

        allocate = new AllocateModule(dictate);
        subscribe = new SubscribeModule(dictate);
        redeem = new RedeemModule(dictate);
        redeemStore = new RedeemStore(dictate);
        allocateStore = new AllocateStore(dictate);

        router = new HubGate(
            dictate,
            accountGate,
            shareGate,
            allocate,
            allocateStore,
            subscribe,
            redeem,
            redeemStore,
            register,
            BaseGate.Config({
                attestor: attestor,
                feeReceiver: feeReceiver,
                transferGasLimit: TRANSFER_GAS_LIMIT,
                maxBlockDelay: 5,
                maxRelayFeeBps: 1000
            })
        );

        dictate.setAccess(allocateStore, address(subscribe));
        dictate.setAccess(allocateStore, address(allocate));
        dictate.setAccess(redeemStore, address(redeem));
        dictate.setAccess(shareGate, address(allocate));
        dictate.setAccess(shareGate, address(redeem));
        dictate.setAccess(subscribe, address(router));
        dictate.setAccess(allocate, address(router));
        dictate.setAccess(redeem, address(router));
        dictate.setAccess(shareGate, address(router));

        grantGate(dictate, accountGate, address(subscribe));
        grantGate(dictate, accountGate, address(allocate));
        grantGate(dictate, accountGate, address(redeem));
        grantGate(dictate, accountGate, address(router));
        grantGate(dictate, accountGate, address(this));

        dictate.setAccess(register, owner);
        register.registerToken(USDC_ID, IERC20(address(usdc)), 0, address(usdc));

        vm.stopPrank();

        domainSeparator = _domainSeparator();
        vm.mockCall(address(0x64), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(block.number));

        _seedMasterAccount(_master1Params(), key1);
        _seedMasterAccount(_master2Params(), key2);
        master1Pool = address(accountGate.verifyMasterAccount(_master1Params()));
        master2Pool = address(accountGate.verifyMasterAccount(_master2Params()));
        master1KeyPersonal = master1Pool;
        master2KeyPersonal = master2Pool;
        puppetA = _bootstrapPuppet(userA, keyA, "PuppetA");
        puppetB = _bootstrapPuppet(userB, keyB, "PuppetB");
    }

    function test_crossMasterPoolsRemainIsolated() public {
        _stakeBoth();
        _drainBoth();
        _assertNoSiphon();
    }

    function test_creditPool_revertsForUnauthorizedCaller() public {
        usdc.mint(address(this), 1e6);
        usdc.approve(address(redeemStore), 1e6);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        redeemStore.creditPool(master1Pool, IERC20(address(usdc)), address(this), 1e6, TRANSFER_GAS_LIMIT);
    }

    function test_allocate_noStakers_doesNotCreditPool() public {
        IERC20 _usdc = IERC20(address(usdc));

        uint _trackedBefore = redeemStore.signedBalanceMap(_usdc);
        _allocate1(100e6, new address[](0));

        assertEq(
            redeemStore.signedBalanceMap(_usdc), _trackedBefore, "signedBalanceMap unchanged on no-stakers allocate"
        );
        RedeemStore.Pool memory _pool = redeemStore.getPool(master1Pool, _usdc);
        assertEq(_pool.totalStake, 0, "no stakers minted");
        assertEq(_pool.accruedPerStake, 0, "no accrual without stake");
    }

    function test_drain_cumulativeAcrossRounds_fullyClaimable() public {
        _subscribe1(puppetA, userA, keyA, 100e6);
        _fundPuppet(puppetA, 100e6);
        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(100e6, _aOnly);
        _sell1(puppetA, userA, keyA, ShareToken(router.predictShareToken(master1Pool)).balanceOf(address(puppetA)));

        _fulfill1(type(uint).max);

        address _depA = address(puppetA);
        uint _before = usdc.balanceOf(_depA);
        _claim1(
            puppetA, userA, keyA, redeem.getClaimable(redeemStore, master1Pool, IERC20(address(usdc)), address(puppetA))
        );
        uint _claimed = usdc.balanceOf(_depA) - _before;
        assertApproxEqAbs(_claimed, 100e6, 5, "single staker collects full cumulative drain");
    }

    function test_sellAfterEarlierDrain_doesNotInheritPriorAccrual() public {
        _subscribe1(puppetA, userA, keyA, 100e6);
        _fundPuppet(puppetA, 100e6);
        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(100e6, _aOnly);
        _sell1(puppetA, userA, keyA, ShareToken(router.predictShareToken(master1Pool)).balanceOf(address(puppetA)));

        _fulfill1(type(uint).max);

        _subscribe1(puppetB, userB, keyB, 100e6);
        _fundPuppet(puppetB, 100e6);
        address[] memory _bOnly = new address[](1);
        _bOnly[0] = address(puppetB);
        _allocate1(100e6, _bOnly);
        _sell1(puppetB, userB, keyB, ShareToken(router.predictShareToken(master1Pool)).balanceOf(address(puppetB)));

        IERC20 _usdc = IERC20(address(usdc));
        RedeemStore.Position memory _bPos = redeemStore.getPosition(master1Pool, _usdc, address(puppetB));
        RedeemStore.Pool memory _pool = redeemStore.getPool(master1Pool, _usdc);
        assertEq(_bPos.cursor, _pool.accruedPerStake, "puppetB cursor pins to post-drain accruedPerStake");
        assertEq(_bPos.accrued, 0, "puppetB starts with zero pending accrual");

        assertEq(
            redeem.getClaimable(redeemStore, master1Pool, _usdc, address(puppetB)),
            0,
            "late entrant has zero claim without a post-entry drain"
        );
    }

    function test_claimWithNoAccrual_revertsShareEmpty() public {
        _subscribe1(puppetA, userA, keyA, 100e6);
        _fundPuppet(puppetA, 100e6);
        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(100e6, _aOnly);
        _sell1(puppetA, userA, keyA, ShareToken(router.predictShareToken(master1Pool)).balanceOf(address(puppetA)));

        IERC20 _usdc = IERC20(address(usdc));
        assertEq(
            redeem.getClaimable(redeemStore, master1Pool, _usdc, address(puppetA)), 0, "no drain, nothing claimable"
        );

        bytes32 _name = puppetA.getName();
        RedeemModule.ClaimIntent memory _intent = RedeemModule.ClaimIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _puppetParams(userA, _name),
            masterParams: _master1Params(),
            amount: 0,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _hashAccount(_intent.masterParams),
                    _intent.amount
                )
            )
        );
        bytes memory _userSig = _signDigest(keyA, _digest);
        bytes memory _attSig = _signDigest(attestorKey, _digest);
        vm.expectRevert(Error.Share__Empty.selector);
        router.claim(_intent, _userSig, _attSig, _intent.acceptableRelayFee);
    }

    function test_creditPool_revertsWhenPoolHasNoStake() public {
        usdc.mint(address(redeem), 1e6);
        vm.startPrank(address(redeem));
        usdc.approve(address(redeemStore), 1e6);
        vm.expectRevert(Error.Share__NoStakeToCredit.selector);
        redeemStore.creditPool(master1Pool, IERC20(address(usdc)), address(redeem), 1e6, TRANSFER_GAS_LIMIT);
        vm.stopPrank();
    }

    function test_directERC20Donation_doesNotPoisonAccounting() public {
        IERC20 _usdc = IERC20(address(usdc));
        _subscribe1(puppetA, userA, keyA, 100e6);
        _fundPuppet(puppetA, 100e6);
        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(100e6, _aOnly);
        _sell1(puppetA, userA, keyA, ShareToken(router.predictShareToken(master1Pool)).balanceOf(address(puppetA)));

        _fulfill1(type(uint).max);

        usdc.mint(address(redeemStore), 1000e6);

        RedeemStore.Pool memory _poolBefore = redeemStore.getPool(master1Pool, _usdc);
        uint _viewBefore = redeem.getClaimable(redeemStore, master1Pool, _usdc, address(puppetA));
        assertGt(_viewBefore, 0, "legitimate accrual visible");
        assertLt(_viewBefore, 1000e6, "view ignores the donation");

        address _depA = address(puppetA);
        uint _balBefore = _usdc.balanceOf(_depA);
        _claim1(puppetA, userA, keyA, _viewBefore);
        uint _received = _usdc.balanceOf(_depA) - _balBefore;
        assertEq(_received, _viewBefore, "claim pays exactly what the view promised");
        assertLt(_received, 1000e6, "donation never leaks into the holder's payout");

        RedeemStore.Pool memory _poolAfter = redeemStore.getPool(master1Pool, _usdc);
        assertEq(_poolAfter.accruedPerStake, _poolBefore.accruedPerStake, "donation never enters accruedPerStake");

        assertGe(
            _usdc.balanceOf(address(redeemStore)) - redeemStore.signedBalanceMap(_usdc),
            1000e6,
            "donation stranded outside the BankStore ledger"
        );
    }

    function test_directShareDonation_absorbedFairlyByNextDrain() public {
        IERC20 _usdc = IERC20(address(usdc));
        _subscribe1(puppetA, userA, keyA, 100e6);
        _fundPuppet(puppetA, 100e6);
        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(100e6, _aOnly);

        ShareToken _stM1 = ShareToken(router.predictShareToken(master1Pool));
        uint _puppetShares = _stM1.balanceOf(address(puppetA));
        _sell1(puppetA, userA, keyA, _puppetShares / 2);

        uint _donation = _puppetShares / 2;
        vm.prank(address(shareGate));
        _stM1.mint(address(this), _donation);
        _stM1.transfer(address(redeemStore), _donation);

        uint _storeSharesPre = _stM1.balanceOf(address(redeemStore));

        _fulfill1(type(uint).max);

        uint _storeSharesPost = _stM1.balanceOf(address(redeemStore));
        assertLt(_storeSharesPost, _storeSharesPre, "drain consumed pool shares including the donation");

        uint _view = redeem.getClaimable(redeemStore, master1Pool, _usdc, address(puppetA));
        assertGt(_view, 0, "puppetA absorbs value the donor sacrificed");
    }

    function test_sameMasterMultiHolder_claimsAreIsolated() public {
        IERC20 _usdc = IERC20(address(usdc));
        _subscribe1(puppetA, userA, keyA, 100e6);
        _subscribe1(puppetB, userB, keyB, 100e6);
        _fundPuppet(puppetA, 100e6);
        _fundPuppet(puppetB, 100e6);

        address[] memory _both = new address[](2);
        (_both[0], _both[1]) = uint160(address(puppetA)) < uint160(address(puppetB))
            ? (address(puppetA), address(puppetB))
            : (address(puppetB), address(puppetA));
        _allocate1(200e6, _both);

        ShareToken _st = ShareToken(router.predictShareToken(master1Pool));
        _sell1(puppetA, userA, keyA, _st.balanceOf(address(puppetA)));
        _sell1(puppetB, userB, keyB, _st.balanceOf(address(puppetB)));

        _fulfill1(type(uint).max);

        address _depA = address(puppetA);
        uint _aBefore = _usdc.balanceOf(_depA);
        _claim1(puppetA, userA, keyA, redeem.getClaimable(redeemStore, master1Pool, _usdc, address(puppetA)));
        uint _aReceived = _usdc.balanceOf(_depA) - _aBefore;

        address _depB = address(puppetB);
        uint _bBefore = _usdc.balanceOf(_depB);
        _claim1(puppetB, userB, keyB, redeem.getClaimable(redeemStore, master1Pool, _usdc, address(puppetB)));
        uint _bReceived = _usdc.balanceOf(_depB) - _bBefore;

        assertApproxEqAbs(_aReceived, _bReceived, 5, "equal stakes get equal payouts regardless of claim order");
        assertGt(_aReceived, 0, "puppetA paid");
        assertGt(_bReceived, 0, "puppetB paid (not siphoned)");
    }

    function test_allocateAllowance_fullyConsumedAfterDrain() public {
        _subscribe1(puppetA, userA, keyA, 100e6);
        _fundPuppet(puppetA, 100e6);
        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(100e6, _aOnly);
        ShareToken _st = ShareToken(router.predictShareToken(master1Pool));
        _sell1(puppetA, userA, keyA, _st.balanceOf(address(puppetA)));

        _fulfill1(type(uint).max);
        assertEq(usdc.allowance(master1Pool, address(redeemStore)), 0, "no residual allowance after first drain");

        _subscribe1(puppetA, userA, keyA, 100e6);
        _fundPuppet(puppetA, 100e6);
        _allocate1(100e6, _aOnly);
        _sell1(puppetA, userA, keyA, _st.balanceOf(address(puppetA)));

        _fulfill1(type(uint).max);
        assertEq(usdc.allowance(master1Pool, address(redeemStore)), 0, "no residual allowance after second drain");
    }

    function test_transferOut_revertsForUnauthorizedCaller() public {
        usdc.mint(address(redeemStore), 1e6);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        redeemStore.transferOut(IERC20(address(usdc)), address(this), 1e6, TRANSFER_GAS_LIMIT);
    }

    function test_allocate_debitsPuppetSignedBalance() public {
        IERC20 _usdc = IERC20(address(usdc));
        _fundPuppet(puppetA, 100e6);

        _subscribe1(puppetA, userA, keyA, 50e6);
        assertEq(puppetA.signedBalance(), 100e6, "signed unchanged by subscribe");

        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(50e6, _aOnly);

        assertEq(puppetA.signedBalance(), 50e6, "signed debited by the attested matched amount");
        assertEq(_usdc.balanceOf(address(puppetA)), 50e6, "actual drained in lockstep with attested match");
    }

    function test_allocate_decrementsSignedAndActualInLockstep() public {
        IERC20 _usdc = IERC20(address(usdc));
        _fundPuppet(puppetA, 150e6);

        _subscribe1(puppetA, userA, keyA, 50e6);

        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(50e6, _aOnly);

        assertEq(puppetA.signedBalance(), 100e6, "signed decremented by matched amount");
        assertEq(_usdc.balanceOf(address(puppetA)), 100e6, "actual decremented in lockstep");
        assertEq(_usdc.balanceOf(address(puppetA)), puppetA.signedBalance(), "actual == signed invariant");
    }

    function test_signedBalance_unaffectedByExternalDonations() public {
        IERC20 _usdc = IERC20(address(usdc));
        vm.store(address(puppetA), bytes32(uint(0)), bytes32(uint(50e6)));
        usdc.mint(address(puppetA), 50e6);

        usdc.mint(address(puppetA), 1000e6);
        assertEq(_usdc.balanceOf(address(puppetA)), 1050e6, "post-donation actual");

        _subscribe1(puppetA, userA, keyA, 50e6);
        assertEq(puppetA.signedBalance(), 50e6, "donation never inflates signed");
    }

    function test_baseAccountCall_revertsOnUnregisteredCaller() public {
        IERC20 _usdc = IERC20(address(usdc));
        _fundPuppet(puppetA, 100e6);

        bytes32 _name = puppetA.getName();
        bytes memory _bodyBytes = _encodeRuleBody();
        bytes32 _stubMandateDigest = _mandateDigest(
            address(puppetA), accountGate.predictMasterAccount(_master1Params()), address(usdc), keccak256(_bodyBytes)
        );
        bytes memory _stubMandate = _signDigest(keyA, _stubMandateDigest);
        RuleLib.Rule[] memory _rules = new RuleLib.Rule[](1);
        _rules[0] = RuleLib.Rule({masterParams: _master1Params(), body: _bodyBytes, mandate: _stubMandate});
        SubscribeModule.SubscribeIntent memory _intent = SubscribeModule.SubscribeIntent({
            params: _puppetParams(userA, _name),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid,
            baseToken: _usdc,
            rules: _rules
        });
        bytes32 _ruleHash = keccak256(
            abi.encodePacked(
                keccak256(
                    abi.encode(
                        RuleLib.SUBSCRIBE_RULE_TYPEHASH,
                        _hashAccount(_rules[0].masterParams),
                        keccak256(_rules[0].body),
                        keccak256(_rules[0].mandate)
                    )
                )
            )
        );
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    SUBSCRIBE_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    _ruleHash
                )
            )
        );
        bytes memory _userSig = _signDigest(keyA, _digest);
        bytes memory _attSig = _signDigest(attestorKey, _digest);

        address _attacker = makeAddr("Attacker");
        IAccount.Call[] memory _malicious = new IAccount.Call[](1);
        _malicious[0] = IAccount.Call({
            target: address(_usdc),
            value: 0,
            gasLimit: 100_000,
            callData: abi.encodeCall(IERC20.transfer, (_attacker, 100e6))
        });

        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        puppetA.execute(_malicious, _usdc, 0, 0, 0, address(0), 0);

        vm.prank(_attacker);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        puppetA.execute(_malicious, _usdc, 0, 0, 0, address(0), 0);

        vm.prank(_attacker);
        vm.expectRevert(Error.Permission__Unauthorized.selector);
        accountGate.dispatch(
            puppetA,
            _malicious,
            _digest,
            _userSig,
            _attSig,
            attestor,
            _intent.nonce,
            _usdc,
            0,
            0,
            0,
            address(0),
            200_000
        );

        assertEq(_usdc.balanceOf(address(puppetA)), 100e6, "puppet untouched");
        assertEq(_usdc.balanceOf(_attacker), 0, "attacker gained nothing");
    }

    function test_idleDustDoesNotInflateFulfillDrain() public {
        IERC20 _usdc = IERC20(address(usdc));
        _subscribe1(puppetA, userA, keyA, 100e6);
        _fundPuppet(puppetA, 100e6);
        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(100e6, _aOnly);
        _sell1(puppetA, userA, keyA, ShareToken(router.predictShareToken(master1Pool)).balanceOf(address(puppetA)));

        usdc.mint(master1Pool, 50e6);
        uint _masterBefore = _usdc.balanceOf(master1Pool);
        uint _storeBefore = _usdc.balanceOf(address(redeemStore));

        _fulfill1(type(uint).max);

        uint _credited = _usdc.balanceOf(address(redeemStore)) - _storeBefore;
        assertApproxEqAbs(_credited, 100e6, 1, "drain matches signed queue value, not idle dust");
        assertEq(
            _usdc.balanceOf(master1Pool),
            _masterBefore - _credited,
            "master pool debited exactly the drain; dust untouched"
        );
    }

    function test_partialFulfillCreditsPendingQueue() public {
        IERC20 _usdc = IERC20(address(usdc));
        _subscribe1(puppetA, userA, keyA, 100e6);
        _fundPuppet(puppetA, 100e6);
        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(100e6, _aOnly);
        _sell1(puppetA, userA, keyA, ShareToken(router.predictShareToken(master1Pool)).balanceOf(address(puppetA)));

        RedeemStore.Pool memory _poolBefore = redeemStore.getPool(master1Pool, _usdc);
        assertGt(_poolBefore.totalStake, 0, "stake pending in pool");

        _fulfill1(30e6);

        RedeemStore.Pool memory _poolAfter = redeemStore.getPool(master1Pool, _usdc);
        assertGt(_poolAfter.accruedPerStake, _poolBefore.accruedPerStake, "partial fulfill credits the pending queue");
        assertGt(
            redeem.getClaimable(redeemStore, master1Pool, _usdc, address(puppetA)),
            0,
            "queued holder accrues from partial drain"
        );
    }

    function test_allocate_revertsOnDuplicatePuppet() public {
        _subscribe1(puppetA, userA, keyA, 100e6);
        _subscribe1(puppetB, userB, keyB, 100e6);
        _fundPuppet(puppetA, 100e6);
        _fundPuppet(puppetB, 100e6);

        address[] memory _dup = new address[](2);
        _dup[0] = address(puppetA);
        _dup[1] = address(puppetA);
        (
            AllocateModule.AllocateIntent memory _i1,
            bytes memory _u1,
            bytes memory _a1,
            bytes[] memory _b1,
            bytes[] memory _s1
        ) = _attestAllocateModule1(100e6, _dup);
        vm.expectRevert(
            abi.encodeWithSelector(Error.Allocate__PuppetListNotSorted.selector, address(puppetA), address(puppetA))
        );
        router.allocate(_i1, _b1, _s1, _u1, _a1, _i1.acceptableRelayFee);

        (address _lo, address _hi) = uint160(address(puppetA)) < uint160(address(puppetB))
            ? (address(puppetA), address(puppetB))
            : (address(puppetB), address(puppetA));
        address[] memory _unsorted = new address[](2);
        _unsorted[0] = _hi;
        _unsorted[1] = _lo;
        (
            AllocateModule.AllocateIntent memory _i2,
            bytes memory _u2,
            bytes memory _a2,
            bytes[] memory _b2,
            bytes[] memory _s2
        ) = _attestAllocateModule1(100e6, _unsorted);
        vm.expectRevert(abi.encodeWithSelector(Error.Allocate__PuppetListNotSorted.selector, _hi, _lo));
        router.allocate(_i2, _b2, _s2, _u2, _a2, _i2.acceptableRelayFee);
    }

    function _attestAllocateModule1(
        uint _masterAmount,
        address[] memory _puppetList
    )
        internal
        returns (
            AllocateModule.AllocateIntent memory _intent,
            bytes memory _userSig,
            bytes memory _attSig,
            bytes[] memory _bodyList,
            bytes[] memory _sigList
        )
    {
        ShareToken _st = ShareToken(router.predictShareToken(master1Pool));
        uint _supply;
        if (address(_st).code.length > 0) _supply = _st.totalSupply();
        uint _n = _puppetList.length;
        uint[] memory _matched = new uint[](_n);
        _bodyList = new bytes[](_n);
        _sigList = new bytes[](_n);
        for (uint _i; _i < _n; ++_i) {
            address _p = _puppetList[_i];
            _matched[_i] = _testMatched[_p][master1KeyPersonal];
            _bodyList[_i] = _testBody[_p][master1KeyPersonal];
            _sigList[_i] = _testSig[_p][master1KeyPersonal];
        }
        _intent = AllocateModule.AllocateIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _master1Params(),
            baseToken: IERC20(address(usdc)),
            acceptableNetAssetValue: _supply == 0 ? 1 : _supply,
            totalShareSupply: _supply,
            masterAmount: _masterAmount,
            puppetList: _puppetList,
            matchedAmountList: _matched,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    ALLOCATE_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.masterAmount,
                    keccak256(abi.encodePacked(_intent.puppetList)),
                    keccak256(abi.encodePacked(_intent.matchedAmountList))
                )
            )
        );
        _userSig = _signDigest(key1, _digest);
        _attSig = _signDigest(attestorKey, _digest);
    }

    function _stakeBoth() internal {
        _subscribe1(puppetA, userA, keyA, 100e6);
        _subscribe2(puppetB, userB, keyB, 100e6);

        _fundPuppet(puppetA, 100e6);
        _fundPuppet(puppetB, 100e6);

        address[] memory _aOnly = new address[](1);
        _aOnly[0] = address(puppetA);
        _allocate1(100e6, _aOnly);

        address[] memory _bOnly = new address[](1);
        _bOnly[0] = address(puppetB);
        _allocate2(100e6, _bOnly);

        _sell1(puppetA, userA, keyA, ShareToken(router.predictShareToken(master1Pool)).balanceOf(address(puppetA)));
        _sell2(puppetB, userB, keyB, ShareToken(router.predictShareToken(master2Pool)).balanceOf(address(puppetB)));
    }

    function _drainBoth() internal {
        _fulfill1(type(uint).max);
        _fulfill2(type(uint).max);
    }

    function _assertNoSiphon() internal {
        IERC20 _usdc = IERC20(address(usdc));

        assertEq(
            redeemStore.signedBalanceMap(_usdc),
            _usdc.balanceOf(address(redeemStore)),
            "signedBalanceMap stays in sync with store balance"
        );

        RedeemStore.Pool memory _pool1 = redeemStore.getPool(master1Pool, _usdc);
        RedeemStore.Pool memory _pool2 = redeemStore.getPool(master2Pool, _usdc);
        assertGt(_pool1.accruedPerStake, 0, "master1 pool credited its own drain");
        assertGt(_pool2.accruedPerStake, 0, "master2 pool credited its own drain");

        uint _viewA = redeem.getClaimable(redeemStore, master1Pool, _usdc, address(puppetA));
        uint _viewB = redeem.getClaimable(redeemStore, master2Pool, _usdc, address(puppetB));
        assertLe(_viewA + _viewB, _usdc.balanceOf(address(redeemStore)), "views never double-count the store");

        address _depA = address(puppetA);
        uint _aBefore = _usdc.balanceOf(_depA);
        _claim1(puppetA, userA, keyA, redeem.getClaimable(redeemStore, master1Pool, _usdc, address(puppetA)));
        uint _aReceived = _usdc.balanceOf(_depA) - _aBefore;
        assertApproxEqAbs(_aReceived, 100e6, 5, "puppetA receives only master1's drain");

        address _depB = address(puppetB);
        uint _bBefore = _usdc.balanceOf(_depB);
        _claim2(puppetB, userB, keyB, redeem.getClaimable(redeemStore, master2Pool, _usdc, address(puppetB)));
        uint _bReceived = _usdc.balanceOf(_depB) - _bBefore;
        assertApproxEqAbs(_bReceived, 100e6, 5, "puppetB receives master2's drain (not siphoned)");
    }

    function _bootstrapPuppet(
        address _u,
        uint _k,
        bytes32 _name
    ) internal returns (PuppetAccount) {
        AccountLib.AccountInitParams memory _p =
            AccountLib.AccountInitParams({user: _u, name: _name, baseTokenId: USDC_ID, signer: address(0)});
        accountGate.createPuppetAccount(_p, _bindSig(_k), "");
        return PuppetAccount(payable(accountGate.predictPuppetAccount(_p)));
    }

    function _subscribe1(
        PuppetAccount _puppet,
        address _u,
        uint _k,
        uint _allowance
    ) internal {
        _subscribeWithMaster(_puppet, _u, _k, _master1Params(), _allowance, _encodeRuleBody());
    }

    function _subscribeWithMaster(
        PuppetAccount _puppet,
        address _u,
        uint _k,
        AccountLib.AccountInitParams memory _masterParams,
        uint _allowance,
        bytes memory _body
    ) internal {
        address _master = accountGate.predictMasterAccount(_masterParams);
        bytes32 _authDigest = _mandateDigest(address(_puppet), _master, address(usdc), keccak256(_body));
        bytes memory _standingSig = _signDigest(_k, _authDigest);

        RuleLib.Rule[] memory _rules = new RuleLib.Rule[](1);
        _rules[0] = RuleLib.Rule({masterParams: _masterParams, body: _body, mandate: _standingSig});
        SubscribeModule.SubscribeIntent memory _intent = SubscribeModule.SubscribeIntent({
            params: _puppetParams(_u, _puppet.getName()),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid,
            baseToken: IERC20(address(usdc)),
            rules: _rules
        });
        bytes32 _ruleHash = keccak256(
            abi.encodePacked(
                keccak256(
                    abi.encode(
                        RuleLib.SUBSCRIBE_RULE_TYPEHASH,
                        _hashAccount(_rules[0].masterParams),
                        keccak256(_body),
                        keccak256(_standingSig)
                    )
                )
            )
        );
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    SUBSCRIBE_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    _ruleHash
                )
            )
        );
        router.subscribe(
            _intent, _signDigest(_k, _digest), _signDigest(attestorKey, _digest), _intent.acceptableRelayFee
        );

        _testBody[address(_puppet)][_master] = _body;
        _testSig[address(_puppet)][_master] = _standingSig;
        _testMatched[address(_puppet)][_master] = _allowance;
    }

    function _fundPuppet(
        PuppetAccount _puppet,
        uint _amount
    ) internal {
        usdc.mint(address(_puppet), _amount);
        vm.store(address(_puppet), bytes32(uint(0)), bytes32(uint(_puppet.signedBalance() + _amount)));
    }

    function test_operatorExit_redeemsOwnSharesToOwnerWallet() public {
        IERC20 _usdc = IERC20(address(usdc));
        ShareToken _st = ShareToken(router.predictShareToken(master1Pool));

        uint _ownerShares = _st.balanceOf(master1Pool);
        assertEq(_ownerShares, 10e6, "operator holds genesis shares at the master account itself");
        assertEq(_usdc.balanceOf(user1), 0, "operator wallet starts empty");

        _sellOwner1(_ownerShares);
        assertEq(_st.balanceOf(master1Pool), 0, "operator shares moved into the redeem queue");

        _fulfill1(type(uint).max);

        uint _claimable = redeem.getClaimable(redeemStore, master1Pool, _usdc, master1Pool);
        assertGt(_claimable, 0, "operator accrued base from the buyback it funded");
        _claimOwner1(_claimable);

        assertEq(_usdc.balanceOf(user1), _claimable, "operator base lands in the wallet, not back in the pool");
        assertLe(_usdc.balanceOf(master1Pool), 1, "pool drained to the operator, only sub-share dust remains");
    }

    function _sellOwner1(
        uint _sharesOut
    ) internal {
        RedeemModule.SellIntent memory _intent = RedeemModule.SellIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _master1Params(),
            masterParams: _master1Params(),
            sharesOut: _sharesOut,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    SELL_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _hashAccount(_intent.masterParams),
                    _intent.sharesOut
                )
            )
        );
        router.sell(_intent, _signDigest(key1, _digest), _signDigest(attestorKey, _digest), _intent.acceptableRelayFee);
    }

    function _claimOwner1(
        uint _amount
    ) internal {
        RedeemModule.ClaimIntent memory _intent = RedeemModule.ClaimIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _master1Params(),
            masterParams: _master1Params(),
            amount: _amount,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _hashAccount(_intent.masterParams),
                    _intent.amount
                )
            )
        );
        router.claim(_intent, _signDigest(key1, _digest), _signDigest(attestorKey, _digest), _intent.acceptableRelayFee);
    }

    // 2-TR split: funds in the master's bridge-recipient route (where OIF fills land) are NOT seedable as
    // masterAmount — allocate sources owner-share seeds ONLY from the distinct deposit route. This structurally
    // blocks minting owner shares for bridged/relocated (already-NAV-counted) funds.
    function test_allocate_masterSeed_rejectsBridgedFundsInBridgeRoute() public {
        address _bridgeRoute = accountGate.predictTransientRoute(master1Pool);
        address _depositRoute = accountGate.predictDepositRoute(master1Pool);
        assertTrue(_bridgeRoute != _depositRoute, "bridge and deposit routes are distinct addresses");

        // simulate a bridge fill delivering 100e6 into the master's bridge route; deposit route stays empty
        usdc.mint(_bridgeRoute, 100e6);

        address[] memory _none = new address[](0);
        (
            AllocateModule.AllocateIntent memory _intent,
            bytes memory _userSig,
            bytes memory _attSig,
            bytes[] memory _bodies,
            bytes[] memory _sigs
        ) = _attestAllocateModule1(100e6, _none); // builds the intent but does NOT fund the deposit route

        // the seed must be sourced from the (empty) deposit route -> the transfer reverts -> allocate reverts
        vm.expectRevert();
        router.allocate(_intent, _bodies, _sigs, _userSig, _attSig, _intent.acceptableRelayFee);

        // the bridged funds remain untouched in the bridge route (recognize-only path, mints no shares)
        assertEq(usdc.balanceOf(_bridgeRoute), 100e6, "bridged funds remain in bridge route");
    }

    function _allocate1(
        uint _masterAmount,
        address[] memory _puppetList
    ) internal {
        if (_masterAmount > 0) usdc.mint(accountGate.predictDepositRoute(master1Pool), _masterAmount);
        (
            AllocateModule.AllocateIntent memory _intent,
            bytes memory _userSig,
            bytes memory _attSig,
            bytes[] memory _bodies,
            bytes[] memory _sigs
        ) = _attestAllocateModule1(_masterAmount, _puppetList);
        router.allocate(_intent, _bodies, _sigs, _userSig, _attSig, _intent.acceptableRelayFee);
    }

    function _fulfill1(
        uint _acceptableShares
    ) internal {
        ShareToken _st = ShareToken(router.predictShareToken(master1Pool));
        uint _supply = _st.totalSupply();
        RedeemModule.FulfillIntent memory _intent = RedeemModule.FulfillIntent({
            params: _master1Params(),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid,
            acceptableNetAssetValue: _supply == 0 ? 1 : _supply,
            totalShareSupply: _supply,
            acceptableShares: _acceptableShares
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    FULFILL_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.acceptableShares
                )
            )
        );
        router.fulfill(
            _intent, _signDigest(key1, _digest), _signDigest(attestorKey, _digest), _intent.acceptableRelayFee
        );
    }

    function _sell1(
        PuppetAccount _puppet,
        address _u,
        uint _k,
        uint _sharesOut
    ) internal {
        RedeemModule.SellIntent memory _intent = RedeemModule.SellIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _puppetParams(_u, _puppet.getName()),
            masterParams: _master1Params(),
            sharesOut: _sharesOut,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    SELL_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _hashAccount(_intent.masterParams),
                    _intent.sharesOut
                )
            )
        );
        router.sell(_intent, _signDigest(_k, _digest), _signDigest(attestorKey, _digest), _intent.acceptableRelayFee);
    }

    function _claim1(
        PuppetAccount _puppet,
        address _u,
        uint _k,
        uint _amount
    ) internal {
        RedeemModule.ClaimIntent memory _intent = RedeemModule.ClaimIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _puppetParams(_u, _puppet.getName()),
            masterParams: _master1Params(),
            amount: _amount,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _hashAccount(_intent.masterParams),
                    _intent.amount
                )
            )
        );
        router.claim(_intent, _signDigest(_k, _digest), _signDigest(attestorKey, _digest), _intent.acceptableRelayFee);
    }

    function _subscribe2(
        PuppetAccount _puppet,
        address _u,
        uint _k,
        uint _allowance
    ) internal {
        _subscribeWithMaster(_puppet, _u, _k, _master2Params(), _allowance, _encodeRuleBody());
    }

    function _attestAllocateModule2(
        uint _masterAmount,
        address[] memory _puppetList
    )
        internal
        returns (
            AllocateModule.AllocateIntent memory _intent,
            bytes memory _userSig,
            bytes memory _attSig,
            bytes[] memory _bodyList,
            bytes[] memory _sigList
        )
    {
        ShareToken _st = ShareToken(router.predictShareToken(master2Pool));
        uint _supply;
        if (address(_st).code.length > 0) _supply = _st.totalSupply();
        uint _n = _puppetList.length;
        uint[] memory _matched = new uint[](_n);
        _bodyList = new bytes[](_n);
        _sigList = new bytes[](_n);
        for (uint _i; _i < _n; ++_i) {
            address _p = _puppetList[_i];
            _matched[_i] = _testMatched[_p][master2KeyPersonal];
            _bodyList[_i] = _testBody[_p][master2KeyPersonal];
            _sigList[_i] = _testSig[_p][master2KeyPersonal];
        }
        _intent = AllocateModule.AllocateIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _master2Params(),
            baseToken: IERC20(address(usdc)),
            acceptableNetAssetValue: _supply == 0 ? 1 : _supply,
            totalShareSupply: _supply,
            masterAmount: _masterAmount,
            puppetList: _puppetList,
            matchedAmountList: _matched,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    ALLOCATE_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.masterAmount,
                    keccak256(abi.encodePacked(_intent.puppetList)),
                    keccak256(abi.encodePacked(_intent.matchedAmountList))
                )
            )
        );
        _userSig = _signDigest(key2, _digest);
        _attSig = _signDigest(attestorKey, _digest);
    }

    function _allocate2(
        uint _masterAmount,
        address[] memory _puppetList
    ) internal {
        if (_masterAmount > 0) usdc.mint(accountGate.predictDepositRoute(master2Pool), _masterAmount);
        (
            AllocateModule.AllocateIntent memory _intent,
            bytes memory _userSig,
            bytes memory _attSig,
            bytes[] memory _bodies,
            bytes[] memory _sigs
        ) = _attestAllocateModule2(_masterAmount, _puppetList);
        router.allocate(_intent, _bodies, _sigs, _userSig, _attSig, _intent.acceptableRelayFee);
    }

    function _fulfill2(
        uint _acceptableShares
    ) internal {
        ShareToken _st = ShareToken(router.predictShareToken(master2Pool));
        uint _supply = _st.totalSupply();
        RedeemModule.FulfillIntent memory _intent = RedeemModule.FulfillIntent({
            params: _master2Params(),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid,
            acceptableNetAssetValue: _supply == 0 ? 1 : _supply,
            totalShareSupply: _supply,
            acceptableShares: _acceptableShares
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    FULFILL_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.acceptableShares
                )
            )
        );
        router.fulfill(
            _intent, _signDigest(key2, _digest), _signDigest(attestorKey, _digest), _intent.acceptableRelayFee
        );
    }

    function _sell2(
        PuppetAccount _puppet,
        address _u,
        uint _k,
        uint _sharesOut
    ) internal {
        RedeemModule.SellIntent memory _intent = RedeemModule.SellIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _puppetParams(_u, _puppet.getName()),
            masterParams: _master2Params(),
            sharesOut: _sharesOut,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    SELL_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _hashAccount(_intent.masterParams),
                    _intent.sharesOut
                )
            )
        );
        router.sell(_intent, _signDigest(_k, _digest), _signDigest(attestorKey, _digest), _intent.acceptableRelayFee);
    }

    function _claim2(
        PuppetAccount _puppet,
        address _u,
        uint _k,
        uint _amount
    ) internal {
        RedeemModule.ClaimIntent memory _intent = RedeemModule.ClaimIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _puppetParams(_u, _puppet.getName()),
            masterParams: _master2Params(),
            amount: _amount,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _typedDataDigest(
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _hashAccount(_intent.masterParams),
                    _intent.amount
                )
            )
        );
        router.claim(_intent, _signDigest(_k, _digest), _signDigest(attestorKey, _digest), _intent.acceptableRelayFee);
    }

    function _master1Params() internal view returns (AccountLib.AccountInitParams memory) {
        return
            AccountLib.AccountInitParams({
                user: user1, name: bytes32("Master1"), baseTokenId: USDC_ID, signer: address(0)
            });
    }

    function _master2Params() internal view returns (AccountLib.AccountInitParams memory) {
        return
            AccountLib.AccountInitParams({
                user: user2, name: bytes32("Master2"), baseTokenId: USDC_ID, signer: address(0)
            });
    }

    function _puppetParams(
        address _u,
        bytes32 _name
    ) internal pure returns (AccountLib.AccountInitParams memory) {
        return AccountLib.AccountInitParams({user: _u, name: _name, baseTokenId: USDC_ID, signer: address(0)});
    }

    function _encodeRuleBody() internal pure returns (bytes memory) {
        return abi.encode(uint(0), uint(0));
    }

    function _nonce() internal returns (uint) {
        _nonceCounter++;
        return _nonceCounter;
    }

    function _seedMasterAccount(
        AccountLib.AccountInitParams memory _p,
        uint _userKey
    ) internal {
        uint _genesisSeed = 10e6;
        usdc.mint(accountGate.predictDepositRoute(accountGate.predictMasterAccount(_p)), _genesisSeed);
        AllocateModule.AllocateIntent memory _intent = AllocateModule.AllocateIntent({
            params: _p,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid,
            baseToken: IERC20(address(usdc)),
            acceptableNetAssetValue: 1,
            totalShareSupply: 0,
            masterAmount: _genesisSeed,
            puppetList: new address[](0),
            matchedAmountList: new uint[](0)
        });
        bytes32 _d = _typedDataDigest(
            keccak256(
                abi.encode(
                    ALLOCATE_INTENT_TYPEHASH,
                    _hashAccount(_p),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.masterAmount,
                    keccak256(abi.encodePacked(_intent.puppetList)),
                    keccak256(abi.encodePacked(_intent.matchedAmountList))
                )
            )
        );
        router.seedMasterAccount(
            _intent,
            new bytes[](0),
            new bytes[](0),
            _bindSig(_userKey),
            "",
            _signDigest(_userKey, _d),
            _signDigest(attestorKey, _d),
            0
        );
    }

    function _hashAccount(
        AccountLib.AccountInitParams memory _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(ACCOUNT_TYPEHASH, _p.user, _p.name, _p.baseTokenId, _p.signer));
    }

    function _domainSeparator() internal view returns (bytes32) {
        bytes32 _typeHash =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        return keccak256(
            abi.encode(_typeHash, keccak256(bytes("HubGate")), keccak256(bytes("1")), block.chainid, address(router))
        );
    }

    function _typedDataDigest(
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, _structHash));
    }

    function _mandateDigest(
        address _puppet,
        address _master,
        address _baseToken,
        bytes32 _bodyHash
    ) internal view returns (bytes32) {
        bytes32 _typeHash = keccak256("Mandate(address puppet,address master,address baseToken,bytes32 bodyHash)");
        return keccak256(
            abi.encodePacked(
                "\x19\x01", domainSeparator, keccak256(abi.encode(_typeHash, _puppet, _master, _baseToken, _bodyHash))
            )
        );
    }

    function _bindSig(
        uint _k
    ) internal pure returns (bytes memory) {
        bytes memory _msg = bytes("Puppet: Authorize session key");
        bytes32 _digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", vm.toString(_msg.length), _msg));
        return _signDigest(_k, _digest);
    }

    function _signDigest(
        uint _k,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        (uint8 _v, bytes32 _r, bytes32 _s) = vm.sign(_k, _digest);
        return abi.encodePacked(_r, _s, _v);
    }
}
