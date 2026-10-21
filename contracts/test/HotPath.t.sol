// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {GateConfig} from "src/utils/GateConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Test} from "forge-std/src/Test.sol";

import {
    HubGate,
    ALLOCATE_INTENT_TYPEHASH,
    ASSET_TYPEHASH,
    CREDIT_TYPEHASH,
    MANDATE_INTENT_TYPEHASH,
    MAX_SKIN,
    POSITION_TYPEHASH,
    PRICE_TYPEHASH,
    REDEEM_INTENT_TYPEHASH,
    SELL_INTENT_TYPEHASH,
    VALUATION_TYPEHASH
} from "src/HubGate.sol";
import {CALL_TYPEHASH, OPERATE_INTENT_TYPEHASH, SpokeGate} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Deposit} from "src/core/Deposit.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {EvmChain} from "src/core/EvmChain.sol";
import {Fund, PRICE_PRECISION} from "src/core/Fund.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {FundStore, isOpen} from "src/core/FundStore.sol";
import {GovernorAccount} from "src/core/GovernorAccount.sol";
import {MandateStore} from "src/core/MandateStore.sol";
import {Redeem} from "src/core/Redeem.sol";
import {GRID_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {Error} from "src/utils/Error.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {MandateLib} from "src/utils/MandateLib.sol";
import {LiquidityGate, RETIRE_ESCROW_INTENT_TYPEHASH} from "src/utils/LiquidityGate.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";
import {RouterProxy} from "src/utils/RouterProxy.sol";
import {FULL_ACCESS} from "src/utils/auth/Access.sol";
import {IWNT} from "src/utils/interfaces/IWNT.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";

import {SwapLib, SWAP_PARAMS_TYPEHASH} from "src/utils/SwapLib.sol";
import {
    DEPOSIT_ACROSS_INTENT_TYPEHASH,
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
    uint constant USD = 1e12;
    string constant ATTESTOR_ENDPOINT = "https://puppet.fund/api";
    uint constant FOREIGN_CHAIN_ID = 42_161;
    uint constant ETH_USD = 1e6;
    uint constant PERFORMANCE_FEE = 1000;
    uint constant PROTOCOL_FEE_SHARE = 1000;
    bytes32 constant WEBSITE_RELEASE = keccak256("the website release governance approved");

    address owner = makeAddr("owner");
    address governor = makeAddr("governor");
    address feeReceiver = makeAddr("feeReceiver");
    address protocolReceiver = makeAddr("protocolReceiver");
    address attestor;
    uint attestorKey;

    MockERC20 usdc;
    MockWNT wnt;
    GovernorAccount governorAccount;
    AccountModule accountModule;
    Deposit depositModule;
    FundStore fundStore;
    MandateStore mandateStore;
    EscrowStore hubEscrowStore;
    EscrowStore spokeEscrowStore;
    Fund fundModule;
    Redeem redeemModule;
    HubGate hub;
    SpokeGate spoke;
    MockERC20 outToken;
    MockSwapProvider swapProvider;

    address master;
    uint masterKey;
    address body;
    mapping(address puppet => mapping(address master => MandateLib.Mandate)) mandateLog;
    uint bodyKey;
    address backer;
    uint backerKey;
    ShareToken shareToken;

    function setUp() public {
        vm.chainId(HUB_CHAIN);
        (attestor, attestorKey) = makeAddrAndKey("attestor");
        (master, masterKey) = makeAddrAndKey("master");
        (body, bodyKey) = makeAddrAndKey("body");
        (backer, backerKey) = makeAddrAndKey("backer");

        vm.startPrank(owner);
        usdc = new MockERC20("USDC", "USDC", 6);
        wnt = new MockWNT();
        governorAccount = new GovernorAccount(governor);
        fundStore = new FundStore(address(governorAccount));
        mandateStore = new MandateStore(address(governorAccount));
        accountModule = new AccountModule(
            address(governorAccount), new EvmChain(), address(new UserAccount()), address(new FundAccount())
        );
        hubEscrowStore = new EscrowStore(address(governorAccount), accountModule, 1000);
        spokeEscrowStore = new EscrowStore(address(governorAccount), accountModule, 1000);
        outToken = new MockERC20("OUT", "OUT", 18);
        swapProvider = new MockSwapProvider();
        depositModule = Deposit(payable(address(new RouterProxy(address(governorAccount)))));
        fundModule = Fund(address(new RouterProxy(address(governorAccount))));
        redeemModule = Redeem(address(new RouterProxy(address(governorAccount))));
        hub = HubGate(address(new RouterProxy(address(governorAccount))));
        spoke = SpokeGate(address(new RouterProxy(address(governorAccount))));
        vm.stopPrank();

        vm.startPrank(address(governorAccount));
        RouterProxy(payable(address(depositModule)))
            .upgrade(address(new Deposit(address(governorAccount), accountModule, IWNT(address(wnt)))));
        RouterProxy(payable(address(fundModule)))
            .upgrade(
                address(
                    new Fund(
                        address(governorAccount),
                        accountModule,
                        mandateStore,
                        fundStore,
                        hubEscrowStore,
                        address(new ShareToken(address(redeemModule))),
                        address(wnt)
                    )
                )
            );
        RouterProxy(payable(address(redeemModule)))
            .upgrade(
                address(
                    new Redeem(
                        address(governorAccount),
                        accountModule,
                        fundStore,
                        address(wnt),
                        PROTOCOL_FEE_SHARE,
                        protocolReceiver
                    )
                )
            );

        GateConfig memory _config = GateConfig({
            attestor: attestor,
            feeReceiver: feeReceiver,
            transferGasLimit: 200_000,
            maxIntentTtl: 600,
            maxRelayFeeBps: 1000,
            maxSwapRelayFeeBps: 3333
        });
        RouterProxy(payable(address(hub)))
            .upgrade(
                address(
                    new HubGate(
                        accountModule,
                        depositModule,
                        hubEscrowStore,
                        fundModule,
                        redeemModule,
                        _config,
                        _endpoints(ATTESTOR_ENDPOINT),
                        _list(address(usdc), address(wnt)),
                        100,
                        PERFORMANCE_FEE,
                        WEBSITE_RELEASE
                    )
                )
            );
        RouterProxy(payable(address(spoke)))
            .upgrade(address(new SpokeGate(accountModule, depositModule, spokeEscrowStore, _config)));

        accountModule.setAccess(address(hub), FULL_ACCESS);
        depositModule.setAccess(address(hub), FULL_ACCESS);
        hubEscrowStore.setAccess(address(hub), FULL_ACCESS);
        mandateStore.setAccess(address(hub), MandateStore.setMandate.selector);
        fundModule.setAccess(address(hub), Fund.allocate.selector);
        redeemModule.setAccess(address(hub), FULL_ACCESS);
        accountModule.setAccess(address(spoke), FULL_ACCESS);
        depositModule.setAccess(address(spoke), FULL_ACCESS);
        spokeEscrowStore.setAccess(address(spoke), FULL_ACCESS);
        accountModule.setAccess(address(depositModule), AccountModule.dispatch.selector);
        accountModule.setAccess(address(fundModule), FULL_ACCESS);
        fundStore.setAccess(address(fundModule), FULL_ACCESS);
        hubEscrowStore.setAccess(address(fundModule), EscrowStore.release.selector);
        accountModule.setAccess(address(redeemModule), FULL_ACCESS);
        fundStore.setAccess(address(redeemModule), FULL_ACCESS);
        vm.stopPrank();

        outToken.mint(address(swapProvider), 1_000_000e18);
        vm.signAndAttachDelegation(accountModule.bodyImpl(), bodyKey);
        vm.warp(1_700_000_000);
    }

    function _account(
        address _user
    ) internal returns (address account_) {
        account_ = accountModule.predictUserAccount(_user);
        if (account_.code.length == 0) {
            vm.prank(_user);
            accountModule.createUserAccount(_user);
        }
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

    function _queuedOf(
        address _holder
    ) internal view returns (uint) {
        return fundStore.getHolding(body, _holder).queued;
    }

    function _nav() internal view returns (uint) {
        return usdc.balanceOf(body) + Math.mulDiv(wnt.balanceOf(body), ETH_USD, 1e18);
    }

    function _wethTo(
        address _to,
        uint _amount
    ) internal {
        vm.deal(address(this), _amount);
        wnt.deposit{value: _amount}();
        wnt.transfer(_to, _amount);
    }

    function _endpoints(
        string memory _endpoint
    ) internal pure returns (string[] memory list_) {
        list_ = new string[](1);
        list_[0] = _endpoint;
    }

    function _list(
        address _a
    ) internal pure returns (address[] memory list_) {
        list_ = new address[](1);
        list_[0] = _a;
    }

    function _list(
        address _a,
        address _b
    ) internal pure returns (address[] memory list_) {
        list_ = new address[](2);
        list_[0] = _a;
        list_[1] = _b;
    }

    function _ownerAccount() internal view returns (address) {
        return accountModule.predictUserAccount(master);
    }

    function _nonceOf(
        address _acct
    ) internal view returns (uint) {
        return UserAccount(payable(_acct)).nonce();
    }

    function _epochAfterRevoke(
        uint _epoch
    ) internal view returns (uint) {
        return uint(
            keccak256(abi.encode(_epoch, blockhash(vm.getBlockNumber() - 1), block.prevrandao, vm.getBlockTimestamp()))
        );
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
        header_.feeToken = address(wnt);
        header_.fee = FEE * USD;
    }

    function _coSig(
        uint _key,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        (uint8 _v, bytes32 _r, bytes32 _s) = vm.sign(_key, _digest);
        return abi.encodePacked(_r, _s, _v);
    }

    function _fundApproval(
        uint _userKey,
        address _fund
    ) internal view returns (bytes memory) {
        address _user = vm.addr(_userKey);
        address _signer = vm.addr(_userKey + 1);
        uint _expiry = block.timestamp + 7 days;
        return abi.encode(
            _signer,
            block.timestamp,
            _expiry,
            uint(0),
            _coSig(
                _userKey,
                AccountLib.sessionDigest(address(accountModule), _user, _signer, block.timestamp, _expiry, 0, _fund)
            )
        );
    }

    function _pair(
        uint _key,
        bytes32 _digest
    ) internal view returns (bytes memory) {
        return bytes.concat(_coSig(_key, _digest), _coSig(attestorKey, _digest));
    }

    function _typed(
        address _acct,
        uint _deadline,
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return
            AccountLib.intentDigest(_acct, _acct.code.length == 0 ? 0 : IAccount(_acct).nonce(), _deadline, _structHash);
    }

    function _valuation(
        uint _value
    ) internal view returns (Fund.Valuation memory valuation_) {
        uint _total = _value * USD;
        valuation_.assetList = new Fund.Asset[](2);
        valuation_.assetList[0] = _usdcAsset(10, 1200e6);
        valuation_.assetList[0].value = _total / 2;
        valuation_.assetList[1] = _usdcAsset(42_161, 800e6);
        valuation_.positionList = new Fund.Position[](2);
        valuation_.positionList[0] = Fund.Position({
            chainId: 42_161, venue: bytes32("GMX"), id: keccak256("position-a"), value: _total - _total / 2
        });
        valuation_.positionList[1] =
            Fund.Position({chainId: 42_161, venue: bytes32("GMX"), id: keccak256("position-b"), value: 0});
    }

    function _valueOf(
        Fund.Valuation memory _v
    ) internal pure returns (uint value_) {
        for (uint _i; _i < _v.assetList.length; ++_i) {
            value_ += _v.assetList[_i].value;
        }
        for (uint _i; _i < _v.positionList.length; ++_i) {
            value_ += _v.positionList[_i].value;
        }
    }

    function _usdcAsset(
        uint _chainId,
        uint _amount
    ) internal view returns (Fund.Asset memory asset_) {
        asset_.chainId = _chainId;
        asset_.token = address(usdc);
        asset_.amount = _amount;
    }

    function _valuationHash(
        Fund.Valuation memory _v
    ) internal pure returns (bytes32) {
        bytes32[] memory _assetHashList = new bytes32[](_v.assetList.length);
        for (uint _i; _i < _assetHashList.length; ++_i) {
            _assetHashList[_i] = keccak256(abi.encode(ASSET_TYPEHASH, _v.assetList[_i]));
        }
        bytes32[] memory _positionHashList = new bytes32[](_v.positionList.length);
        for (uint _i; _i < _positionHashList.length; ++_i) {
            _positionHashList[_i] = keccak256(abi.encode(POSITION_TYPEHASH, _v.positionList[_i]));
        }
        return keccak256(
            abi.encode(
                VALUATION_TYPEHASH,
                keccak256(abi.encodePacked(_assetHashList)),
                keccak256(abi.encodePacked(_positionHashList))
            )
        );
    }

    function _allocateIntent(
        uint _nonce,
        uint _value,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        return
            _allocateIntent(_nonce, _value, Fund.Credit({chainId: 0, token: address(0), total: 0, feeTotal: 0}), _rows);
    }

    function _credit(
        uint _chainId,
        address _token,
        uint _amount
    ) internal pure returns (Fund.Credit memory) {
        return Fund.Credit({chainId: _chainId, token: _token, total: _amount, feeTotal: 0});
    }

    function _allocateIntent(
        uint _nonce,
        uint _value,
        Fund.Credit memory _credits,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        return
            _allocateIntent(_nonce, _value, address(usdc), Fund.Price({amount: 1e6, value: 1e6 * USD}), _credits, _rows);
    }

    function _allocateIntent(
        uint _nonce,
        uint _value,
        address _token,
        Fund.Price memory _price,
        Fund.Credit memory _credits,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        intent_.header = _fundHeader(_nonce);
        intent_.shareToken = shareToken;
        intent_.valuation = _valuation(_value);
        intent_.token = _token;
        intent_.price = _price;
        if (_credits.total > 0) {
            address _owner = accountModule.predictUserAccount(master);
            FundStore.Credit memory _prev = _credits.chainId == block.chainid
                ? FundStore.Credit({
                    total: hubEscrowStore.fulfilledMap(_owner, body, _credits.token),
                    feeTotal: hubEscrowStore.feePaidMap(_owner, body, _credits.token)
                })
                : fundStore.getCredit(body, _credits.chainId, _credits.token);
            uint _slice = intent_.header.fee / (_rows.length + 1);
            _credits.total = _prev.total + _credits.total;
            _credits.feeTotal = _prev.feeTotal + Math.mulDiv(_slice, _price.amount, _price.value);
        }
        intent_.credit = _credits;
        intent_.allocationList = _rows;
        coSig_ = _pair(masterKey, _allocateDigest(intent_));
    }

    function _allocateDigest(
        Fund.AllocateIntent memory _i
    ) internal view returns (bytes32) {
        return _typed(body, _i.header.deadline, _allocateStructHash(_i));
    }

    function _allocateStructHash(
        Fund.AllocateIntent memory _i
    ) internal pure returns (bytes32) {
        bytes32 _listHash = keccak256(abi.encode(_i.allocationList));
        bytes32 _creditHash = keccak256(
            abi.encode(CREDIT_TYPEHASH, _i.credit.chainId, _i.credit.token, _i.credit.total, _i.credit.feeTotal)
        );
        bytes32 _valuationDigest = _valuationHash(_i.valuation);
        return keccak256(
            abi.encode(
                ALLOCATE_INTENT_TYPEHASH,
                _hashHeader(_i.header),
                _i.shareToken,
                _valuationDigest,
                _i.token,
                keccak256(abi.encode(PRICE_TYPEHASH, _i.price.amount, _i.price.value)),
                _creditHash,
                _listHash
            )
        );
    }

    function test_hot_path_open_fund_back_it_sell_and_redeem() public {
        address _masterAccount = accountModule.predictUserAccount(master);
        assertEq(_masterAccount.code.length, 0, "the wallet has no account before it funds one");
        _fundWallet(master, 2000e6);
        assertGt(_masterAccount.code.length, 0, "the first deposit creates the wallet's account");
        assertEq(usdc.balanceOf(_masterAccount), 2000e6, "and lands in it");
        _fundWallet(backer, 1000e6);
        _escrowOnHub(address(usdc), 600e6);
        assertEq(
            hubEscrowStore.escrowedMap(_masterAccount, address(usdc)),
            600e6,
            "the wallet escrows on the hub in one call"
        );

        bytes32 _symbol = bytes32("PUP");
        bytes memory _pixels = new bytes(GRID_BYTES);
        for (uint _p; _p < _pixels.length; ++_p) {
            _pixels[_p] = bytes1(uint8(_p < 33 ? 1 + (_p * 37) % 255 : 1 + _p % 10));
        }
        shareToken = ShareToken(
            address(
                uint160(
                    uint(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                address(hub),
                                bytes32(uint(uint160(body))),
                                keccak256(
                                    _cloneCode(
                                        fundModule.shareImpl(), abi.encodePacked(body, _symbol, _pixels, uint16(1000))
                                    )
                                )
                            )
                        )
                    )
                )
            )
        );

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(
            _symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i)
        );
        assertEq(usdc.balanceOf(_masterAccount), 2000e6, "the opening round leaves the owner's account alone");
        assertEq(
            hubEscrowStore.releasedMap(_masterAccount, address(usdc)),
            500e6,
            "it releases the master capital from the hub escrow"
        );

        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Account__AlreadyCreated.selector);
        hub.createFund(
            bytes32("PUP2"), _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerSig
        );

        assertEq(shareToken.symbol(), "PUP", "the share carries the fund symbol");
        assertEq(shareToken.performanceFee(), PERFORMANCE_FEE, "the share carries the fund fee");
        assertGt(shareToken.balanceOf(body), 0, "the opening round mints for the master");
        assertEq(usdc.balanceOf(body), 500e6 - FEE, "the capital landed in the fund net of the fee");

        // a backer mandates the fund and joins the next round
        MandateLib.Mandate memory _m = MandateLib.Mandate({
            master: body,
            skin: MAX_SKIN,
            allocationRate: 5000,
            exitCap: 10_000,
            cooldownPeriod: 0,
            expiry: block.timestamp + 365 days
        });
        MandateLib.Mandate[] memory _one = new MandateLib.Mandate[](1);
        _one[0] = _m;
        _mandate(backer, backerKey, _one);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = _row(_account(backer), 400e6);
        (Fund.AllocateIntent memory _i2, bytes memory _sig2) = _allocateIntent(_nonceOf(body), _nav(), _rows);
        hub.allocate(_i2, _sig2, _ownerCoSig(_i2));
        uint _backerShares = shareToken.balanceOf(_account(backer));
        assertGt(_backerShares, 0, "the backer holds shares after the round");
        assertEq(
            fundStore.getHolding(body, _account(backer)).cost,
            (400e6 - FEE) * USD * PRICE_PRECISION / _backerShares,
            "the holding keeps the price it paid per share"
        );
        assertEq(usdc.balanceOf(body), 500e6 - FEE + 400e6 - FEE, "the stake landed in the fund net of the round fee");

        // a second round with no cohort, and a two-row mandate, so per-row gas is measured at two list sizes
        (Fund.AllocateIntent memory _i3, bytes memory _sig3) = _allocateIntent(
            _nonceOf(body), _nav(), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        hub.allocate(_i3, _sig3, _ownerCoSig(_i3));
        _cohortRound("cohort-", _one, 3, 3);
        _cohortRound("cohort-", _one, 4, 3);

        _mandate(backer, backerKey, _freshMandates(11, 2));
        _mandate(backer, backerKey, _freshMandates(21, 4));

        // the backer queues an exit, the master drains it, the backer collects
        _sell(backer, backerKey, _backerShares);
        assertEq(shareToken.balanceOf(_account(backer)), _backerShares, "sold shares stay in the seller's balance");
        assertEq(_queuedOf(_account(backer)), _backerShares, "locked as its queue");
        assertEq(fundStore.getRedemption(body).queued, _backerShares, "and counted in the fund queue");
        uint _before = wnt.balanceOf(_account(backer));
        _wethTo(body, 3000 ether);
        _redeem(0, 0, _list(_account(backer)));
        assertGt(wnt.balanceOf(_account(backer)), _before, "the backer is paid out in WETH");
        assertEq(shareToken.balanceOf(_account(backer)), 0, "its queued shares burned");
        assertEq(fundStore.getRedemption(body).queued, 0, "the queue is empty again");
        assertFalse(isOpen(fundStore.getRedemption(body)), "a redemption whose cohort paid everyone closes in the open");
        _cohortExits();
        _everyoneRedemption();
        _skippedRows(_one);
        _cohortRound("late-cohort-", _one, 3, 3);

        _spokeRound();
        _wethCreditFromTheOwnerAccount();
        _nonCanonicalRoundIsRefused();
        _gridRendersItsOwnColours();
        _swapRound(LiquidityGate(address(hub)), "hub");
        _swapRound(LiquidityGate(address(spoke)), "spoke");
        _fundSwapKeepsItsShares();
    }

    function _fundSwapKeepsItsShares() internal {
        Fund _logic = new Fund(
            address(governorAccount),
            accountModule,
            mandateStore,
            fundStore,
            hubEscrowStore,
            address(new ShareToken(address(redeemModule))),
            address(wnt)
        );
        vm.prank(address(governorAccount));
        RouterProxy(payable(address(fundModule))).upgrade(address(_logic));
        assertTrue(
            fundModule.shareImpl() != LibClone.implementationOf(address(shareToken)),
            "the swapped Fund logic clones a new share implementation"
        );
        (address _seller, uint _sellerKey) = makeAddrAndKey("cohort-2");
        address _acct = _account(_seller);
        uint _shares = shareToken.balanceOf(_acct) / 2;
        _sell(_seller, _sellerKey, _shares);
        assertEq(_queuedOf(_acct), _shares, "a share cloned before the swap still sells");
        uint _before = wnt.balanceOf(_acct);
        _wethTo(body, 3000 ether);
        _redeem(0, 0, _list(_acct));
        assertGt(wnt.balanceOf(_acct), _before, "and still redeems");
    }

    function _cohortExits() internal {
        (address _first, uint _firstKey) = makeAddrAndKey("cohort-0");
        (address _second, uint _secondKey) = makeAddrAndKey("cohort-1");
        _sell(_first, _firstKey, shareToken.balanceOf(_account(_first)) / 2);
        _sell(_second, _secondKey, shareToken.balanceOf(_account(_second)) / 2);
        uint _firstBefore = wnt.balanceOf(_account(_first));
        uint _secondBefore = wnt.balanceOf(_account(_second));
        _redeem(0, 0, _list(_account(_first)));
        assertGt(wnt.balanceOf(_account(_first)), _firstBefore, "the open pays its first cohort");
        assertEq(wnt.balanceOf(_account(_second)), _secondBefore, "an unlisted seller waits for a later cohort");
        assertTrue(isOpen(fundStore.getRedemption(body)), "the redemption stays open until every seller is paid");
        hub.redeemCohort(shareToken, _list(_account(_second)));
        assertGt(wnt.balanceOf(_account(_second)), _secondBefore, "a permissionless cohort pays the rest");
        assertFalse(isOpen(fundStore.getRedemption(body)), "and closes the redemption");
        assertEq(fundStore.getRedemption(body).queued, 0, "both sellers drained");
    }

    function _everyoneRedemption() internal {
        address[] memory _holders = new address[](3);
        for (uint _j; _j < 3; ++_j) {
            _holders[_j] = _account(makeAddr(string.concat("cohort-", vm.toString(_j))));
        }
        address _held = _holders[2];
        uint _masterShares = shareToken.balanceOf(body);
        uint _heldShares = shareToken.balanceOf(_held);
        _wethTo(body, 3000 ether);
        uint _masterPaid = wnt.balanceOf(_ownerAccount());
        uint _heldPaid = wnt.balanceOf(_held);
        uint[] memory _paid = new uint[](3);
        for (uint _j; _j < 3; ++_j) {
            _paid[_j] = wnt.balanceOf(_holders[_j]);
        }
        _redeem(2500, 0, _holders);
        assertFalse(isOpen(fundStore.getRedemption(body)), "a cohort covering every holder closes the redemption");
        assertEq(shareToken.balanceOf(body), _masterShares - _masterShares / 4, "the master burns the same quarter");
        assertEq(shareToken.balanceOf(_held), _heldShares - _heldShares / 4, "as every backer");
        uint _price = fundStore.getRedemption(body).price;
        uint _masterFees;
        uint _heldGross;
        for (uint _j; _j < 3; ++_j) {
            uint _cost = fundStore.getHolding(body, _holders[_j]).cost;
            assertLt(_cost, _price, "the fund gained since every backer joined");
            uint _net = wnt.balanceOf(_holders[_j]) - _paid[_j] + FEE * USD;
            uint _gross = Math.mulDiv(_net, _price * 10_000, _price * 10_000 - PERFORMANCE_FEE * (_price - _cost));
            uint _profitFee = _gross - _net;
            _masterFees += _profitFee - _profitFee * PROTOCOL_FEE_SHARE / 10_000;
            if (_holders[_j] == _held) _heldGross = _gross;
        }
        _masterPaid = wnt.balanceOf(_ownerAccount()) - _masterPaid + FEE * USD;
        assertGt(_masterPaid, _masterFees, "the owner's wallet is paid its retired quarter beside the fees");
        assertApproxEqRel(
            _heldGross * (_masterShares / 4),
            (_masterPaid - _masterFees) * (_heldShares / 4),
            1e15,
            "the master and a backer exit at the same price per share before the backer's fee"
        );
    }

    function _skippedRows(
        MandateLib.Mandate[] memory _one
    ) internal {
        address _stale = _account(makeAddr("cohort-0"));
        address _owner = _account(master);
        (address _user, uint _key) = makeAddrAndKey("fresh-beside-skips");
        _fundWallet(_user, 1000e6);
        _mandate(_user, _key, _one);
        address _fresh = _account(_user);
        address[] memory _sorted = new address[](3);
        _sorted[0] = _stale;
        _sorted[1] = _owner;
        _sorted[2] = _fresh;
        for (uint _i = 1; _i < 3; ++_i) {
            for (uint _j = _i; _j > 0 && uint160(_sorted[_j - 1]) > uint160(_sorted[_j]); --_j) {
                (_sorted[_j - 1], _sorted[_j]) = (_sorted[_j], _sorted[_j - 1]);
            }
        }
        Fund.Allocation[] memory _rows = new Fund.Allocation[](3);
        for (uint _i; _i < 3; ++_i) {
            _rows[_i] = _row(_sorted[_i], 100e6);
        }
        uint _staleHeld = shareToken.balanceOf(_stale);
        uint _ownerHeld = shareToken.balanceOf(_owner);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(_nonceOf(body), _nav(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            shareToken.balanceOf(_stale), _staleHeld, "a seller's mandate ended with its sell, so the round skips it"
        );
        assertEq(shareToken.balanceOf(_owner), _ownerHeld, "the owner's own account is skipped");
        assertGt(shareToken.balanceOf(_fresh), 0, "and the round still mints the rest");
    }

    function _wethCreditFromTheOwnerAccount() internal {
        vm.deal(master, 3000 ether);
        uint _held = wnt.balanceOf(_account(master));
        vm.prank(master);
        hub.deposit{value: 3000 ether}(address(wnt), 3000 ether);
        assertEq(
            wnt.balanceOf(_account(master)) - _held,
            3000 ether,
            "native attached to a WETH deposit lands wrapped in the account"
        );
        _retireEscrow(LiquidityGate(address(hub)), hubEscrowStore, address(wnt), 3000 ether);
        assertEq(wnt.balanceOf(_account(master)), _held, "the owner moves it from its account into the hub escrow");

        uint _bodyBefore = wnt.balanceOf(body);
        uint _feeBefore = wnt.balanceOf(feeReceiver);
        uint _sharesBefore = shareToken.balanceOf(body);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body),
            _nav(),
            address(wnt),
            Fund.Price({amount: 1 ether, value: ETH_USD * USD}),
            _credit(block.chainid, address(wnt), 3000 ether),
            new Fund.Allocation[](0)
        );
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(
            shareToken.balanceOf(body),
            _sharesBefore,
            "a round in another canonical token credits it at its signed value"
        );
        _feeBefore = wnt.balanceOf(feeReceiver) - _feeBefore;
        assertEq(_feeBefore, FEE * 1 ether / ETH_USD, "the master slice is paid in the round token");
        assertEq(wnt.balanceOf(body), _bodyBefore + 3000 ether - _feeBefore, "and the rest lands in the body");
        assertEq(hubEscrowStore.releasedMap(_account(master), address(wnt)), 3000 ether, "released from the hub escrow");
    }

    function _nonCanonicalRoundIsRefused() internal {
        outToken.mint(_account(master), 1e18);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body),
            _nav(),
            address(outToken),
            Fund.Price({amount: 1e18, value: 1e6 * USD}),
            _credit(block.chainid, address(outToken), 1e18),
            new Fund.Allocation[](0)
        );
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__TokenNotCanonical.selector, address(outToken)));
        hub.allocate(_i, _sig, _ownerSig);
    }

    function _gridRendersItsOwnColours() internal {
        bytes memory _a = new bytes(GRID_BYTES);
        bytes memory _b = new bytes(GRID_BYTES);
        _a[0] = 0xE8;
        _a[1] = 0x46;
        _a[2] = 0x7C;
        _b[0] = 0x00;
        _b[1] = 0xFF;
        _b[2] = 0x00;

        address _impl = fundModule.shareImpl();
        ShareToken _shareA = ShareToken(
            LibClone.cloneDeterministic(_impl, abi.encodePacked(body, bytes32("AAA"), _a), bytes32(uint(901)))
        );
        ShareToken _shareB = ShareToken(
            LibClone.cloneDeterministic(_impl, abi.encodePacked(body, bytes32("AAA"), _b), bytes32(uint(902)))
        );

        assertEq(_shareA.pixels(), _a, "the clone returns exactly the grid it was created with");
        assertTrue(
            keccak256(bytes(_shareA.tokenURI())) != keccak256(bytes(_shareB.tokenURI())),
            "one differing cell must change the render, or the grid is not what tokenURI draws"
        );

        bytes memory _short = new bytes(153);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(0, 0, new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.ShareToken__InvalidGrid.selector, 153));
        hub.createFund(bytes32("BAD"), _short, "", "", _i, _sig, _ownerSig);
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

        Deposit.SwapIntent memory _short = Deposit.SwapIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            swap: _swapParams(_user, 1000e6),
            destinationChainId: block.chainid
        });
        _short.swap.providerCallData =
            abi.encodeCall(MockSwapProvider.swap, (address(usdc), 1000e6 - FEE - 1, address(outToken), 1e18, _user));
        bytes memory _shortSig = _swapSig(WITHDRAW_INTENT_TYPEHASH, _key, _acct, _short);
        uint _held = usdc.balanceOf(_acct);
        vm.expectRevert(
            abi.encodeWithSelector(Error.Balance__SwapInputNotSpent.selector, address(usdc), _held, _held - 1000e6 + 1)
        );
        _gate.withdraw(_short, _shortSig);

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
                _i.header.deadline,
                keccak256(abi.encode(_typehash, _hashHeader(_i.header), _i.destinationChainId, _hashSwap(_i.swap)))
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
        _gate.depositAcross(_i, _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, _key, _acct, _i));
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
        _gate.withdraw(_i, _swapSig(WITHDRAW_INTENT_TYPEHASH, _key, _acct, _i));
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
        _gate.withdraw(_i, _swapSig(WITHDRAW_INTENT_TYPEHASH, _key, _acct, _i));
    }

    function _spokeRound() internal {
        address _parent = _account(master);
        _depositEscrow(address(usdc), 200e6);
        assertEq(
            spokeEscrowStore.escrowedMap(_parent, address(usdc)), 200e6, "the wallet escrows on the spoke in one call"
        );

        uint _bodyBefore = usdc.balanceOf(body);
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        uint _sharesBefore = shareToken.balanceOf(body);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body), _nav(), _credit(FOREIGN_CHAIN_ID, address(usdc), 200e6), new Fund.Allocation[](0)
        );
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(body), _sharesBefore, "the hub round credits escrow that sits on another chain");
        assertEq(usdc.balanceOf(body), _bodyBefore, "nothing of the fund moves on the hub");
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore, "and the hub bills no fee the fund could not pay there");
        assertEq(
            fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total, 200e6, "the hub keeps the signed total"
        );

        bytes memory _over = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 201e6, FEE);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 200e6, 201e6));
        spoke.fulfil(body, address(usdc), 201e6, FEE, _over, _noGenesis());
        bytes memory _forged =
            _coSig(backerKey, AccountLib.creditDigest(_parent, body, FOREIGN_CHAIN_ID, address(usdc), 200e6, FEE));
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, address(usdc), 200e6, FEE, _forged, _noGenesis());
        vm.chainId(HUB_CHAIN);

        _fulfil(address(usdc), 200e6, FEE);
        assertEq(
            spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)),
            200e6,
            "anyone settles the owner's signed total"
        );
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore + FEE, "the round fee is billed where the capital sits");
        assertEq(usdc.balanceOf(body), _bodyBefore + 200e6 - FEE, "the escrow lands in the body net of that fee");

        bytes memory _replay = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 200e6, FEE);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 200e6, 200e6));
        spoke.fulfil(body, address(usdc), 200e6, FEE, _replay, _noGenesis());
        vm.chainId(HUB_CHAIN);

        _depositEscrow(address(usdc), 100e6);
        assertEq(
            spokeEscrowStore.escrowedMap(_parent, address(usdc)), 300e6, "a second escrow adds to the same owner ledger"
        );
        assertEq(spokeEscrowStore.releasedMap(_parent, address(usdc)), 200e6, "beside what was already released");

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

    function _depositEscrow(
        address _token,
        uint _amount
    ) internal {
        MockERC20(_token).mint(master, _amount);
        vm.startPrank(master);
        IERC20(_token).approve(address(depositModule), _amount);
        spoke.depositEscrow(_token, _amount);
        vm.stopPrank();
    }

    function _escrowOnHub(
        address _token,
        uint _amount
    ) internal {
        MockERC20(_token).mint(master, _amount);
        vm.startPrank(master);
        IERC20(_token).approve(address(depositModule), _amount);
        hub.depositEscrow(_token, _amount);
        vm.stopPrank();
    }

    function _retireEscrow(
        LiquidityGate _gate,
        EscrowStore _store,
        address _token,
        uint _amount
    ) internal {
        address _acct = _account(master);
        uint _before = _store.escrowedMap(_acct, _token);
        LiquidityGate.RetireEscrowIntent memory _i = LiquidityGate.RetireEscrowIntent({
            header: _header(_acct, master, _nonceOf(_acct)), token: _token, amount: _amount
        });
        _gate.retireEscrow(
            _i,
            _pair(
                masterKey,
                _typed(
                    _acct,
                    _i.header.deadline,
                    keccak256(abi.encode(RETIRE_ESCROW_INTENT_TYPEHASH, _hashHeader(_i.header), _i.token, _i.amount))
                )
            )
        );
        assertEq(_store.escrowedMap(_acct, _token), _before + _amount, "the account's balance joins its escrow");
    }

    function _noGenesis() internal pure returns (AccountLib.Genesis memory) {
        return AccountLib.Genesis({parent: address(0), key: "", approval: ""});
    }

    function _ownerCoSig(
        Fund.AllocateIntent memory _i
    ) internal view returns (bytes memory) {
        if (_i.credit.total == 0) return "";
        return _creditSignature(_i.credit.chainId, _i.credit.token, _i.credit.total, _i.credit.feeTotal);
    }

    function _creditSignature(
        uint _chainId,
        address _token,
        uint _total,
        uint _feeTotal
    ) internal view returns (bytes memory) {
        return _coSig(
            masterKey,
            AccountLib.creditDigest(accountModule.predictUserAccount(master), body, _chainId, _token, _total, _feeTotal)
        );
    }

    function _fulfil(
        address _token,
        uint _total,
        uint _feeTotal
    ) internal {
        bytes memory _signature = _creditSignature(FOREIGN_CHAIN_ID, _token, _total, _feeTotal);
        vm.chainId(FOREIGN_CHAIN_ID);
        spoke.fulfil(body, _token, _total, _feeTotal, _signature, _noGenesis());
        vm.chainId(HUB_CHAIN);
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
                    _i.header.deadline,
                    keccak256(
                        abi.encode(
                            OPERATE_INTENT_TYPEHASH,
                            _hashHeader(_i.header),
                            _callListHash(_callList),
                            keccak256(abi.encodePacked(_i.tokenList))
                        )
                    )
                )
            ),
            AccountLib.Genesis({parent: _account(master), key: "", approval: ""})
        );
    }

    function _callListHash(
        IAccount.Call[] memory _callList
    ) internal pure returns (bytes32) {
        bytes32[] memory _hashList = new bytes32[](_callList.length);
        for (uint _k; _k < _callList.length; ++_k) {
            _hashList[_k] = keccak256(
                abi.encode(
                    CALL_TYPEHASH,
                    _callList[_k].target,
                    _callList[_k].value,
                    _callList[_k].gasLimit,
                    keccak256(_callList[_k].callData)
                )
            );
        }
        return keccak256(abi.encodePacked(_hashList));
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

    function _row(
        address _puppet,
        uint _amount
    ) internal view returns (Fund.Allocation memory) {
        return Fund.Allocation({puppet: _puppet, mandate: mandateLog[_puppet][body], amount: _amount});
    }

    function _cohortRound(
        string memory _tag,
        MandateLib.Mandate[] memory _one,
        uint _count,
        uint _oversizedFrom
    ) internal {
        Fund.Allocation[] memory _rows = new Fund.Allocation[](_count);
        for (uint _j; _j < _count; ++_j) {
            (address _user, uint _key) = makeAddrAndKey(string.concat(_tag, vm.toString(_j)));
            _fundWallet(_user, 1000e6);
            _mandate(_user, _key, _one);
            address _acct = _account(_user);
            uint _k = _j;
            while (_k > 0 && uint160(_rows[_k - 1].puppet) > uint160(_acct)) {
                _rows[_k] = _rows[_k - 1];
                --_k;
            }
            uint _stake = _j < _oversizedFrom ? 100e6 : 5000e6;
            _rows[_k] = _row(_acct, _stake);
        }
        uint[] memory _held = new uint[](_count);
        for (uint _j; _j < _count; ++_j) {
            _held[_j] = shareToken.balanceOf(_rows[_j].puppet);
        }
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(_nonceOf(body), _nav(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        for (uint _j; _j < _count; ++_j) {
            if (_rows[_j].amount == 100e6) {
                assertGt(shareToken.balanceOf(_rows[_j].puppet), _held[_j], "a row inside its cap is minted");
            } else {
                assertEq(
                    shareToken.balanceOf(_rows[_j].puppet),
                    _held[_j],
                    "a row over its cap is skipped, the round survives"
                );
            }
        }
    }

    function _freshMandates(
        uint _from,
        uint _count
    ) internal view returns (MandateLib.Mandate[] memory list_) {
        list_ = new MandateLib.Mandate[](_count);
        for (uint _j; _j < _count; ++_j) {
            list_[_j] = MandateLib.Mandate({
                master: address(uint160(_from + _j)),
                skin: MAX_SKIN,
                allocationRate: 5000,
                exitCap: 10_000,
                cooldownPeriod: 0,
                expiry: block.timestamp + 365 days
            });
        }
    }

    function _mandate(
        address _user,
        uint _key,
        MandateLib.Mandate[] memory _list
    ) internal {
        address _acct = _account(_user);
        HubGate.MandateIntent memory _i = HubGate.MandateIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            epoch: UserAccount(payable(_acct)).epoch(),
            mandateList: _list
        });
        hub.mandate(
            _i,
            _pair(
                _key,
                _typed(
                    _acct,
                    _i.header.deadline,
                    keccak256(
                        abi.encode(
                            MANDATE_INTENT_TYPEHASH, _hashHeader(_i.header), _i.epoch, keccak256(abi.encode(_list))
                        )
                    )
                )
            )
        );
        for (uint _j; _j < _list.length; ++_j) {
            mandateLog[_acct][_list[_j].master] = _list[_j];
        }
    }

    function _sell(
        address _user,
        uint _key,
        uint _shares
    ) internal {
        address _acct = _account(_user);
        Redeem.SellIntent memory _i = Redeem.SellIntent({
            header: _header(_acct, _user, _nonceOf(_acct)), shareToken: shareToken, shares: _shares
        });
        hub.sell(
            _i,
            _pair(
                _key,
                _typed(
                    _acct,
                    _i.header.deadline,
                    keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(_i.header), _i.shareToken, _i.shares))
                )
            )
        );
    }

    function _redeem(
        uint _fraction,
        uint _join,
        address[] memory _holderList
    ) internal {
        _redeem(_fraction, _join, _valuation(_nav()), _holderList);
    }

    function _redeem(
        uint _fraction,
        uint _join,
        Fund.Valuation memory _v,
        address[] memory _holderList
    ) internal {
        Redeem.RedeemIntent memory _i = _redeemIntent(_fraction, _join, _v);
        hub.redeem(_i, _redeemSig(_i), _holderList);
    }

    function _redeemIntent(
        uint _fraction,
        uint _join,
        Fund.Valuation memory _v
    ) internal view returns (Redeem.RedeemIntent memory) {
        return Redeem.RedeemIntent({
            header: _fundHeader(_nonceOf(body)),
            shareToken: shareToken,
            valuation: _v,
            token: address(wnt),
            fraction: _fraction,
            join: _join
        });
    }

    function _redeemSig(
        Redeem.RedeemIntent memory _i
    ) internal view returns (bytes memory) {
        return _pair(
            masterKey,
            _typed(
                body,
                _i.header.deadline,
                keccak256(
                    abi.encode(
                        REDEEM_INTENT_TYPEHASH,
                        _hashHeader(_i.header),
                        _i.shareToken,
                        _valuationHash(_i.valuation),
                        _i.token,
                        _i.fraction,
                        _i.join
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
            hex"61",
            uint16(_args.length + 0x2d),
            hex"3d81600a3d39f3363d3d373d3d3d363d73",
            _impl,
            hex"5af43d82803e903d91602b57fd5bf3",
            _args
        );
    }
}
