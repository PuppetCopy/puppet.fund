// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {GateConfig} from "src/utils/GateConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/src/Test.sol";

import {
    ALLOCATE_INTENT_TYPEHASH,
    CREDIT_TYPEHASH,
    HubGate,
    MANDATE_INTENT_TYPEHASH,
    PRICE_TYPEHASH,
    REDEEM_INTENT_TYPEHASH,
    SELL_INTENT_TYPEHASH,
    VALUATION_TYPEHASH
} from "src/HubGate.sol";
import {
    FULFIL_TYPEHASH,
    OPERATE_INTENT_TYPEHASH,
    SpokeGate
} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Deposit} from "src/core/Deposit.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {EvmChain} from "src/core/EvmChain.sol";
import {Dictate} from "src/core/Dictate.sol";
import {Fund} from "src/core/Fund.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {FundStore} from "src/core/FundStore.sol";
import {MandateStore} from "src/core/MandateStore.sol";
import {Register} from "src/core/Register.sol";
import {Share} from "src/core/Share.sol";
import {Error} from "src/utils/Error.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {LiquidityGate} from "src/utils/LiquidityGate.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";
import {IWNT} from "src/utils/interfaces/IWNT.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";

import {SwapLib, SWAP_PARAMS_TYPEHASH} from "src/utils/SwapLib.sol";
import {
    DEPOSIT_ACROSS_INTENT_TYPEHASH,
    ESCROW_INTENT_TYPEHASH,
    FUND_SWAP_INTENT_TYPEHASH,
    WITHDRAW_INTENT_TYPEHASH
} from "src/utils/LiquidityGate.sol";

import {LibClone} from "solady/utils/LibClone.sol";

import {MockERC20} from "./mock/MockERC20.t.sol";
import {MockSwapProvider} from "./mock/MockSwapProvider.t.sol";
import {MockTarget} from "./mock/MockTarget.t.sol";
import {MockWNT} from "./mock/MockWNT.t.sol";

contract HotPathTest is Test {
    uint constant HUB_CHAIN = 10;
    uint constant FEE = 1e6;
    uint constant USD = 1e24;
    uint constant FOREIGN_CHAIN_ID = 42161;
    uint constant WITHDRAW_DELAY = 600;

    address owner = makeAddr("owner");
    address feeReceiver = makeAddr("feeReceiver");
    address attestor;
    uint attestorKey;

    MockERC20 usdc;
    Dictate dictate;
    Register register;
    AccountModule accountModule;
    Deposit depositModule;
    MandateStore mandateStore;
    FundStore fundStore;
    EscrowStore escrowStore;
    EscrowStore spokeEscrowStore;
    Fund fundModule;
    HubGate hub;
    SpokeGate spoke;
    MockERC20 outToken;
    MockSwapProvider swapProvider;

    address master;
    uint masterKey;
    address body;
    uint bodyKey;
    address backer;
    uint backerKey;
    Share share;

    function setUp() public {
        vm.chainId(HUB_CHAIN);
        (attestor, attestorKey) = makeAddrAndKey("attestor");
        (master, masterKey) = makeAddrAndKey("master");
        (body, bodyKey) = makeAddrAndKey("body");
        (backer, backerKey) = makeAddrAndKey("backer");

        vm.startPrank(owner);
        usdc = new MockERC20("USDC", "USDC", 6);
        MockWNT _wnt = new MockWNT();
        dictate = new Dictate(owner);
        register = new Register(address(dictate));
        fundStore = new FundStore(address(dictate));
        accountModule = new AccountModule(
            address(dictate), new EvmChain(), address(new UserAccount()), address(new FundAccount()), WITHDRAW_DELAY
        );
        depositModule = Deposit(
            payable(
                dictate.setGate(
                    bytes32("Deposit"),
                    address(new Deposit(address(dictate), accountModule, register, IWNT(address(_wnt))))
                )
            )
        );
        mandateStore = new MandateStore(address(dictate));
        escrowStore = new EscrowStore(address(dictate));
        spokeEscrowStore = new EscrowStore(address(dictate));

        address _fundProxy = dictate.setGate(bytes32("Fund"), address(fundStore));
        address _shareImpl = address(new Share(_fundProxy));
        dictate.setGate(
            bytes32("Fund"),
            address(
                new Fund(
                    address(dictate),
                    accountModule,
                    mandateStore,
                    fundStore,
                    escrowStore,
                    register,
                    _shareImpl
                )
            )
        );
        fundModule = Fund(_fundProxy);

        address _gate = dictate.setGate(
            bytes32("HubGate"),
            address(
                new HubGate(
                    accountModule,
                    register,
                    depositModule,
                    mandateStore,
                    fundModule,
                    escrowStore,
                    GateConfig({
                        attestor: attestor,
                        feeReceiver: feeReceiver,
                        transferGasLimit: 200_000,
                        maxIntentTtl: 600,
                        maxRelayFeeBps: 1000
                    }),
                    50,
                    1000
                )
            )
        );
        hub = HubGate(_gate);

        address _spokeGate = dictate.setGate(
            bytes32("SpokeGate"),
            address(
                new SpokeGate(
                    accountModule,
                    register,
                    depositModule,
                    spokeEscrowStore,
                    GateConfig({
                        attestor: attestor,
                        feeReceiver: feeReceiver,
                        transferGasLimit: 200_000,
                        maxIntentTtl: 600,
                        maxRelayFeeBps: 1000
                    })
                )
            )
        );
        spoke = SpokeGate(_spokeGate);

        outToken = new MockERC20("OUT", "OUT", 18);
        swapProvider = new MockSwapProvider();
        dictate.setAccess(register, owner);
        register.setRegistered(address(usdc), bytes32("USDC"));
        register.setRegistered(address(outToken), bytes32("OUT"));
        register.setRegistered(NATIVE_TOKEN, bytes32("ETH"));
        dictate.removeAccess(register, owner);
        dictate.setAccess(accountModule, address(depositModule));
        dictate.setAccess(accountModule, _gate);
        dictate.setAccess(accountModule, _fundProxy);
        dictate.setAccess(depositModule, _gate);
        dictate.setAccess(mandateStore, _gate);
        dictate.setAccess(fundStore, _fundProxy);
        dictate.setAccess(fundStore, _gate);
        dictate.setAccess(escrowStore, _gate);
        dictate.setAccess(escrowStore, _fundProxy);
        dictate.setAccess(fundModule, _gate);
        dictate.setAccess(accountModule, _spokeGate);
        dictate.setAccess(depositModule, _spokeGate);
        dictate.setAccess(spokeEscrowStore, _spokeGate);
        vm.stopPrank();

        outToken.mint(address(swapProvider), 1_000_000e18);
        vm.signAndAttachDelegation(accountModule.bodyImpl(), bodyKey);
        vm.warp(1_700_000_000);
    }

    function _account(
        address _user
    ) internal returns (address) {
        return accountModule.createUserAccount(_user);
    }

    function _fundWallet(
        address _user,
        uint _amount
    ) internal {
        usdc.mint(_user, _amount);
        vm.startPrank(_user);
        IERC20(address(usdc)).approve(address(depositModule), _amount);
        hub.deposit(address(usdc), _amount);
        vm.stopPrank();
    }

    function _nonceOf(
        address _acct
    ) internal view returns (uint) {
        return UserAccount(payable(_acct)).nonce();
    }

    function _header(
        address _acct,
        address _user,
        uint _nonce
    ) internal view returns (AccountLib.IntentHeader memory) {
        return AccountLib.IntentHeader({
            account: _acct,
            user: _user,
            nonce: _nonce,
            deadline: block.timestamp + 300,
            feeToken: address(usdc),
            fee: FEE
        });
    }

    function _fundHeader(
        uint _nonce
    ) internal view returns (AccountLib.IntentHeader memory header_) {
        header_ = _header(body, master, _nonce);
        header_.feeToken = address(0);
        header_.fee = FEE * USD;
    }

    function _coSig(
        uint _key,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        (uint8 _v, bytes32 _r, bytes32 _s) = vm.sign(_key, _digest);
        return abi.encodePacked(_r, _s, _v);
    }

    function _pair(
        uint _key,
        bytes32 _digest
    ) internal view returns (bytes memory) {
        return bytes.concat(_coSig(_key, _digest), _coSig(attestorKey, _digest));
    }

    function _typed(
        address _acct,
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return AccountLib.intentDigest(_acct, _acct.code.length == 0 ? 0 : IAccount(_acct).nonce(), _structHash);
    }

    function _valuation(
        uint _value
    ) internal view returns (Fund.Valuation memory valuation_) {
        valuation_.value = _value * USD;
        valuation_.assetList = new Fund.Asset[](2);
        valuation_.assetList[0] = Fund.Asset({chainId: 10, token: address(usdc), amount: 1_200e6});
        valuation_.assetList[1] = Fund.Asset({chainId: 42161, token: address(usdc), amount: 800e6});
        valuation_.positionList = new Fund.Position[](2);
        valuation_.positionList[0] =
            Fund.Position({chainId: 42161, venue: bytes32("GMX"), id: keccak256("position-a"), valueInUsd: 450e30});
        valuation_.positionList[1] =
            Fund.Position({chainId: 42161, venue: bytes32("GMX"), id: keccak256("position-b"), valueInUsd: 275e30});
    }

    function _valuationHash(
        Fund.Valuation memory _v
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                VALUATION_TYPEHASH,
                _v.value,
                keccak256(abi.encode(_v.assetList)),
                keccak256(abi.encode(_v.positionList))
            )
        );
    }

    function _allocateIntent(
        uint _nonce,
        uint _value,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        return _allocateIntent(_nonce, _value, Fund.Credit({chainId: 0, token: address(0), amount: 0}), _rows);
    }

    function _credit(
        uint _chainId,
        address _token,
        uint _amount
    ) internal pure returns (Fund.Credit memory) {
        return Fund.Credit({chainId: _chainId, token: _token, amount: _amount});
    }

    function _allocateIntent(
        uint _nonce,
        uint _value,
        Fund.Credit memory _credits,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        return _allocateIntent(
            _nonce, _value, Fund.Price({token: address(usdc), amount: 1e6, value: 1e6 * USD}), _credits, _rows
        );
    }

    function _allocateIntent(
        uint _nonce,
        uint _value,
        Fund.Price memory _price,
        Fund.Credit memory _credits,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        intent_ = Fund.AllocateIntent({
            header: _fundHeader(_nonce),
            share: share,
            valuation: _valuation(_value),
            price: _price,
            credit: _credits,
            allocationList: _rows
        });
        coSig_ = _pair(masterKey, _allocateDigest(intent_));
    }

    function _allocateDigest(
        Fund.AllocateIntent memory _i
    ) internal view returns (bytes32) {
        return _typed(body, _allocateStructHash(_i));
    }

    function _allocateStructHash(
        Fund.AllocateIntent memory _i
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ALLOCATE_INTENT_TYPEHASH,
                _hashHeader(_i.header),
                _i.share,
                _valuationHash(_i.valuation),
                keccak256(abi.encode(PRICE_TYPEHASH, _i.price.token, _i.price.amount, _i.price.value)),
                keccak256(abi.encode(CREDIT_TYPEHASH, _i.credit.chainId, _i.credit.token, _i.credit.amount)),
                keccak256(abi.encode(_i.allocationList))
            )
        );
    }

    function test_hot_path_open_fund_back_it_sell_and_claim() public {
        address _masterAccount = accountModule.predictUserAccount(master);
        assertEq(_masterAccount.code.length, 0, "the wallet has no account before it funds one");
        _fundWallet(master, 2000e6);
        assertGt(_masterAccount.code.length, 0, "the first deposit creates the wallet's account");
        assertEq(usdc.balanceOf(_masterAccount), 2000e6, "and lands in it");
        _fundWallet(backer, 1000e6);

        // the master escrows his own capital before the fund exists
        bytes32 _symbol = bytes32("PUP");
        bytes memory _pixels = new bytes(154);
        for (uint _p; _p < _pixels.length; ++_p) {
            _pixels[_p] = bytes1(uint8(_p < 33 ? 1 + (_p * 37) % 255 : 1 + _p % 10));
        }
        share = Share(
            address(
                uint160(
                    uint(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                address(hub),
                                bytes32(uint(uint160(body))),
                                keccak256(_cloneCode(fundModule.shareImpl(), abi.encodePacked(_symbol, _pixels, uint16(1000))))
                            )
                        )
                    )
                )
            )
        );

        _escrow(LiquidityGate(address(hub)), address(usdc), 500e6);
        assertEq(escrowStore.escrowedMap(_masterAccount, body, address(usdc)), 500e6, "the escrow ledger holds the master capital");
        assertEq(usdc.balanceOf(address(escrowStore)), 500e6, "and the store holds the tokens");

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis =
            AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);

        vm.expectRevert(Error.Account__AlreadyCreated.selector);
        hub.createFund(bytes32("PUP2"), _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);

        assertEq(share.symbol(), "PUP", "the share carries the fund symbol");
        assertEq(share.performanceFee(), 1000, "the share carries the fund fee");
        assertGt(share.balanceOf(body), 0, "the opening round mints for the master");
        assertEq(usdc.balanceOf(body), 500e6 - FEE, "escrow landed in the fund net of the fee");

        // a backer mandates the fund and joins the next round
        AccountLib.Mandate memory _m = AccountLib.Mandate({
            master: body,
            skin: 0,
            allocationRate: 5000,
            cooldownPeriod: 0,
            expiry: block.timestamp + 365 days
        });
        AccountLib.Mandate[] memory _one = new AccountLib.Mandate[](1);
        _one[0] = _m;
        _mandate(backer, backerKey, _one);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = Fund.Allocation({puppet: _account(backer), mandate: _m, amount: 400e6});
        (Fund.AllocateIntent memory _i2, bytes memory _sig2) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        hub.allocate(_i2, _sig2);
        uint _backerUnits = share.balanceOf(_account(backer));
        assertGt(_backerUnits, 0, "the backer holds units after the round");
        assertEq(usdc.balanceOf(body), 500e6 - FEE + 400e6 - FEE, "the stake landed in the fund net of the round fee");

        // a second round with no cohort, and a two-row mandate, so per-row gas is measured at two list sizes
        _escrow(LiquidityGate(address(hub)), address(usdc), 100e6);
        (Fund.AllocateIntent memory _i3, bytes memory _sig3) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        hub.allocate(_i3, _sig3);
        _cohortRound(_one, 3, 3);
        _cohortRound(_one, 4, 3);

        _mandate(backer, backerKey, _freshMandates(11, 2));
        _mandate(backer, backerKey, _freshMandates(21, 4));

        // the backer queues an exit, the master drains it, the backer collects
        _sell(backer, backerKey, _backerUnits);
        assertEq(share.balanceOf(address(fundStore)), _backerUnits, "sold units wait in the queue");
        uint _before = usdc.balanceOf(_account(backer));
        uint _ownerBefore = usdc.balanceOf(_account(master));
        usdc.mint(body, 45e6);
        _redeem(0, _backerUnits);
        hub.claim(body, share, _account(backer));
        assertGt(usdc.balanceOf(_account(backer)), _before, "the backer is paid out");
        assertGt(usdc.balanceOf(_account(master)), _ownerBefore, "a profitable exit pays the owner its performance fee");
        assertEq(share.balanceOf(address(fundStore)), 0, "the queue is empty again");
        _proRataExits();

        _spokeRound();
        _walletFundsEscrowDirectly();
        _withdrawWindow();
        _gridRendersItsOwnColours();
        _swapRound(LiquidityGate(address(hub)), "hub");
        _swapRound(LiquidityGate(address(spoke)), "spoke");
        _escrowStaysCommitted();
    }

    function _escrowStaysCommitted() internal {
        usdc.mint(master, 30e6);
        vm.startPrank(master);
        IERC20(address(usdc)).approve(address(depositModule), 30e6);
        hub.depositEscrow(body, address(usdc), 30e6);
        vm.expectRevert(Error.Escrow__RefundClosed.selector);
        hub.refund(body, address(usdc), 30e6);
        vm.stopPrank();

        vm.prank(backer);
        vm.expectRevert();
        hub.refund(body, address(usdc), 1e6);
    }

    function _proRataExits() internal {
        (address _first, uint _firstKey) = makeAddrAndKey("cohort-0");
        (address _second, uint _secondKey) = makeAddrAndKey("cohort-1");
        uint _firstUnits = share.balanceOf(_account(_first)) / 2;
        _sell(_first, _firstKey, _firstUnits);
        _redeem(0, _firstUnits / 2);
        _sell(_second, _secondKey, share.balanceOf(_account(_second)) / 2);
        uint _firstBefore = usdc.balanceOf(_account(_first));
        uint _secondBefore = usdc.balanceOf(_account(_second));
        _redeem(0, share.balanceOf(address(fundStore)));
        hub.claim(body, share, _account(_first));
        hub.claim(body, share, _account(_second));
        assertGt(usdc.balanceOf(_account(_first)), _firstBefore, "the earlier seller is paid across both drains");
        assertGt(usdc.balanceOf(_account(_second)), _secondBefore, "the later seller is paid from the drain it joined");
        assertEq(share.balanceOf(address(fundStore)), 0, "both exits drained");
    }

    function _walletFundsEscrowDirectly() internal {
        vm.deal(master, 1 ether);
        vm.prank(master);
        hub.depositEscrow{value: 1 ether}(body, NATIVE_TOKEN, 1 ether);
        assertEq(escrowStore.escrowedMap(_account(master), body, NATIVE_TOKEN), 1 ether, "the wallet escrows native straight into the store");

        uint _bodyBefore = body.balance;
        uint _feeBefore = feeReceiver.balance;
        uint _unitsBefore = share.balanceOf(body);
        Fund.Price memory _eth = Fund.Price({token: NATIVE_TOKEN, amount: 1 ether, value: 3000e6 * USD});
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _eth, _credit(block.chainid, NATIVE_TOKEN, 1 ether), new Fund.Allocation[](0)
        );
        hub.allocate(_i, _sig);
        uint _billed = (FEE * 1 ether + 3000e6 - 1) / 3000e6;
        assertGt(share.balanceOf(body), _unitsBefore, "a round credits a token other than the bond at its signed value");
        assertEq(feeReceiver.balance, _feeBefore + _billed, "the master slice is paid in the credited token");
        assertEq(body.balance, _bodyBefore + 1 ether - _billed, "and the rest lands in the body");

        (_i, _sig) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _eth, _credit(block.chainid, NATIVE_TOKEN, 1 ether), new Fund.Allocation[](0)
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 1 ether, 2 ether));
        hub.allocate(_i, _sig);

        usdc.mint(backer, 1e6);
        vm.startPrank(backer);
        IERC20(address(usdc)).approve(address(depositModule), 1e6);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
        hub.depositEscrow(body, address(usdc), 1e6);
        vm.stopPrank();
    }

    function _withdrawWindow() internal {
        UserAccount _ua = UserAccount(payable(_account(backer)));
        uint _walletBefore = usdc.balanceOf(backer);
        vm.startPrank(backer);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawNotOpen.selector, 0, WITHDRAW_DELAY));
        _ua.withdraw(address(usdc), 1e6, 200_000);
        _ua.requestWithdraw();
        uint _requestedAt = vm.getBlockTimestamp();
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawNotOpen.selector, _requestedAt, WITHDRAW_DELAY));
        _ua.withdraw(address(usdc), 1e6, 200_000);
        vm.warp(_requestedAt + WITHDRAW_DELAY);
        _ua.withdraw(address(usdc), 1e6, 200_000);
        assertEq(usdc.balanceOf(backer), _walletBefore + 1e6, "a requested withdrawal pays the wallet once the module delay has passed");
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawNotOpen.selector, 0, WITHDRAW_DELAY));
        _ua.withdraw(address(usdc), 1e6, 200_000);
        vm.stopPrank();
    }

    function _gridRendersItsOwnColours() internal {
        bytes memory _a = new bytes(154);
        bytes memory _b = new bytes(154);
        _a[0] = 0xE8;
        _a[1] = 0x46;
        _a[2] = 0x7C;
        _b[0] = 0x00;
        _b[1] = 0xFF;
        _b[2] = 0x00;

        address _impl = fundModule.shareImpl();
        Share _shareA = Share(LibClone.cloneDeterministic(_impl, abi.encodePacked(bytes32("AAA"), _a), bytes32(uint(901))));
        Share _shareB = Share(LibClone.cloneDeterministic(_impl, abi.encodePacked(bytes32("AAA"), _b), bytes32(uint(902))));

        assertEq(_shareA.pixels(), _a, "the clone returns exactly the grid it was created with");
        assertTrue(
            keccak256(bytes(_shareA.tokenURI())) != keccak256(bytes(_shareB.tokenURI())),
            "one differing cell must change the render, or the grid is not what tokenURI draws"
        );

        bytes memory _short = new bytes(153);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(0, 0, new Fund.Allocation[](0));
        vm.expectRevert(abi.encodeWithSelector(Error.Share__InvalidGrid.selector, 153));
        hub.createFund(bytes32("BAD"), _short, "", "", _i, _sig);
    }

    function _swapRound(
        LiquidityGate _gate,
        string memory _tag
    ) internal {
        (address _user, uint _key) = makeAddrAndKey(string.concat("swapper-", _tag));
        _fundWallet(_user, 4000e6);
        address _acct = _account(_user);

        _depositAcross(_gate, _user, _key, _acct, 1000e6);
        assertGt(outToken.balanceOf(_acct), 0, "depositAcross delivered the output");

        Deposit.SwapIntent memory _userSwap = Deposit.SwapIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            swap: _swapParams(_acct, 1000e6),
            destinationChainId: block.chainid
        });
        bytes memory _userSig = _swapSig(FUND_SWAP_INTENT_TYPEHASH, _key, _acct, _userSwap);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NotDelegated.selector, _acct));
        _gate.fundSwap(_userSwap, _userSig, AccountLib.Genesis({parent: address(0), key: "", approval: ""}));

        usdc.mint(body, 1000e6);
        uint _outBefore = outToken.balanceOf(body);
        _fundSwapCall(_gate, master, masterKey, body, 1000e6);
        assertGt(outToken.balanceOf(body), _outBefore, "fundSwap moved the fund body's own holdings");

        uint _userBefore = outToken.balanceOf(_user);
        _withdrawSwap(_gate, _user, _key, _acct, 1000e6);
        assertGt(outToken.balanceOf(_user), _userBefore, "withdraw with a provider delivered the output");

        uint _plainBefore = usdc.balanceOf(_user);
        _withdrawPlain(_gate, _user, _key, _acct, 500e6);
        assertEq(usdc.balanceOf(_user), _plainBefore + 500e6 - FEE, "withdraw without a provider paid the user");
    }

    function _swapParams(
        address _recipient,
        uint _amount
    ) internal view returns (SwapLib.SwapParams memory) {
        return SwapLib.SwapParams({
            inputToken: address(usdc),
            inputAmount: _amount,
            outputToken: address(outToken),
            outputAmount: 1e18,
            provider: address(swapProvider),
            providerCallData: abi.encodeCall(
                MockSwapProvider.swap, (address(usdc), _amount - FEE, address(outToken), 1e18, _recipient)
            )
        });
    }

    function _hashSwap(
        SwapLib.SwapParams memory _s
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SWAP_PARAMS_TYPEHASH,
                _s.inputToken,
                _s.inputAmount,
                _s.outputToken,
                _s.outputAmount,
                _s.provider,
                keccak256(_s.providerCallData)
            )
        );
    }

    function _swapSig(
        bytes32 _typehash,
        uint _key,
        address _acct,
        Deposit.SwapIntent memory _i
    ) internal view returns (bytes memory) {
        return _pair(
            _key,
            _typed(
                _acct,
                keccak256(
                    abi.encode(_typehash, _hashHeader(_i.header), _i.destinationChainId, _hashSwap(_i.swap))
                )
            )
        );
    }

    function _depositAcross(
        LiquidityGate _gate,
        address _user,
        uint _key,
        address _acct,
        uint _amount
    ) internal {
        Deposit.SwapIntent memory _i = Deposit.SwapIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            swap: _swapParams(_acct, _amount),
            destinationChainId: block.chainid
        });
        _gate.depositAcross(
            _i,
            _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, _key, _acct, _i));
    }

    function _fundSwapCall(
        LiquidityGate _gate,
        address _user,
        uint _key,
        address _acct,
        uint _amount
    ) internal {
        Deposit.SwapIntent memory _i = Deposit.SwapIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            swap: _swapParams(_acct, _amount),
            destinationChainId: block.chainid
        });
        _gate.fundSwap(
            _i,
            _swapSig(FUND_SWAP_INTENT_TYPEHASH, _key, _acct, _i),
            AccountLib.Genesis({parent: _account(_user), key: "", approval: ""})
        );
    }

    function _withdrawSwap(
        LiquidityGate _gate,
        address _user,
        uint _key,
        address _acct,
        uint _amount
    ) internal {
        Deposit.SwapIntent memory _i = Deposit.SwapIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            swap: _swapParams(_user, _amount),
            destinationChainId: block.chainid
        });
        _gate.withdraw(
            _i,
            _swapSig(WITHDRAW_INTENT_TYPEHASH, _key, _acct, _i));
    }

    function _withdrawPlain(
        LiquidityGate _gate,
        address _user,
        uint _key,
        address _acct,
        uint _amount
    ) internal {
        Deposit.SwapIntent memory _i = Deposit.SwapIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            swap: SwapLib.SwapParams({
                inputToken: address(usdc),
                inputAmount: _amount,
                outputToken: address(usdc),
                outputAmount: _amount - FEE,
                provider: address(0),
                providerCallData: ""
            }),
            destinationChainId: block.chainid
        });
        _gate.withdraw(
            _i,
            _swapSig(WITHDRAW_INTENT_TYPEHASH, _key, _acct, _i));
    }

    function _spokeRound() internal {
        address _parent = _account(master);
        usdc.mint(master, 200e6);
        vm.startPrank(master);
        IERC20(address(usdc)).approve(address(depositModule), 200e6);
        spoke.depositEscrow(body, address(usdc), 200e6);
        vm.stopPrank();
        assertEq(spokeEscrowStore.escrowedMap(_parent, body, address(usdc)), 200e6, "the wallet escrows on the spoke in one call");

        uint _bodyBefore = usdc.balanceOf(body);
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        uint _unitsBefore = share.balanceOf(body);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body), _bodyBefore, _credit(FOREIGN_CHAIN_ID, address(usdc), 200e6), new Fund.Allocation[](0)
        );
        bytes32 _round = _allocateDigest(_i);
        hub.allocate(_i, _sig);
        assertGt(share.balanceOf(body), _unitsBefore, "the hub round credits escrow that sits on another chain");
        assertEq(fundStore.creditedMap(body, FOREIGN_CHAIN_ID, address(usdc)), 200e6, "the hub remembers what it credited there");
        assertEq(usdc.balanceOf(body), _bodyBefore, "nothing of the fund moves on the hub");
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore, "and the hub bills no fee the fund could not pay there");

        bytes memory _over = _fulfilSignature(_parent, address(usdc), _round, 0, 201e6, FEE);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 0, 201e6));
        spoke.fulfil(_parent, body, address(usdc), _round, 0, 201e6, FEE, _over);

        _fulfil(address(usdc), _round, 200e6, FEE);
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 200e6, "the fulfil total meets the credited total of the round it names");
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore + FEE, "the round fee is billed where the capital sits");
        assertEq(usdc.balanceOf(body), _bodyBefore + 200e6 - FEE, "the escrow lands in the body net of that fee");

        bytes memory _replay = _fulfilSignature(_parent, address(usdc), _round, 0, 200e6, FEE);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 200e6, 200e6));
        spoke.fulfil(_parent, body, address(usdc), _round, 0, 200e6, FEE, _replay);

        _escrow(LiquidityGate(address(spoke)), address(usdc), 100e6);
        assertEq(spokeEscrowStore.escrowedMap(_parent, body, address(usdc)), 300e6, "a relayed escrow adds account funds to the same ledger");

        address _venue = makeAddr("venue");
        IAccount.Call[] memory _callList = new IAccount.Call[](1);
        _callList[0] = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: 200_000,
            callData: abi.encodeCall(IERC20.transfer, (_venue, 50e6))
        });
        _operate(_callList);
        assertEq(usdc.balanceOf(_venue), 50e6, "the body traded through operate");

        address _venue2 = makeAddr("venue2");
        IAccount.Call[] memory _pair2 = new IAccount.Call[](2);
        _pair2[0] = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: 200_000,
            callData: abi.encodeCall(IERC20.transfer, (_venue2, 10e6))
        });
        _pair2[1] = IAccount.Call({
            target: address(new MockTarget()),
            value: 0,
            gasLimit: 200_000,
            callData: abi.encodeCall(MockTarget.ping, ())
        });
        _operate(_pair2);
        assertEq(usdc.balanceOf(_venue2), 10e6, "a multi-call operate runs every leg");
    }

    function _escrow(
        LiquidityGate _gate,
        address _token,
        uint _amount
    ) internal {
        address _acct = _account(master);
        LiquidityGate.EscrowIntent memory _i = LiquidityGate.EscrowIntent({
            header: _header(_acct, master, _nonceOf(_acct)),
            master: body,
            token: _token,
            amount: _amount
        });
        _gate.escrow(
            _i,
            _pair(
                masterKey,
                _typed(
                    _acct,
                    keccak256(abi.encode(ESCROW_INTENT_TYPEHASH, _hashHeader(_i.header), _i.master, _i.token, _i.amount))
                )
            )
        );
    }

    function _fulfilSignature(
        address _parent,
        address _token,
        bytes32 _round,
        uint _from,
        uint _total,
        uint _fee
    ) internal view returns (bytes memory) {
        return _coSig(
            attestorKey,
            AccountLib.typedDigest(
                block.chainid,
                body,
                keccak256(
                    abi.encode(FULFIL_TYPEHASH, address(spokeEscrowStore), _parent, _token, _round, _from, _total, _fee)
                )
            )
        );
    }

    function _fulfil(
        address _token,
        bytes32 _round,
        uint _total,
        uint _fee
    ) internal {
        address _parent = _account(master);
        uint _from = spokeEscrowStore.fulfilledMap(_parent, body, _token);
        spoke.fulfil(
            _parent, body, _token, _round, _from, _total, _fee, _fulfilSignature(_parent, _token, _round, _from, _total, _fee)
        );
    }

    function _operate(
        IAccount.Call[] memory _callList
    ) internal {
        SpokeGate.OperateIntent memory _i = SpokeGate.OperateIntent({
            header: _header(body, master, _nonceOf(body)), callList: _callList, tokenList: new address[](0)
        });
        spoke.operate(
            _i,
            _pair(
                masterKey,
                _typed(
                    body,
                    keccak256(
                        abi.encode(
                            OPERATE_INTENT_TYPEHASH,
                            _hashHeader(_i.header),
                            keccak256(abi.encode(_callList)),
                            keccak256(abi.encodePacked(_i.tokenList))
                        )
                    )
                )
            ),
            AccountLib.Genesis({parent: _account(master), key: "", approval: ""})
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

    function digestOf(
        address _puppet,
        AccountLib.Mandate calldata _m
    ) external pure returns (bytes32) {
        return AccountLib.mandateDigest(_puppet, _m);
    }

    function _cohortRound(
        AccountLib.Mandate[] memory _one,
        uint _count,
        uint _oversizedFrom
    ) internal {
        Fund.Allocation[] memory _rows = new Fund.Allocation[](_count);
        for (uint _j; _j < _count; ++_j) {
            (address _user, uint _key) = makeAddrAndKey(string.concat("cohort-", vm.toString(_j)));
            _fundWallet(_user, 1000e6);
            _mandate(_user, _key, _one);
            address _acct = _account(_user);
            uint _k = _j;
            while (_k > 0 && uint160(_rows[_k - 1].puppet) > uint160(_acct)) {
                _rows[_k] = _rows[_k - 1];
                --_k;
            }
            uint _stake = _j < _oversizedFrom ? 100e6 : 5_000e6;
            _rows[_k] = Fund.Allocation({puppet: _acct, mandate: _one[0], amount: _stake});
        }
        uint[] memory _held = new uint[](_count);
        for (uint _j; _j < _count; ++_j) {
            _held[_j] = share.balanceOf(_rows[_j].puppet);
        }
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        hub.allocate(_i, _sig);
        for (uint _j; _j < _count; ++_j) {
            if (_rows[_j].amount == 100e6) {
                assertGt(share.balanceOf(_rows[_j].puppet), _held[_j], "a row inside its cap is minted");
            } else {
                assertEq(share.balanceOf(_rows[_j].puppet), _held[_j], "a row over its cap is skipped, the round survives");
            }
        }
    }

    function _freshMandates(
        uint _from,
        uint _count
    ) internal view returns (AccountLib.Mandate[] memory list_) {
        list_ = new AccountLib.Mandate[](_count);
        for (uint _j; _j < _count; ++_j) {
            list_[_j] = AccountLib.Mandate({
                master: address(uint160(_from + _j)),
                skin: 0,
                allocationRate: 5000,
                cooldownPeriod: 0,
                expiry: block.timestamp + 365 days
            });
        }
    }

    function _mandate(
        address _user,
        uint _key,
        AccountLib.Mandate[] memory _list
    ) internal {
        address _acct = _account(_user);
        bytes[] memory _sigs = new bytes[](_list.length);
        for (uint _j; _j < _list.length; ++_j) {
            _sigs[_j] = _coSig(_key, this.digestOf(_acct, _list[_j]));
        }
        address[] memory _tokens = new address[](1);
        _tokens[0] = address(usdc);
        HubGate.MandateIntent memory _i = HubGate.MandateIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            mandateList: _list,
            signatureList: _sigs,
            tokenList: _tokens,
            arm: true
        });
        hub.mandate(
            _i,
            _pair(
                _key,
                _typed(
                    _acct,
                    keccak256(
                        abi.encode(
                            MANDATE_INTENT_TYPEHASH,
                            _hashHeader(_i.header),
                            keccak256(abi.encode(_list)),
                            keccak256(abi.encodePacked(_tokens)),
                            _i.arm
                        )
                    )
                )
            )
        );
    }

    function _sell(
        address _user,
        uint _key,
        uint _units
    ) internal {
        address _acct = _account(_user);
        Fund.SellIntent memory _i =
            Fund.SellIntent({header: _header(_acct, _user, _nonceOf(_acct)), share: share, master: body, units: _units});
        hub.sell(
            _i,
            _pair(
                _key,
                _typed(
                    _acct,
                    keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(_i.header), _i.master, _i.share, _i.units))
                )
            )
        );
    }

    function _redeem(
        uint _retire,
        uint _drain
    ) internal {
        Fund.RedeemIntent memory _i = Fund.RedeemIntent({
            header: _fundHeader(_nonceOf(body)),
            share: share,
            valuation: _valuation(usdc.balanceOf(body)),
            retire: _retire,
            drain: _drain,
            price: Fund.Price({token: address(usdc), amount: 1e6, value: 1e6 * USD})
        });
        hub.redeem(
            _i,
            _pair(
                masterKey,
                _typed(
                    body,
                    keccak256(
                        abi.encode(
                            REDEEM_INTENT_TYPEHASH,
                            _hashHeader(_i.header),
                            _i.share,
                            _valuationHash(_i.valuation),
                            keccak256(abi.encode(PRICE_TYPEHASH, _i.price.token, _i.price.amount, _i.price.value)),
                            _i.retire,
                            _i.drain
                        )
                    )
                )
            )
        );
    }

    function _cloneCode(
        address _impl,
        bytes memory _args
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            hex"61", uint16(_args.length + 0x2d), hex"3d81600a3d39f3363d3d373d3d3d363d73", _impl, hex"5af43d82803e903d91602b57fd5bf3", _args
        );
    }
}
