// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Test} from "forge-std/src/Test.sol";

import {Account as PuppetAccount} from "src/core/Account.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {BondStore} from "src/core/BondStore.sol";
import {Deposit} from "src/core/Deposit.sol";
import {DepositRoute} from "src/core/DepositRoute.sol";
import {Dictate} from "src/core/Dictate.sol";
import {EvmChain} from "src/core/EvmChain.sol";
import {Register} from "src/core/Register.sol";
import {CoreGate} from "src/CoreGate.sol";
import {HubGate} from "src/HubGate.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {Error} from "src/utils/Error.sol";
import {BaseGate} from "src/utils/BaseGate.sol";
import {SwapLib} from "src/utils/SwapLib.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";
import {IChain} from "src/utils/interfaces/IChain.sol";
import {IWNT} from "src/utils/interfaces/IWNT.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";

import {MockERC20} from "./mock/MockERC20.t.sol";
import {MockBridge} from "./mock/MockBridge.t.sol";
import {MockSwapProvider} from "./mock/MockSwapProvider.t.sol";
import {MockWNT} from "./mock/MockWNT.t.sol";

contract HotPathTest is Test {
    struct Party {
        address user;
        uint userKey;
        address signer;
        uint signerKey;
        address acct;
        uint acctKey;
    }

    uint constant SESSION_TTL = 7 days;
    uint constant GAS = 200_000;
    uint constant RESET_PERIOD = 7 days;
    uint constant RATE = 10_000;
    uint constant FEE = 1e6;
    bytes32 constant DEPOSIT_SWAP_TYPEHASH = keccak256(
        "DepositSwap(IntentHeader header,SwapParams swap,uint256 destinationChainId)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)SwapParams(address inputToken,uint256 inputAmount,address outputToken,uint256 outputAmount,address provider,bytes providerCallData)"
    );

    address owner = makeAddr("Owner");
    address feeReceiver = makeAddr("FeeReceiver");
    address attestor;
    uint attestorKey;

    MockERC20 usdc;
    MockWNT wnt;
    Dictate dictate;
    Register register;
    BondStore bondStore;
    AccountModule accountModule;
    Deposit depositModule;
    CoreGate coreGate;
    HubGate hubGate;

    AccountLib.Mandate mandateSpec;

    Party master;
    Party alice;
    Party bob;

    function setUp() public {
        vm.chainId(1);
        (attestor, attestorKey) = makeAddrAndKey("Attestor");

        vm.startPrank(owner);
        usdc = new MockERC20("USDC", "USDC", 6);
        wnt = new MockWNT();
        dictate = new Dictate(owner);
        register = new Register(address(dictate));
        bondStore = new BondStore(address(dictate));

        IChain chain = new EvmChain();
        accountModule = new AccountModule(
            address(dictate), chain, address(new PuppetAccount()), address(new DepositRoute()), RESET_PERIOD
        );

        BaseGate.Config memory cfg = BaseGate.Config({
            attestor: attestor,
            feeReceiver: feeReceiver,
            transferGasLimit: GAS,
            maxIntentTtl: 10 minutes,
            maxRelayFeeBps: 2000,
            performanceFee: 1000,
            maxCohortSize: 50
        });
        depositModule =
            new Deposit(address(dictate), accountModule, register, IWNT(address(wnt)));
        coreGate = new CoreGate(accountModule, register, depositModule, cfg);
        hubGate = new HubGate(accountModule, register, depositModule, bondStore, address(usdc), cfg);

        dictate.setAccess(accountModule, address(coreGate));
        dictate.setAccess(accountModule, address(depositModule));
        dictate.setAccess(depositModule, address(coreGate));
        dictate.setAccess(depositModule, address(hubGate));
        dictate.setAccess(accountModule, address(hubGate));
        dictate.setAccess(bondStore, address(hubGate));
        dictate.setAccess(accountModule, address(this));
        dictate.setAccess(register, owner);

        register.setRegistered(NATIVE_TOKEN, type(uint).max, bytes32("NATIVE"));
        register.setRegistered(address(usdc), type(uint).max, bytes32("USDC"));
        register.setRegistered(address(wnt), type(uint).max, bytes32("WNT"));
        vm.stopPrank();

        master = _open("master", 3000e6);
        bytes32[] memory _ids = new bytes32[](1);
        _ids[0] = register.tokenIdMap(address(usdc));
        mandateSpec = AccountLib.Mandate({
            master: master.acct,
            skin: 5000,
            allocationRate: 5000,
            cooldownPeriod: 0,
            expiry: block.timestamp + 365 days,
            tokenIdList: _ids
        });
        alice = _open("alice", 1200e6);
        bob = _open("bob", 1200e6);
    }

    function _claim(address _token, uint _amount) internal view returns (Deposit.ScheduledCredit memory) {
        return Deposit.ScheduledCredit({
            token: _token,
            amount: _amount,
            expiry: block.timestamp + 1 hours,
            fee: FEE
        });
    }

    function _claimDigest(address _account, Deposit.ScheduledCredit memory _c) internal view returns (bytes32) {
        return _digest(
            _account,
            keccak256(
                abi.encode(
                    keccak256("ScheduledCredit(address token,uint256 amount,uint256 expiry,uint256 fee)"),
                    _c.token,
                    _c.amount,
                    _c.expiry,
                    _c.fee
                )
            )
        );
    }

    function _hashHeader(
        AccountLib.IntentHeader memory _h
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                ),
                _h.account,
                _h.user,
                _h.nonce,
                _h.deadline,
                _h.feeToken,
                _h.fee
            )
        );
    }

    function _hashSwap(
        SwapLib.SwapParams memory _s
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "SwapParams(address inputToken,uint256 inputAmount,address outputToken,uint256 outputAmount,address provider,bytes providerCallData)"
                ),
                _s.inputToken,
                _s.inputAmount,
                _s.outputToken,
                _s.outputAmount,
                _s.provider,
                keccak256(_s.providerCallData)
            )
        );
    }

    function _mandateDigest(
        address _puppet,
        AccountLib.Mandate memory _m
    ) internal pure returns (bytes32) {
        bytes32 _struct = keccak256(
            abi.encode(
                keccak256(
                    "Mandate(address master,uint256 skin,uint256 allocationRate,uint256 cooldownPeriod,uint256 expiry,bytes32[] tokenIdList)"
                ),
                _m.master,
                _m.skin,
                _m.allocationRate,
                _m.cooldownPeriod,
                _m.expiry,
                keccak256(abi.encodePacked(_m.tokenIdList))
            )
        );
        return keccak256(
            abi.encodePacked(
                hex"1901",
                keccak256(
                    abi.encode(
                        keccak256("EIP712Domain(string name,string version,address verifyingContract)"),
                        keccak256("Puppet"),
                        keccak256("1"),
                        _puppet
                    )
                ),
                _struct
            )
        );
    }

    function _sign(
        uint _key,
        bytes32 _hash
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key, _hash);
        return abi.encodePacked(r, s, v);
    }

    function _pair(
        Party memory _p,
        bytes32 _digest
    ) internal view returns (bytes memory) {
        return abi.encodePacked(_sign(_p.signerKey, _digest), _sign(attestorKey, _digest));
    }

    function _stage(
        string memory _label
    ) internal returns (Party memory p) {
        (p.user, p.userKey) = makeAddrAndKey(_label);
        (p.signer, p.signerKey) = makeAddrAndKey(string.concat(_label, ".signer"));
        (p.acct, p.acctKey) = makeAddrAndKey(string.concat(_label, ".acct"));
    }

    function _create(
        Party memory p
    ) internal {
        vm.signAndAttachDelegation(accountModule.accountImpl(), p.acctKey);
        bytes32 _d = AccountLib.genesisDigest(address(accountModule), p.acct, p.user, p.signer);
        uint _expiry = block.timestamp + SESSION_TTL;
        bytes32 _s = AccountLib.sessionDigest(address(accountModule), p.user, p.signer, _expiry);
        accountModule.createAccount(p.acct, p.user, p.signer, _expiry, _sign(p.acctKey, _d), _sign(p.userKey, _s));
    }

    function _open(
        string memory _label,
        uint _fund
    ) internal returns (Party memory p) {
        p = _stage(_label);
        _create(p);
        usdc.mint(p.acct, _fund);
    }

    function _signedSwap(
        AccountLib.IntentHeader memory _h,
        SwapLib.SwapParams memory _swap,
        uint _destinationChainId
    ) internal view returns (Deposit.DepositSwap memory i_, bytes32 d_) {
        _h.feeToken = _swap.inputToken;
        i_ = Deposit.DepositSwap({header: _h, swap: _swap, destinationChainId: _destinationChainId});
        d_ = _digest(
            _h.account, keccak256(abi.encode(DEPOSIT_SWAP_TYPEHASH, _hashHeader(_h), _hashSwap(_swap), _destinationChainId))
        );
    }

    function _hdr(
        Party memory _p
    ) internal view returns (AccountLib.IntentHeader memory) {
        return AccountLib.IntentHeader({
            account: _p.acct,
            user: _p.user,
            nonce: IAccount(_p.acct).nonce(),
            deadline: block.timestamp + 5 minutes,
            feeToken: address(usdc),
            fee: FEE
        });
    }

    function _mandateOf(
        address
    ) internal view returns (AccountLib.Mandate memory) {
        return mandateSpec;
    }

    function _bond(
        Party memory _p,
        uint _amount
    ) internal returns (AccountLib.Mandate memory m) {
        m = _mandateOf(master.acct);
        AccountLib.Mandate[] memory _list = new AccountLib.Mandate[](1);
        _list[0] = m;
        bytes[] memory _sigs = new bytes[](1);
        _sigs[0] = _sign(_p.signerKey, _mandateDigest(_p.acct, m));

        HubGate.MandateIntent memory _i = HubGate.MandateIntent({
            header: _hdr(_p), creditList: new address[](0), bond: _amount, mandateList: _list, signatureList: _sigs
        });
        bytes32 _d = _digest(
            _p.acct,
            keccak256(
                abi.encode(
                    keccak256(
                        "MandateIntent(IntentHeader header,bytes32 creditListHash,uint256 bond,bytes32 mandateListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                    ),
                    _hashHeader(_i.header),
                    keccak256(abi.encode(_i.creditList)),
                    _i.bond,
                    keccak256(abi.encode(_i.mandateList))
                )
            )
        );
        hubGate.mandate(_i, _pair(_p, _d), _noGenesis());
    }

    function _noGenesis() internal pure returns (AccountLib.Genesis memory) {
        return AccountLib.Genesis({signer: address(0), expiry: 0, key: "", user: ""});
    }

    function _genesisOf(
        Party memory _p
    ) internal returns (AccountLib.Genesis memory) {
        vm.signAndAttachDelegation(accountModule.accountImpl(), _p.acctKey);
        bytes32 _d = AccountLib.genesisDigest(address(accountModule), _p.acct, _p.user, _p.signer);
        uint _expiry = block.timestamp + SESSION_TTL;
        bytes32 _s = AccountLib.sessionDigest(address(accountModule), _p.user, _p.signer, _expiry);
        return AccountLib.Genesis({signer: _p.signer, expiry: _expiry, key: _sign(_p.acctKey, _d), user: _sign(_p.userKey, _s)});
    }

    function _digest(
        address _account,
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                hex"1901",
                keccak256(
                    abi.encode(
                        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                        keccak256("Puppet"),
                        keccak256("1"),
                        block.chainid,
                        _account
                    )
                ),
                _structHash
            )
        );
    }

    function _row(
        Party memory _p,
        AccountLib.Mandate memory _m,
        uint _stake
    ) internal view returns (AccountLib.Backing memory) {
        return AccountLib.Backing({
            puppet: _p.acct,
            matchable: 1000e6,
            stake: _stake,
            mandate: _m
        });
    }

    function _sorted(
        Party memory _a,
        Party memory _b
    ) internal pure returns (Party memory, Party memory) {
        return uint160(_a.acct) < uint160(_b.acct) ? (_a, _b) : (_b, _a);
    }

    function _deposit(
        Party memory _p,
        uint _amount
    ) internal {
        usdc.mint(_p.user, _amount);
        vm.startPrank(_p.user);
        usdc.approve(address(depositModule), _amount);
        coreGate.deposit(_p.acct, address(usdc), _amount);
        vm.stopPrank();
    }

    function test_a_scheduled_credit_settles_when_funded_only_once_and_dies_at_expiry() public {
        address _route = accountModule.predictDepositRoute(alice.user);

        Deposit.ScheduledCredit memory _c = _claim(address(usdc), 300e6);
        bytes memory _sig = _pair(alice, _claimDigest(alice.acct, _c));

        vm.expectRevert(abi.encodeWithSelector(Error.Schedule__NotArrived.selector, address(usdc), 0, 300e6));
        coreGate.credit(alice.acct, alice.user, _c, _sig, _noGenesis());

        usdc.mint(_route, 300e6);
        uint _before = usdc.balanceOf(alice.acct);
        coreGate.credit(alice.acct, alice.user, _c, _sig, _noGenesis());
        assertEq(usdc.balanceOf(alice.acct), _before + 300e6 - FEE, "the scheduled credit swept the route net of its fee");
        assertEq(usdc.balanceOf(_route), 0, "the route is drained");

        usdc.mint(_route, 300e6);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__DigestConsumed.selector, _claimDigest(alice.acct, _c)));
        coreGate.credit(alice.acct, alice.user, _c, _sig, _noGenesis());
        assertEq(usdc.balanceOf(_route), 300e6, "a replayed claim moves nothing and charges nothing");

        vm.warp(_c.expiry + 1);
        uint _now = block.timestamp;
        vm.expectRevert(abi.encodeWithSelector(Error.Schedule__Expired.selector, _c.expiry, _now));
        coreGate.credit(alice.acct, alice.user, _c, _sig, _noGenesis());
    }

    function test_a_direct_native_deposit_credits_the_account_in_full() public {
        vm.deal(alice.user, 5e18);
        uint _accountBefore = alice.acct.balance;
        uint _feeBefore = feeReceiver.balance;

        vm.prank(alice.user);
        coreGate.deposit{value: 4e18}(alice.acct, NATIVE_TOKEN, 4e18);

        assertEq(alice.acct.balance, _accountBefore + 4e18, "the account is credited the whole amount, no relay fee");
        assertEq(feeReceiver.balance, _feeBefore, "no fee is taken from a direct deposit");
        assertEq(alice.user.balance, 1e18, "the wallet paid exactly the amount");
    }

    function test_a_direct_deposit_needs_the_wallet_that_owns_the_account() public {
        usdc.mint(bob.user, 100e6);
        vm.startPrank(bob.user);
        usdc.approve(address(depositModule), 100e6);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        coreGate.deposit(alice.acct, address(usdc), 100e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(bob.user), 100e6, "nothing moved");
    }

    function test_a_direct_deposit_refuses_native_on_a_plain_token() public {
        vm.deal(alice.user, 1);
        vm.prank(alice.user);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__ValueMismatch.selector, 1, 0));
        coreGate.deposit{value: 1}(alice.acct, address(usdc), 1);
    }

    function test_a_direct_wrapped_deposit_fuses_attached_native_with_pulled_wrapped() public {
        vm.deal(alice.user, 2e18);
        uint _accountBefore = wnt.balanceOf(alice.acct);
        vm.startPrank(alice.user);
        wnt.deposit{value: 1e18}();
        wnt.approve(address(depositModule), 1e18);
        coreGate.deposit{value: 1e18}(alice.acct, address(wnt), 2e18);
        vm.stopPrank();

        assertEq(wnt.balanceOf(alice.acct), _accountBefore + 2e18, "both halves landed wrapped in the account");
        assertEq(wnt.balanceOf(alice.user), 0, "the pulled half left the wallet");
        assertEq(alice.user.balance, 0, "the attached half left the wallet");
        assertEq(wnt.balanceOf(address(depositModule)), 0, "the module keeps nothing");
    }

    function test_a_direct_native_deposit_fuses_pulled_wrapped_with_attached_native() public {
        vm.deal(alice.user, 3e18);
        uint _accountBefore = alice.acct.balance;
        vm.startPrank(alice.user);
        wnt.deposit{value: 2e18}();
        wnt.approve(address(depositModule), 2e18);
        coreGate.deposit{value: 1e18}(alice.acct, NATIVE_TOKEN, 3e18);
        vm.stopPrank();

        assertEq(alice.acct.balance, _accountBefore + 3e18, "the pulled wrapped was unwrapped and joined the attached native");
        assertEq(wnt.balanceOf(alice.user), 0, "the wrapped half left the wallet");
        assertEq(alice.user.balance, 0, "the native half left the wallet");
        assertEq(address(depositModule).balance, 0, "the module keeps nothing native");
        assertEq(wnt.balanceOf(address(depositModule)), 0, "the module keeps nothing wrapped");
    }

    function test_a_hub_deposit_splits_the_amount_between_the_account_and_the_bond() public {
        uint _accountBefore = usdc.balanceOf(alice.acct);
        uint _storeBefore = usdc.balanceOf(address(bondStore));
        usdc.mint(alice.user, 500e6);
        vm.startPrank(alice.user);
        usdc.approve(address(depositModule), 500e6);
        hubGate.deposit(alice.acct, address(usdc), 500e6, 200e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice.acct), _accountBefore + 300e6, "the unbonded part is credited to the account");
        assertEq(bondStore.bondMap(alice.acct, address(usdc)), 200e6, "the bonded part is booked to the account");
        assertEq(usdc.balanceOf(address(bondStore)), _storeBefore + 200e6, "and held by the store");
        assertEq(usdc.balanceOf(alice.user), 0, "the wallet paid the whole amount");
    }

    function test_a_hub_deposit_bonds_only_the_bond_token() public {
        wnt.deposit{value: 1e18}();
        wnt.transfer(alice.user, 1e18);
        vm.startPrank(alice.user);
        wnt.approve(address(depositModule), 1e18);
        vm.expectRevert(abi.encodeWithSelector(Error.Bond__WrongToken.selector, address(wnt)));
        hubGate.deposit(alice.acct, address(wnt), 1e18, 1e18);
        vm.stopPrank();
    }

    function _bridgeIntent(
        AccountLib.IntentHeader memory _h,
        MockBridge _bridge,
        uint _amount
    ) internal view returns (Deposit.DepositSwap memory, bytes32) {
        return _signedSwap(
            _h,
            SwapLib.SwapParams({
                inputToken: address(usdc),
                inputAmount: _amount,
                outputToken: address(usdc),
                outputAmount: _amount - FEE,
                provider: address(_bridge),
                providerCallData: abi.encodeCall(
                    MockBridge.send, (address(usdc), _amount - FEE, 42_161, accountModule.predictDepositRoute(_h.user))
                )
            }),
            42_161
        );
    }

    function test_flow_a_direct_deposit_pulls_the_wallet_into_the_account_with_no_fee() public {
        address _route = accountModule.predictDepositRoute(alice.user);
        uint _accountBefore = usdc.balanceOf(alice.acct);
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        uint _nonceBefore = IAccount(alice.acct).nonce();

        _deposit(alice, 500e6);

        assertEq(usdc.balanceOf(alice.user), 0, "the wallet was emptied by the pull");
        assertEq(usdc.balanceOf(_route), 0, "the route is not involved");
        assertEq(usdc.balanceOf(alice.acct), _accountBefore + 500e6, "the account is credited in full");
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore, "no relay fee on a direct deposit");
        assertEq(IAccount(alice.acct).nonce(), _nonceBefore, "no intent nonce is consumed");
    }

    function test_flow_a_credit_carrying_genesis_creates_the_account_and_sweeps_in_one_transaction() public {
        Party memory _p = _stage("onboarding-genesis-credit");
        address _route = accountModule.predictDepositRoute(_p.user);
        uint _feeBefore = usdc.balanceOf(feeReceiver);

        usdc.mint(_p.user, 500e6);
        vm.startPrank(_p.user);
        usdc.approve(address(depositModule), 500e6);
        coreGate.depositRoute(address(usdc), 500e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(_route), 500e6, "the wallet funded its route through the gate");
        assertEq(_p.acct.code.length, 0, "no account has been created yet");

        AccountLib.Genesis memory _g = _genesisOf(_p);
        assertEq(IAccount(_p.acct).nonce(), 0, "the delegation is attached but the body is still unwritten");

        address[] memory _list = new address[](1);
        _list[0] = address(usdc);
        Deposit.ScheduledCredit memory _c = _claim(address(usdc), 500e6);
        coreGate.credit(_p.acct, _p.user, _c, _pair(_p, _claimDigest(_p.acct, _c)), _g);

        (, address _user, address _signer) = IAccount(_p.acct).args();
        assertEq(_user, _p.user, "the genesis rode with the credit and created the account");
        assertEq(_signer, _p.signer, "the body records the signer the genesis named");
        assertEq(usdc.balanceOf(_route), 0, "the credit swept the route");
        assertEq(usdc.balanceOf(_p.acct), 500e6 - FEE, "the account holds the swept deposit net of the relay fee");
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore + FEE, "the credit paid its relay fee");
    }

    function test_flow_a_mandate_carrying_genesis_creates_the_account_and_bonds_in_one_transaction() public {
        Party memory _p = _stage("onboarding-genesis-mandate");
        usdc.mint(accountModule.predictDepositRoute(_p.user), 500e6);

        AccountLib.Genesis memory _g = _genesisOf(_p);
        AccountLib.Mandate memory _m = _mandateOf(master.acct);
        AccountLib.Mandate[] memory _mandates = new AccountLib.Mandate[](1);
        _mandates[0] = _m;
        bytes[] memory _sigs = new bytes[](1);
        _sigs[0] = _sign(_p.signerKey, _mandateDigest(_p.acct, _m));
        address[] memory _list = new address[](1);
        _list[0] = address(usdc);

        AccountLib.IntentHeader memory _h = _hdr(_p);
        _h.nonce = 1;
        HubGate.MandateIntent memory _i = HubGate.MandateIntent({
            header: _h, creditList: _list, bond: 100e6, mandateList: _mandates, signatureList: _sigs
        });
        bytes32 _d = _digest(
            _p.acct,
            keccak256(
                abi.encode(
                    keccak256(
                        "MandateIntent(IntentHeader header,bytes32 creditListHash,uint256 bond,bytes32 mandateListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                    ),
                    _hashHeader(_i.header),
                    keccak256(abi.encode(_i.creditList)),
                    _i.bond,
                    keccak256(abi.encode(_i.mandateList))
                )
            )
        );
        hubGate.mandate(_i, _pair(_p, _d), _g);

        address _user = accountModule.userOf(_p.acct);
        assertEq(_user, _p.user, "the genesis rode with the mandate and created the account");
        assertEq(bondStore.bondMap(_p.acct, address(usdc)), 100e6, "the bond landed from the swept route funds");
    }

    function test_flow_a_draw_carrying_genesis_creates_the_master_and_seizes_in_one_transaction() public {
        Party memory _m = _stage("onboarding-genesis-draw");
        AccountLib.Mandate memory _spec = mandateSpec;
        _spec.master = _m.acct;

        AccountLib.Mandate[] memory _mandates = new AccountLib.Mandate[](1);
        _mandates[0] = _spec;
        bytes[] memory _sigs = new bytes[](1);
        _sigs[0] = _sign(alice.signerKey, _mandateDigest(alice.acct, _spec));
        HubGate.MandateIntent memory _bondIntent = HubGate.MandateIntent({
            header: _hdr(alice), creditList: new address[](0), bond: 1000e6, mandateList: _mandates, signatureList: _sigs
        });
        bytes32 _bondDigest = _digest(
            alice.acct,
            keccak256(
                abi.encode(
                    keccak256(
                        "MandateIntent(IntentHeader header,bytes32 creditListHash,uint256 bond,bytes32 mandateListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                    ),
                    _hashHeader(_bondIntent.header),
                    keccak256(abi.encode(_bondIntent.creditList)),
                    _bondIntent.bond,
                    keccak256(abi.encode(_bondIntent.mandateList))
                )
            )
        );
        hubGate.mandate(_bondIntent, _pair(alice, _bondDigest), _noGenesis());

        usdc.mint(_m.acct, FEE);
        AccountLib.Genesis memory _g = _genesisOf(_m);

        HubGate.Loss[] memory _losses = new HubGate.Loss[](1);
        _losses[0] = HubGate.Loss({puppet: alice.acct, amount: 400e6});
        AccountLib.IntentHeader memory _h = _hdr(_m);
        _h.nonce = 1;
        HubGate.DrawIntent memory _i =
            HubGate.DrawIntent({header: _h, spokeChainId: block.chainid, cycle: 1, lossList: _losses});
        hubGate.draw(_i, _pair(_m, _drawDigest(_i)), _g);

        address _user = accountModule.userOf(_m.acct);
        assertEq(_user, _m.user, "the genesis rode with the draw and created the master");
        assertEq(bondStore.bondMap(alice.acct, address(usdc)), 600e6, "the draw seized the loss from the bond");
    }

    function test_session_consent_binds_the_signer_not_the_account_address() public {
        Party memory _p = _stage("session-consent");
        Party memory _other = _stage("session-other");

        vm.signAndAttachDelegation(accountModule.accountImpl(), _p.acctKey);
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), _p.acct, _p.user, _p.signer);
        uint _expiry = block.timestamp + SESSION_TTL;
        bytes32 _session = AccountLib.sessionDigest(address(accountModule), _p.user, _p.signer, _expiry);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        accountModule.createAccount(_p.acct, _p.user, _other.signer, _expiry, _sign(_p.acctKey, _genesis), _sign(_p.userKey, _session));

        accountModule.createAccount(_p.acct, _p.user, _p.signer, _expiry, _sign(_p.acctKey, _genesis), _sign(_p.userKey, _session));
        (, address _user, address _signer) = IAccount(_p.acct).args();
        assertEq(_user, _p.user, "the session bound the account to its wallet");
        assertEq(_signer, _p.signer, "and to the signer the wallet named");
    }

    function test_session_expires_and_refuses_an_unbounded_lifetime() public {
        Party memory _p = _stage("session-expiry");
        vm.signAndAttachDelegation(accountModule.accountImpl(), _p.acctKey);
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), _p.acct, _p.user, _p.signer);

        uint _forever = block.timestamp + 400 days;
        bytes32 _far = AccountLib.sessionDigest(address(accountModule), _p.user, _p.signer, _forever);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__SessionTooLong.selector, _forever, 30 days));
        accountModule.createAccount(_p.acct, _p.user, _p.signer, _forever, _sign(_p.acctKey, _genesis), _sign(_p.userKey, _far));

        uint _expiry = block.timestamp + SESSION_TTL;
        bytes32 _session = AccountLib.sessionDigest(address(accountModule), _p.user, _p.signer, _expiry);
        vm.warp(_expiry + 1);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__SessionExpired.selector, _expiry, block.timestamp));
        accountModule.createAccount(_p.acct, _p.user, _p.signer, _expiry, _sign(_p.acctKey, _genesis), _sign(_p.userKey, _session));
    }

    function test_genesis_never_commits_without_the_signer_it_names() public {
        Party memory _p = _stage("atomic-genesis");
        Party memory _impostor = _stage("atomic-impostor");
        usdc.mint(accountModule.predictDepositRoute(_p.user), 500e6);

        AccountLib.Genesis memory _g = _genesisOf(_p);
        address[] memory _list = new address[](1);
        _list[0] = address(usdc);
        AccountLib.IntentHeader memory _h = _hdr(_p);
        _h.nonce = 1;
        Deposit.ScheduledCredit memory _c = _claim(address(usdc), 1);
        bytes32 _d = _claimDigest(_p.acct, _c);

        bytes memory _wrong = abi.encodePacked(_sign(_impostor.signerKey, _d), _sign(attestorKey, _d));
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        coreGate.credit(_p.acct, _p.user, _c, _wrong, _g);

        assertEq(accountModule.predictDepositRoute(_p.user).code.length, 0, "the route was never cloned");
        (, address _user, address _signer) = IAccount(_p.acct).args();
        assertEq(_user, address(0), "no body was written");
        assertEq(_signer, address(0), "and no signer was recorded");
        assertEq(IAccount(_p.acct).nonce(), 0, "the account nonce never advanced");
    }

    function test_session_digest_matches_the_client() public pure {
        assertEq(
            AccountLib.sessionDigest(
                0xf07BC8c3632524472FdFfA42CFe50881231cd4F1,
                0x1111111111111111111111111111111111111111,
                0x2222222222222222222222222222222222222222,
                1800000000
            ),
            0xabe66bcf42f85fe547f4718093989a8bb16dd425ee3897a37d36e095a968df9b,
            "the prompt the client renders must hash to the digest createAccount verifies"
        );
    }

    function test_a_credit_that_sweeps_nothing_reverts_instead_of_charging_the_fee() public {
        uint _before = usdc.balanceOf(alice.acct);
        assertEq(usdc.balanceOf(accountModule.predictDepositRoute(alice.user)), 0, "the route is empty");
        uint _nonceBefore = IAccount(alice.acct).nonce();
        Deposit.ScheduledCredit memory _c = _claim(address(usdc), 1);
        bytes32 _d = _claimDigest(alice.acct, _c);
        vm.expectRevert(abi.encodeWithSelector(Error.Schedule__NotArrived.selector, address(usdc), 0, 1));
        coreGate.credit(alice.acct, alice.user, _c, _pair(alice, _d), _noGenesis());
        assertEq(usdc.balanceOf(alice.acct), _before, "no relay fee was taken");
        assertEq(IAccount(alice.acct).nonce(), _nonceBefore, "and no nonce was consumed");
    }

    function test_a_credit_fee_is_bounded_by_what_actually_arrives() public {
        usdc.mint(accountModule.predictDepositRoute(alice.user), 4e6);
        Deposit.ScheduledCredit memory _c = _claim(address(usdc), 1);
        bytes memory _sig = _pair(alice, _claimDigest(alice.acct, _c));
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, FEE, 4e6, 2000));
        coreGate.credit(alice.acct, alice.user, _c, _sig, _noGenesis());
    }

    function test_flow_crosschain_deposit_bridges_from_the_route_and_credits_nothing_locally() public {
        MockBridge _bridge = new MockBridge();
        address _route = accountModule.predictDepositRoute(alice.user);
        usdc.mint(_route, 500e6);
        uint _accountBefore = usdc.balanceOf(alice.acct);
        uint _feeBefore = usdc.balanceOf(feeReceiver);

        (Deposit.DepositSwap memory _i, bytes32 _d) = _bridgeIntent(_hdr(alice), _bridge, 500e6);
        coreGate.depositAcross(_i, _pair(alice, _d), _noGenesis());

        assertEq(_bridge.bridged(), 500e6 - FEE, "the bridge took the input net of the relay fee");
        assertEq(_bridge.destinationChainId(), 42_161, "the bridge was told the signed destination");
        assertEq(_bridge.recipient(), _route, "the destination recipient is the route, the same address on every chain");
        assertEq(usdc.balanceOf(_route), 0, "the route spent the whole input");
        assertEq(
            usdc.balanceOf(alice.acct), _accountBefore, "nothing is credited locally; the credit happens on arrival"
        );
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore + FEE, "the relay fee was paid on the source chain");
        assertEq(usdc.allowance(_route, address(_bridge)), 0, "the route revoked the bridge allowance");
    }

    function test_flow_onboarding_crosschain_is_a_plain_transfer_then_a_swap_carrying_genesis() public {
        Party memory _p = _stage("onboarding-crosschain");
        address _route = accountModule.predictDepositRoute(_p.user);
        MockBridge _bridge = new MockBridge();

        usdc.mint(_p.user, 500e6);
        vm.prank(_p.user);
        usdc.transfer(_route, 500e6);
        assertEq(_p.acct.code.length, 0, "the route was funded before the account existed");

        AccountLib.Genesis memory _g = _genesisOf(_p);
        AccountLib.IntentHeader memory _h = _hdr(_p);
        _h.nonce = 1;
        (Deposit.DepositSwap memory _i, bytes32 _d) = _bridgeIntent(_h, _bridge, 500e6);
        coreGate.depositAcross(_i, _pair(_p, _d), _g);

        address _user = accountModule.userOf(_p.acct);
        assertEq(_user, _p.user, "the genesis rode with the swap and created the account");
        assertEq(_bridge.bridged(), 500e6 - FEE, "the prefunded route paid the bridge");
        assertEq(_bridge.recipient(), _route, "the bridge delivers to the route on the destination");
        assertEq(usdc.balanceOf(_route), 0, "the route spent everything it was funded with");
        assertEq(usdc.balanceOf(_p.acct), 0, "the wallet never routed through the account on this chain");
    }

    function test_flow_a_local_swap_parks_on_the_route_then_a_credit_moves_it() public {
        MockERC20 _out = _providerDeposit(500e6, 480e6, 480e6);
        address _route = accountModule.predictDepositRoute(alice.user);
        assertEq(_out.balanceOf(_route), 480e6, "the swap output parks on the route");
        assertEq(_out.balanceOf(alice.acct), 0, "a swap never credits the account by itself");

        _creditToken(alice, address(_out));

        assertEq(_out.balanceOf(_route), 0, "the credit swept the parked output");
        assertEq(_out.balanceOf(alice.acct), 480e6 - FEE, "the account now holds the swapped token net of the credit fee");
    }

    function test_flow_crosschain_swap_is_credited_on_arrival_by_its_claim_once() public {
        MockBridge _bridge = new MockBridge();
        address _route = accountModule.predictDepositRoute(alice.user);
        usdc.mint(_route, 500e6);
        uint _accountBefore = usdc.balanceOf(alice.acct);
        uint _feeBefore = usdc.balanceOf(feeReceiver);

        (Deposit.DepositSwap memory _i, bytes32 _d) = _bridgeIntent(_hdr(alice), _bridge, 500e6);
        coreGate.depositAcross(_i, _pair(alice, _d), _noGenesis());
        assertEq(usdc.balanceOf(_route), 0, "the source route was spent into the bridge");

        vm.chainId(42_161);
        Deposit.ScheduledCredit memory _c = _claim(address(usdc), 500e6 - FEE);
        bytes32 _cd = _claimDigest(alice.acct, _c);
        bytes memory _sig = _pair(alice, _cd);
        vm.expectRevert(abi.encodeWithSelector(Error.Schedule__NotArrived.selector, address(usdc), 0, 500e6 - FEE));
        coreGate.credit(alice.acct, alice.user, _c, _sig, _noGenesis());

        usdc.mint(_route, 500e6 - FEE);
        Deposit.ScheduledCredit memory _greedy =
            Deposit.ScheduledCredit({token: _c.token, amount: _c.amount, expiry: _c.expiry, fee: 2 * FEE});
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        coreGate.credit(alice.acct, alice.user, _greedy, _sig, _noGenesis());

        coreGate.credit(alice.acct, alice.user, _c, _sig, _noGenesis());
        assertEq(usdc.balanceOf(alice.acct), _accountBefore + 500e6 - 2 * FEE, "the fill is credited net of the agreed fee");
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore + 2 * FEE, "each half paid only its agreed fee");
        assertEq(usdc.balanceOf(_route), 0, "the destination route is swept");

        usdc.mint(_route, 500e6);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__DigestConsumed.selector, _cd));
        coreGate.credit(alice.acct, alice.user, _c, _sig, _noGenesis());
    }

    function test_a_claim_is_bound_to_the_chain_it_was_signed_for() public {
        usdc.mint(accountModule.predictDepositRoute(alice.user), 300e6);
        Deposit.ScheduledCredit memory _c = _claim(address(usdc), 1);
        bytes memory _sig = _pair(alice, _claimDigest(alice.acct, _c));

        vm.chainId(2);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        coreGate.credit(alice.acct, alice.user, _c, _sig, _noGenesis());
    }

    function test_a_credit_claims_a_fused_arrival_in_the_form_the_claim_names() public {
        address _route = accountModule.predictDepositRoute(alice.user);
        uint _fee = 1e16;

        vm.deal(_route, 4e18);
        uint _wrappedBefore = wnt.balanceOf(alice.acct);
        Deposit.ScheduledCredit memory _wrapped = Deposit.ScheduledCredit({
            token: address(wnt), amount: 1, expiry: block.timestamp + 1 hours, fee: _fee
        });
        coreGate.credit(alice.acct, alice.user, _wrapped, _pair(alice, _claimDigest(alice.acct, _wrapped)), _noGenesis());
        assertEq(wnt.balanceOf(alice.acct), _wrappedBefore + 4e18 - _fee, "native that landed on the route was wrapped into the claimed form");
        assertEq(_route.balance, 0, "the route holds no native");

        wnt.deposit{value: 3e18}();
        wnt.transfer(_route, 3e18);
        uint _nativeBefore = alice.acct.balance;
        Deposit.ScheduledCredit memory _native = Deposit.ScheduledCredit({
            token: NATIVE_TOKEN, amount: 1, expiry: block.timestamp + 1 hours, fee: _fee
        });
        coreGate.credit(alice.acct, alice.user, _native, _pair(alice, _claimDigest(alice.acct, _native)), _noGenesis());
        assertEq(alice.acct.balance, _nativeBefore + 3e18 - _fee, "wrapped that landed on the route was unwrapped into the claimed form");
        assertEq(wnt.balanceOf(_route), 0, "the route holds no wrapped");
    }

    function test_a_swap_spends_route_funds_only_and_never_reaches_into_the_wallet() public {
        MockBridge _bridge = new MockBridge();
        usdc.mint(alice.user, 500e6);
        vm.prank(alice.user);
        usdc.approve(address(depositModule), 500e6);

        (Deposit.DepositSwap memory _i, bytes32 _d) = _bridgeIntent(_hdr(alice), _bridge, 500e6);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 500e6));
        coreGate.depositAcross(_i, _pair(alice, _d), _noGenesis());

        assertEq(usdc.balanceOf(alice.user), 500e6, "an allowance to the module buys a swap nothing");
    }

    function test_a_crosschain_swap_funds_from_the_route_in_the_form_it_holds() public {
        MockBridge _bridge = new MockBridge();
        address _route = accountModule.predictDepositRoute(alice.user);
        vm.deal(_route, 4e18);

        AccountLib.IntentHeader memory _h = _hdr(alice);
        _h.fee = 1e16;
        (Deposit.DepositSwap memory _i, bytes32 _d) = _signedSwap(
            _h,
            SwapLib.SwapParams({
                inputToken: address(wnt),
                inputAmount: 4e18,
                outputToken: address(wnt),
                outputAmount: 4e18 - 1e16,
                provider: address(_bridge),
                providerCallData: abi.encodeCall(MockBridge.send, (address(wnt), 4e18 - 1e16, 42_161, _route))
            }),
            42_161
        );
        coreGate.depositAcross(_i, _pair(alice, _d), _noGenesis());

        assertEq(_bridge.bridged(), 4e18 - 1e16, "the route's native was wrapped on the way into the bridge");
        assertEq(_route.balance, 0, "the native holding was fully consumed");
        assertEq(wnt.balanceOf(_route), 0, "and nothing wrapped was left behind");
        assertEq(wnt.balanceOf(feeReceiver), 1e16, "the relay fee was paid in the wrapped form");
    }

    function test_a_native_swap_spends_the_route_wrapped_first_then_native() public {
        MockERC20 _out = new MockERC20("USDT", "USDT", 6);
        MockSwapProvider _provider = new MockSwapProvider();
        vm.prank(owner);
        register.setRegistered(address(_out), type(uint).max, bytes32("USDT"));
        address _route = accountModule.predictDepositRoute(alice.user);
        wnt.deposit{value: 3e18}();
        wnt.transfer(_route, 3e18);
        vm.deal(_route, 3e18);
        _out.mint(address(_provider), 480e6);

        (Deposit.DepositSwap memory _i, bytes32 _d) = _signedSwap(
            _hdr(alice),
            SwapLib.SwapParams({
                inputToken: NATIVE_TOKEN,
                inputAmount: 4e18,
                outputToken: address(_out),
                outputAmount: 480e6,
                provider: address(_provider),
                providerCallData: abi.encodeCall(MockSwapProvider.swapNative, (address(_out), 480e6, _route))
            }),
            block.chainid
        );
        coreGate.depositAcross(_i, _pair(alice, _d), _noGenesis());

        assertEq(wnt.balanceOf(_route), 0, "the wrapped holding was spent first");
        assertEq(_route.balance, 2e18, "native covered only the remainder");
        assertEq(_out.balanceOf(_route), 480e6, "the swap output parks on the route");
        assertEq(feeReceiver.balance, FEE, "the relay fee was paid in native");
    }

    function test_forced_withdrawal_reaches_funds_stranded_at_the_route() public {
        address _route = accountModule.predictDepositRoute(alice.user);
        usdc.mint(_route, 700e6);

        vm.warp(block.timestamp + RESET_PERIOD + 1);
        vm.prank(alice.user);
        accountModule.forcedWithdrawal(alice.acct, address(usdc), 100e6, alice.user);

        assertEq(usdc.balanceOf(_route), 0, "the route was emptied by the escape");
        assertEq(usdc.balanceOf(alice.user), 800e6, "route funds and account funds both reached the user");
        assertEq(usdc.balanceOf(alice.acct), 1200e6 - 100e6, "the account paid only what was asked");
    }

    function _providerDeposit(
        uint _in,
        uint _declared,
        uint _delivered
    ) internal returns (MockERC20 out_) {
        out_ = new MockERC20("USDT", "USDT", 6);
        MockSwapProvider _provider = new MockSwapProvider();
        vm.prank(owner);
        register.setRegistered(address(out_), type(uint).max, bytes32("USDT"));

        address _route = accountModule.predictDepositRoute(alice.user);
        usdc.mint(_route, _in);
        out_.mint(address(_provider), _delivered);

        (Deposit.DepositSwap memory _i, bytes32 _d) = _signedSwap(
            _hdr(alice),
            SwapLib.SwapParams({
                inputToken: address(usdc),
                inputAmount: _in,
                outputToken: address(out_),
                outputAmount: _declared,
                provider: address(_provider),
                providerCallData: abi.encodeCall(
                    MockSwapProvider.swap, (address(usdc), _in - FEE, address(out_), _delivered, _route)
                )
            }),
            block.chainid
        );
        coreGate.depositAcross(_i, _pair(alice, _d), _noGenesis());
    }

    function test_a_swap_parks_its_output_on_the_route_for_the_user_to_direct() public {
        address _route = accountModule.predictDepositRoute(alice.user);
        MockERC20 _out = _providerDeposit(500e6, 480e6, 480e6);

        assertEq(_out.balanceOf(alice.acct), 0, "a swap does not credit the account by itself");
        assertEq(_out.balanceOf(_route), 480e6, "the swap output parks on the route");
        assertEq(usdc.balanceOf(_route), 0, "the route spent the whole input");
        assertEq(usdc.balanceOf(feeReceiver), FEE, "the relay fee was paid from the route");
    }

    function test_an_under_delivering_provider_is_caught_even_when_route_surplus_covers_it() public {
        MockERC20 _out = new MockERC20("USDT", "USDT", 6);
        MockSwapProvider _provider = new MockSwapProvider();
        vm.prank(owner);
        register.setRegistered(address(_out), type(uint).max, bytes32("USDT"));

        address _route = accountModule.predictDepositRoute(alice.user);
        usdc.mint(_route, 500e6);
        _out.mint(address(_provider), 400e6);
        _out.mint(_route, 100e6);

        (Deposit.DepositSwap memory _i, bytes32 _d) = _signedSwap(
            _hdr(alice),
            SwapLib.SwapParams({
                inputToken: address(usdc),
                inputAmount: 500e6,
                outputToken: address(_out),
                outputAmount: 480e6,
                provider: address(_provider),
                providerCallData: abi.encodeCall(
                    MockSwapProvider.swap, (address(usdc), 500e6 - FEE, address(_out), 400e6, _route)
                )
            }),
            block.chainid
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__DepositNotReceived.selector, address(_out), 400e6, 480e6));
        coreGate.depositAcross(_i, _pair(alice, _d), _noGenesis());
    }

    function _creditToken(
        Party memory _p,
        address _token
    ) internal {
        Deposit.ScheduledCredit memory _c = _claim(_token, 1);
        coreGate.credit(_p.acct, _p.user, _c, _pair(_p, _claimDigest(_p.acct, _c)), _noGenesis());
    }

    function _credit(
        Party memory _p,
        uint _amount
    ) internal {
        usdc.mint(accountModule.predictDepositRoute(_p.user), _amount);
        _creditToken(_p, address(usdc));
    }

    function _withdrawAll(
        Party memory _p
    ) internal {
        uint _held = usdc.balanceOf(_p.acct);
        if (_held <= FEE) return;
        CoreGate.WithdrawIntent memory _i = CoreGate.WithdrawIntent({
            header: _hdr(_p),
            swap: SwapLib.SwapParams({
                inputToken: address(usdc),
                inputAmount: _held,
                outputToken: address(usdc),
                outputAmount: _held - FEE,
                provider: address(0),
                providerCallData: ""
            }),
            destinationChainId: block.chainid
        });
        bytes32 _d = _digest(
            _p.acct,
            keccak256(
                abi.encode(
                    keccak256(
                        "WithdrawIntent(IntentHeader header,SwapParams swap,uint256 destinationChainId)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)SwapParams(address inputToken,uint256 inputAmount,address outputToken,uint256 outputAmount,address provider,bytes providerCallData)"
                    ),
                    _hashHeader(_i.header),
                    _hashSwap(_i.swap),
                    _i.destinationChainId
                )
            )
        );
        coreGate.withdraw(_i, _pair(_p, _d));
    }

    function _operate(
        uint _cycle,
        uint _stake
    ) internal {
        (Party memory _lo, Party memory _hi) = _sorted(alice, bob);
        AccountLib.Mandate memory _m = mandateSpec;
        AccountLib.Backing[] memory _rows = new AccountLib.Backing[](2);
        _rows[0] = _row(_lo, _m, _stake);
        _rows[1] = _row(_hi, _m, _stake);

        CoreGate.OperateIntent memory _i = CoreGate.OperateIntent({
            header: _hdr(master),
            creditList: new address[](0),
            cycle: _cycle,
            token: address(usdc),
            value: 0,
            collateral: 1000e6,
            skin: 5000,
            backed: 0,
            backingList: _rows,
            callList: new IAccount.Call[](0)
        });
        bytes32 _d = _digest(
            master.acct,
            keccak256(
                abi.encode(
                    keccak256(
                        "OperateIntent(IntentHeader header,bytes32 creditListHash,uint256 cycle,address token,uint256 value,uint256 collateral,uint256 skin,uint256 backed,bytes32 backingListHash,bytes32 callListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                    ),
                    _hashHeader(_i.header),
                    keccak256(abi.encode(_i.creditList)),
                    _i.cycle,
                    _i.token,
                    _i.value,
                    _i.collateral,
                    _i.skin,
                    _i.backed,
                    keccak256(abi.encode(_i.backingList)),
                    keccak256(abi.encode(_i.callList))
                )
            )
        );
        coreGate.operate(_i, _pair(master, _d));
    }

    function _settle(
        uint _cycle,
        uint _gain
    ) internal {
        (Party memory _lo, Party memory _hi) = _sorted(alice, bob);
        AccountLib.Mandate memory _m = mandateSpec;
        CoreGate.Outcome[] memory _gains = new CoreGate.Outcome[](2);
        _gains[0] = CoreGate.Outcome({
            puppet: _lo.acct, amount: _gain, mandate: _m});
        _gains[1] = CoreGate.Outcome({
            puppet: _hi.acct, amount: _gain, mandate: _m});

        CoreGate.SettleIntent memory _i = CoreGate.SettleIntent({
            header: _hdr(master), cycle: _cycle, token: address(usdc), value: 0, gainList: _gains
        });
        bytes32 _d = _digest(
            master.acct,
            keccak256(
                abi.encode(
                    keccak256(
                        "SettleIntent(IntentHeader header,uint256 cycle,address token,uint256 value,bytes32 gainListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                    ),
                    _hashHeader(_i.header),
                    _i.cycle,
                    _i.token,
                    _i.value,
                    keccak256(abi.encode(_i.gainList))
                )
            )
        );
        coreGate.settle(_i, _pair(master, _d));
    }

    function _draw(
        uint _cycle,
        uint _loss
    ) internal {
        HubGate.DrawIntent memory _i = _drawIntent(_cycle, _loss);
        hubGate.draw(_i, _pair(master, _drawDigest(_i)), _noGenesis());
    }

    function _drawIntent(
        uint _cycle,
        uint _loss
    ) internal view returns (HubGate.DrawIntent memory) {
        (Party memory _lo, Party memory _hi) = _sorted(alice, bob);
        HubGate.Loss[] memory _losses = new HubGate.Loss[](2);
        _losses[0] = HubGate.Loss({puppet: _lo.acct, amount: _loss});
        _losses[1] = HubGate.Loss({puppet: _hi.acct, amount: _loss});
        return HubGate.DrawIntent({header: _hdr(master), spokeChainId: block.chainid, cycle: _cycle, lossList: _losses});
    }

    function _drawDigest(
        HubGate.DrawIntent memory _i
    ) internal view returns (bytes32) {
        return _digest(
            _i.header.account,
            keccak256(
                abi.encode(
                    keccak256(
                        "DrawIntent(IntentHeader header,uint256 spokeChainId,uint256 cycle,bytes32 lossListHash)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                    ),
                    _hashHeader(_i.header),
                    _i.spokeChainId,
                    _i.cycle,
                    keccak256(abi.encode(_i.lossList))
                )
            )
        );
    }

    function _unbond(
        Party memory _p,
        uint _amount
    ) internal {
        HubGate.UnbondIntent memory _i = HubGate.UnbondIntent({header: _hdr(_p), amount: _amount});
        bytes32 _d = _digest(
            _p.acct,
            keccak256(
                abi.encode(
                    keccak256(
                        "UnbondIntent(IntentHeader header,uint256 amount)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                    ),
                    _hashHeader(_i.header),
                    _i.amount
                )
            )
        );
        hubGate.unbond(_i, _pair(_p, _d));
    }

    function test_draw_is_clamped_to_the_bond_and_never_more() public {
        _bond(alice, 1000e6);
        _bond(bob, 1000e6);
        _operate(1, 250e6);

        _draw(1, 1400e6);

        assertEq(bondStore.bondMap(alice.acct, address(usdc)), 0, "a loss beyond the bond seizes the bond, not more");
        assertEq(bondStore.bondMap(bob.acct, address(usdc)), 0, "same for bob");
        assertEq(usdc.balanceOf(address(bondStore)), 0, "custody matches the drained ledger");
    }

    function test_a_route_is_keyed_to_the_user_and_only_their_account_can_spend_it() public {
        address _aliceRoute = accountModule.predictDepositRoute(alice.user);
        assertEq(_aliceRoute, accountModule.predictDepositRoute(alice.user), "the route is a pure function of the user");
        assertTrue(_aliceRoute != accountModule.predictDepositRoute(bob.user), "each user gets their own route");

        usdc.mint(_aliceRoute, 100e6);
        IAccount.Call[] memory _steal = new IAccount.Call[](1);
        _steal[0] = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: GAS,
            callData: abi.encodeWithSignature("transfer(address,uint256)", bob.acct, 100e6)
        });

        vm.prank(bob.acct);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        DepositRoute(payable(_aliceRoute)).execute(_steal);

        vm.prank(alice.acct);
        DepositRoute(payable(_aliceRoute)).execute(_steal);
        assertEq(usdc.balanceOf(_aliceRoute), 0, "alice's own account can spend her route");
    }

    function test_a_prefunded_route_has_no_code_until_the_account_is_created() public {
        (address _fresh,) = makeAddrAndKey("funds-before-onboarding");
        address _route = accountModule.predictDepositRoute(_fresh);

        usdc.mint(_fresh, 250e6);
        vm.prank(_fresh);
        usdc.transfer(_route, 250e6);

        assertEq(usdc.balanceOf(_route), 250e6, "the route holds value");
        assertEq(_route.code.length, 0, "and has no code until createAccount clones it");

        assertGt(accountModule.predictDepositRoute(alice.user).code.length, 0, "an onboarded user's route is deployed");
    }

    function test_a_cycle_can_only_be_drawn_once() public {
        _bond(alice, 1000e6);
        _bond(bob, 1000e6);
        _operate(1, 250e6);

        _draw(1, 100e6);
        assertEq(bondStore.bondMap(alice.acct, address(usdc)), 900e6, "the first draw seizes the loss");

        HubGate.DrawIntent memory _i = _drawIntent(1, 100e6);
        bytes memory _sig = _pair(master, _drawDigest(_i));
        vm.expectRevert(
            abi.encodeWithSelector(Error.Bond__CycleAlreadyDrawn.selector, master.acct, block.chainid, uint(1))
        );
        hubGate.draw(_i, _sig, _noGenesis());

        assertEq(bondStore.bondMap(alice.acct, address(usdc)), 900e6, "a replayed draw seizes nothing more");
        assertEq(bondStore.bondMap(bob.acct, address(usdc)), 900e6, "same for bob");
    }

    function test_rebroadcasting_a_mandate_cannot_repudiate_an_incurred_loss() public {
        _bond(alice, 1000e6);
        _bond(bob, 1000e6);
        _operate(1, 250e6);

        bytes32[] memory _ids = new bytes32[](1);
        _ids[0] = register.tokenIdMap(address(usdc));
        mandateSpec = AccountLib.Mandate({
            master: master.acct,
            skin: 0,
            allocationRate: 0,
            cooldownPeriod: 0,
            expiry: block.timestamp + 365 days,
            tokenIdList: _ids
        });
        _bond(alice, 0);
        _bond(bob, 0);

        _draw(1, 400e6);

        assertEq(bondStore.bondMap(alice.acct, address(usdc)), 600e6, "a zeroed mandate does not shrink the loss");
        assertEq(bondStore.bondMap(bob.acct, address(usdc)), 600e6, "same for bob");
    }

    function test_full_lifecycle_every_participant_exits() public {
        uint _minted = 3000e6 + 1200e6 + 1200e6;

        _deposit(alice, 200e6);
        _minted += 200e6;
        _credit(alice, 100e6);
        _minted += 100e6;

        _bond(alice, 1000e6);
        _bond(bob, 1000e6);
        assertEq(bondStore.bondMap(alice.acct, address(usdc)), 1000e6, "alice bonded");
        assertEq(bondStore.bondMap(bob.acct, address(usdc)), 1000e6, "bob bonded");
        assertEq(usdc.balanceOf(address(bondStore)), 2000e6, "bond custody");

        _operate(1, 250e6);
        _settle(1, 100e6);

        _operate(2, 250e6);
        _draw(2, 50e6);
        assertEq(bondStore.bondMap(alice.acct, address(usdc)), 950e6, "alice bond drawn");
        assertEq(bondStore.bondMap(bob.acct, address(usdc)), 950e6, "bob bond drawn");

        _unbond(alice, 950e6);
        _unbond(bob, 950e6);
        assertEq(usdc.balanceOf(address(bondStore)), 0, "bond store fully drained");

        _withdrawAll(master);
        _withdrawAll(alice);
        _withdrawAll(bob);

        assertEq(usdc.balanceOf(master.acct), 0, "master account drained");
        assertEq(usdc.balanceOf(alice.acct), 0, "alice account drained");
        assertEq(usdc.balanceOf(bob.acct), 0, "bob account drained");
        assertGt(usdc.balanceOf(master.user), 0, "master exited to wallet");
        assertGt(usdc.balanceOf(alice.user), 0, "alice exited to wallet");
        assertGt(usdc.balanceOf(bob.user), 0, "bob exited to wallet");

        assertEq(
            usdc.balanceOf(master.user) + usdc.balanceOf(alice.user) + usdc.balanceOf(bob.user)
                + usdc.balanceOf(feeReceiver),
            _minted,
            "value conserved: every minted unit is in a wallet or the fee receiver"
        );
    }
}
