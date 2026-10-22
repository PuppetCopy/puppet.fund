// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {HubGate, MANDATE_INTENT_TYPEHASH, MAX_SKIN} from "src/HubGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Deposit} from "src/core/Deposit.sol";
import {Fund, PRICE_PRECISION, VIRTUAL_SHARES, VIRTUAL_VALUE} from "src/core/Fund.sol";
import {Redeem} from "src/core/Redeem.sol";
import {FundStore, isOpen} from "src/core/FundStore.sol";
import {GRID_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib, SESSION_REVOKE_DELAY} from "src/utils/AccountLib.sol";
import {BalanceLib} from "src/utils/BalanceLib.sol";
import {CallLib} from "src/utils/CallLib.sol";
import {MandateLib} from "src/utils/MandateLib.sol";
import {Error} from "src/utils/Error.sol";
import {LiquidityGate, WITHDRAW_INTENT_TYPEHASH} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {SwapLib} from "src/utils/SwapLib.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

import {RouterProxy} from "src/utils/RouterProxy.sol";
import {HotPathTest} from "./HotPath.t.sol";
import {MockERC20} from "./mock/MockERC20.t.sol";

contract ImitationAccount {
    address public immutable user;

    constructor(
        address _user
    ) {
        user = _user;
    }

    function execute(
        address,
        bytes32,
        uint,
        bytes calldata,
        IAccount.Call[] calldata _callList
    ) external pure returns (bytes32, bytes[] memory) {
        return (bytes32(0), new bytes[](_callList.length));
    }

    function epoch() external pure returns (uint) {
        return 0;
    }
}

contract RevokingWallet {
    UserAccount internal immutable account;

    constructor(
        UserAccount _account
    ) {
        account = _account;
    }

    receive() external payable {
        account.revokeSessions();
    }
}

contract AllocateMatrixTest is HotPathTest {
    uint constant FEE_VALUE = FEE * USD;
    uint constant SEED = 500e6;

    struct Book {
        uint[6] held;
        uint body;
        uint fee;
        uint supply;
        uint nav;
        uint masterShares;
        uint totalSupply;
        uint nonce;
        uint slice;
        uint billed;
        uint masterBilled;
        uint owner;
        uint ownerNonce;
        uint released;
    }

    struct Blend {
        address[3] puppet;
        uint[3] stake;
        uint[3] cost;
        uint[3] basis;
    }

    function _usdcPrice() internal view returns (Fund.Price memory) {
        return Fund.Price({amount: 1e6, value: 1e6 * USD});
    }

    function _noCredit() internal pure returns (Fund.Credit memory) {
        return Fund.Credit({chainId: 0, token: address(0), total: 0, feeTotal: 0});
    }

    function _round(
        Fund.Price memory _price,
        Fund.Credit memory _c,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory, bytes memory) {
        return _roundIn(address(usdc), _price, _c, _rows);
    }

    function _roundIn(
        address _token,
        Fund.Price memory _price,
        Fund.Credit memory _c,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        (intent_,) = _allocateIntent(_nonceOf(body), _nav(), _token, _price, _c, _rows);
        intent_.header.deadline = vm.getBlockTimestamp() + 300;
        coSig_ = _pair(masterKey, _allocateDigest(intent_));
    }

    function _openFund() internal {
        _fundWallet(master, 2000e6);
        _escrowOnHub(address(usdc), SEED);
        bytes32 _symbol = bytes32("AM");
        bytes memory _pixels = new bytes(GRID_BYTES);
        shareToken = ShareToken(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(body, _symbol, _pixels, uint16(hub.performanceFee())),
                bytes32(uint(uint160(body))),
                address(hub)
            )
        );
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), SEED), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(
            _symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i)
        );
        assertEq(shareToken.balanceOf(body), 499e18, "the opening credit mints the seed net of the round fee");
        assertEq(usdc.balanceOf(body), SEED - FEE, "and lands it in the body net of that fee");
        assertEq(
            hubEscrowStore.releasedMap(_account(master), address(usdc)),
            SEED,
            "the seed is released from the hub escrow"
        );
        assertEq(usdc.balanceOf(_account(master)), 2000e6, "while the owner's account keeps its balance");
    }

    function _mandateOf(
        uint _skin,
        uint _cooldown,
        uint _expiry
    ) internal view returns (MandateLib.Mandate memory) {
        return MandateLib.Mandate({
            master: body, skin: _skin, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: _cooldown, expiry: _expiry
        });
    }

    function _list(
        MandateLib.Mandate memory _m
    ) internal pure returns (MandateLib.Mandate[] memory list_) {
        list_ = new MandateLib.Mandate[](1);
        list_[0] = _m;
    }

    function _one(
        address _puppet,
        uint _amount
    ) internal view returns (Fund.Allocation[] memory rows_) {
        rows_ = new Fund.Allocation[](1);
        rows_[0] = _row(_puppet, _amount);
    }

    function _two(
        address _a,
        address _b,
        uint _amount
    ) internal view returns (Fund.Allocation[] memory rows_) {
        rows_ = new Fund.Allocation[](2);
        (address _lo, address _hi) = uint160(_a) < uint160(_b) ? (_a, _b) : (_b, _a);
        rows_[0] = _row(_lo, _amount);
        rows_[1] = _row(_hi, _amount);
    }

    function _mandateIntent(
        address _user,
        uint _key,
        MandateLib.Mandate[] memory _mandates
    ) internal returns (HubGate.MandateIntent memory intent_, bytes memory coSig_) {
        address _acct = _account(_user);
        intent_ = HubGate.MandateIntent({
            header: AccountLib.IntentHeader({
                account: _acct,
                user: _user,
                nonce: _nonceOf(_acct),
                deadline: vm.getBlockTimestamp() + 300,
                feeToken: address(usdc),
                fee: FEE
            }),
            epoch: UserAccount(payable(_acct)).epoch(),
            mandateList: _mandates
        });
        bytes32 _structHash = keccak256(
            abi.encode(
                MANDATE_INTENT_TYPEHASH, _hashHeader(intent_.header), intent_.epoch, keccak256(abi.encode(_mandates))
            )
        );
        coSig_ = _pair(_key, _typed(_acct, intent_.header.deadline, _structHash));
    }

    function _mandateCall(
        address _user,
        uint _key,
        MandateLib.Mandate[] memory _mandates
    ) internal {
        (HubGate.MandateIntent memory _i, bytes memory _sig) = _mandateIntent(_user, _key, _mandates);
        hub.mandate(_i, _sig);
        for (uint _j; _j < _mandates.length; ++_j) {
            mandateLog[_i.header.account][_mandates[_j].master] = _mandates[_j];
        }
    }

    function _backer(
        string memory _tag,
        MandateLib.Mandate memory _m
    ) internal returns (address acct_, uint key_, address user_) {
        (user_, key_) = makeAddrAndKey(_tag);
        _fundWallet(user_, 1000e6);
        _mandateCall(user_, key_, _list(_m));
        acct_ = _account(user_);
    }

    function _cohort(
        string memory _tag,
        uint _n
    ) internal returns (address[] memory users_, uint[] memory keys_) {
        users_ = new address[](_n);
        keys_ = new uint[](_n);
        for (uint _j; _j < _n; ++_j) {
            (address _u, uint _k) = makeAddrAndKey(string.concat(_tag, vm.toString(_j)));
            uint _at = _j;
            while (
                _at > 0 && accountModule.predictUserAccount(users_[_at - 1]) > accountModule.predictUserAccount(_u)
            ) {
                users_[_at] = users_[_at - 1];
                keys_[_at] = keys_[_at - 1];
                --_at;
            }
            users_[_at] = _u;
            keys_[_at] = _k;
        }
    }

    function _matrixCast(
        uint _creditAmount
    ) internal returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        (address[] memory _users, uint[] memory _keys) = _cohort("matrix-", 6);
        uint[6] memory _amounts = [uint(1e6), 100e6, 100e6, 200e6, 100e6, 600e6];
        uint[6] memory _skins = [uint(5000), 5000, 5000, 5000, 5000, 5000];
        Fund.Allocation[] memory _rows = new Fund.Allocation[](6);
        for (uint _j; _j < 6; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            _mandateCall(_users[_j], _keys[_j], _list(_mandateOf(_skins[_j], 0, vm.getBlockTimestamp() + 365 days)));
            _rows[_j] = _row(_account(_users[_j]), _amounts[_j]);
        }
        UserAccount _revoked = UserAccount(payable(_rows[2].puppet));
        vm.prank(_users[2]);
        _revoked.revokeSessions();

        (intent_, coSig_) = _round(
            _usdcPrice(), _creditAmount > 0 ? _credit(block.chainid, address(usdc), _creditAmount) : _noCredit(), _rows
        );

        vm.prank(_users[4]);
        UserAccount(payable(_rows[4].puppet)).revokeSessions();

        assertEq(
            mandateStore.mandateMap(address(_revoked), body),
            keccak256(abi.encode(_rows[2].mandate, uint(0))),
            "B's commitment still stands under the epoch it was registered in"
        );
        assertEq(
            _revoked.epoch(), _epochAfterRevoke(0), "while B revoked before the round was signed, leaving that epoch"
        );
        assertTrue(_revoked.epoch() != 0, "so B's epoch no longer matches its commitment");
        assertEq(
            mandateStore.mandateMap(_rows[4].puppet, body),
            keccak256(abi.encode(_rows[4].mandate, uint(0))),
            "C's commitment stands the same way"
        );
        assertEq(
            UserAccount(payable(_rows[4].puppet)).epoch(),
            _epochAfterRevoke(0),
            "while C revoked after the round was signed"
        );
        assertTrue(
            UserAccount(payable(_rows[4].puppet)).epoch() != 0, "so C's epoch no longer matches its commitment either"
        );
        assertGt(
            _rows[5].amount * 10_000,
            usdc.balanceOf(_rows[5].puppet) * _rows[5].mandate.allocationRate,
            "D asks for more than its allocation rate allows"
        );
    }

    function _matrix(
        uint _creditAmount,
        uint _feeDelta,
        uint _sharesE,
        uint _sharesF,
        uint _sharesMaster
    ) internal {
        _openFund();
        _escrowOnHub(address(usdc), 100e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _matrixCast(_creditAmount);
        Fund.Allocation[] memory _rows = _i.allocationList;

        Book memory _b;
        for (uint _j; _j < 6; ++_j) {
            _b.held[_j] = usdc.balanceOf(_rows[_j].puppet);
        }
        _b.body = usdc.balanceOf(body);
        _b.fee = usdc.balanceOf(feeReceiver);
        _b.supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        _b.nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        _b.masterShares = shareToken.balanceOf(body);
        _b.totalSupply = shareToken.totalSupply();
        _b.nonce = _nonceOf(body);
        _b.owner = usdc.balanceOf(_account(master));
        _b.ownerNonce = _nonceOf(_account(master));
        _b.released = hubEscrowStore.releasedMap(_account(master), address(usdc));

        uint[4] memory _skipped = [uint(0), 2, 4, 5];
        for (uint _j; _j < 4; ++_j) {
            vm.expectCall(_rows[_skipped[_j]].puppet, abi.encodeWithSelector(UserAccount.execute.selector), 0);
        }
        hub.allocate(_i, _sig, _ownerCoSig(_i));

        _b.slice = FEE_VALUE / (_creditAmount > 0 ? 7 : 6);
        _b.billed = Math.mulDiv(2 * _b.slice, 1e6, 1e6 * USD);
        _b.masterBilled = _creditAmount > 0 ? Math.mulDiv(_b.slice, 1e6, 1e6 * USD) : 0;

        for (uint _j; _j < 4; ++_j) {
            address _p = _rows[_skipped[_j]].puppet;
            assertEq(usdc.balanceOf(_p), _b.held[_skipped[_j]], "a skipped puppet keeps its balance");
            assertEq(shareToken.balanceOf(_p), 0, "a skipped puppet is minted nothing");
            FundStore.Holding memory _h = fundStore.getHolding(body, _p);
            assertEq(_h.allocatedAt, 0, "and starts no cooldown");
            assertEq(_h.cost, 0, "nor carries a cost");
        }

        assertEq(Math.mulDiv(100e6 * USD - _b.slice, _b.supply, _b.nav), _sharesE, "E's shares follow the fixed slice");
        assertEq(Math.mulDiv(200e6 * USD - _b.slice, _b.supply, _b.nav), _sharesF, "F's shares follow the same slice");
        assertEq(shareToken.balanceOf(_rows[1].puppet), _sharesE, "E is minted (value - slice) * supply / nav");
        assertEq(shareToken.balanceOf(_rows[3].puppet), _sharesF, "F is minted (value - slice) * supply / nav");
        assertEq(
            fundStore.getHolding(body, _rows[1].puppet).cost,
            (100e6 * USD - _b.slice) * PRICE_PRECISION / _sharesE,
            "E's cost is the value it paid per share"
        );
        assertEq(
            fundStore.getHolding(body, _rows[3].puppet).cost,
            (200e6 * USD - _b.slice) * PRICE_PRECISION / _sharesF,
            "F's cost is the value it paid per share"
        );
        assertEq(usdc.balanceOf(_rows[1].puppet), _b.held[1] - 100e6, "E pays exactly its row");
        assertEq(usdc.balanceOf(_rows[3].puppet), _b.held[3] - 200e6, "F pays exactly its row");
        assertEq(fundStore.getHolding(body, _rows[3].puppet).allocatedAt, vm.getBlockTimestamp(), "F's cooldown starts");

        assertEq(
            _creditAmount > 0 ? Math.mulDiv(_creditAmount * USD - _b.slice, _b.supply, _b.nav) : 0,
            _sharesMaster,
            "the master leg mints on value net of the same slice"
        );
        assertEq(shareToken.balanceOf(body) - _b.masterShares, _sharesMaster, "pinned master shares");
        assertEq(
            shareToken.totalSupply() - _b.totalSupply,
            _sharesE + _sharesF + _sharesMaster,
            "supply grows by exactly the minted shares"
        );

        assertEq(
            usdc.balanceOf(feeReceiver) - _b.fee,
            _b.billed + _b.masterBilled,
            "fee receiver gets the row billing plus the master billing"
        );
        assertEq(usdc.balanceOf(feeReceiver) - _b.fee, _feeDelta, "pinned fee receiver delta");
        assertEq(
            usdc.balanceOf(body),
            _b.body + 300e6 + _creditAmount - _b.billed - _b.masterBilled,
            "body receives the included rows plus the credit minus everything billed"
        );
        assertEq(_nonceOf(body), _b.nonce + 1, "the round consumes one body nonce");
        assertEq(usdc.balanceOf(_account(master)), _b.owner, "the owner's account is never pulled");
        assertEq(
            hubEscrowStore.releasedMap(_account(master), address(usdc)) - _b.released,
            _creditAmount,
            "only a local credit releases from the owner's open hub escrow"
        );
        assertEq(
            _nonceOf(_account(master)),
            _b.ownerNonce,
            "a credit is a signed total and spends no nonce of the owner's account"
        );
    }

    function test_matrix_without_credit_skips_four_and_the_relayer_absorbs_their_slices() public {
        _matrix(0, 333_333, 99_833_333_333_333_333_334, 199_833_333_333_333_333_334, 0);
    }

    function test_matrix_with_local_credit_bills_the_master_one_fixed_slice() public {
        _matrix(100e6, 428_571, 99_857_142_857_142_857_143, 199_857_142_857_142_857_143, 99_857_142_857_142_857_143);
    }

    function _blendRound(
        Blend memory _b,
        uint[3] memory _amounts
    ) internal returns (uint price_) {
        uint _len;
        for (uint _j; _j < 3; ++_j) {
            if (_amounts[_j] > 0) ++_len;
        }
        Fund.Allocation[] memory _rows = new Fund.Allocation[](_len);
        uint[3] memory _held;
        uint _k;
        uint _paid;
        for (uint _j; _j < 3; ++_j) {
            _held[_j] = usdc.balanceOf(_b.puppet[_j]);
            if (_amounts[_j] > 0) _rows[_k++] = _row(_b.puppet[_j], _amounts[_j]);
            _paid += _amounts[_j];
        }
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        uint _slice = FEE_VALUE / _len;
        uint _body = usdc.balanceOf(body);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        price_ = _nav * PRICE_PRECISION / _supply;
        assertEq(
            usdc.balanceOf(body),
            _body + _paid - Math.mulDiv(_slice * _len, 1e6, 1e6 * USD),
            "the body nets every row less its slice"
        );
        for (uint _j; _j < 3; ++_j) {
            assertEq(usdc.balanceOf(_b.puppet[_j]), _held[_j] - _amounts[_j], "each holder pays exactly its row");
            if (_amounts[_j] > 0) {
                uint _net = _amounts[_j] * USD - _slice;
                uint _shares = Math.mulDiv(_net, _supply, _nav);
                _b.cost[_j] = (_b.cost[_j] * _b.stake[_j] + _net * PRICE_PRECISION) / (_b.stake[_j] + _shares);
                _b.stake[_j] += _shares;
                _b.basis[_j] += _net * PRICE_PRECISION;
            }
            assertEq(
                shareToken.balanceOf(_b.puppet[_j]),
                _b.stake[_j],
                "the stake is every mint at its round price less every burn"
            );
            assertEq(
                fundStore.getHolding(body, _b.puppet[_j]).cost,
                _b.cost[_j],
                "the cost blends the entry into the stake held before it"
            );
            if (_b.stake[_j] > 0) {
                assertApproxEqAbs(
                    _b.cost[_j], _b.basis[_j] / _b.stake[_j], 3, "and stays the value paid per surviving share"
                );
            }
        }
    }

    function test_cost_blends_each_entry_at_its_round_price_through_a_gain_a_burn_and_a_loss() public {
        _openFund();
        (address[] memory _users, uint[] memory _keys) = _cohort("blend-", 3);
        Blend memory _b;
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        address[] memory _holders = new address[](3);
        for (uint _j; _j < 3; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            _mandateCall(_users[_j], _keys[_j], _list(_m));
            _b.puppet[_j] = _account(_users[_j]);
            _holders[_j] = _b.puppet[_j];
        }

        uint _p1 = _blendRound(_b, [uint(200e6), 100e6, 0]);
        usdc.mint(body, usdc.balanceOf(body));
        uint _p2 = _blendRound(_b, [uint(100e6), 0, 300e6]);
        assertGt(_p2, _p1 * 19 / 10, "the second round prices after the fund doubled");

        vm.prank(body);
        usdc.transfer(makeAddr("weth-market"), 600e6);
        _wethTo(body, 600e6 * USD);
        _redeem(2500, 0, _holders);
        assertFalse(isOpen(fundStore.getRedemption(body)), "a quarter redemption over every holder closes at once");
        for (uint _j; _j < 3; ++_j) {
            uint _remaining = _b.stake[_j] - Math.mulDiv(_b.stake[_j], 2500, 10_000);
            _b.basis[_j] = Math.mulDiv(_b.basis[_j], _remaining, _b.stake[_j]);
            _b.stake[_j] = _remaining;
            assertEq(shareToken.balanceOf(_b.puppet[_j]), _remaining, "the redemption burns a quarter of each stake");
            assertEq(fundStore.getHolding(body, _b.puppet[_j]).cost, _b.cost[_j], "and the rest keeps its cost");
        }

        vm.prank(body);
        usdc.transfer(makeAddr("venue-loss"), 600e6);
        uint _p3 = _blendRound(_b, [uint(50e6), 200e6, 100e6]);
        assertLt(_p3, _p2, "the third round prices after a loss");
        assertGt(_p3, _p1, "still above the opening price");

        assertGt(_b.cost[0], _p1, "a holder of three entries costs above its cheapest");
        assertLt(_b.cost[0], _p2, "and below its dearest");
        assertGt(_b.cost[1], _p1, "a holder of the first and last entries costs between them");
        assertLt(_b.cost[1], _p3, "below the last");
        assertGt(_b.cost[2], _p3, "a holder of the peak and the last entries costs between them");
        assertLt(_b.cost[2], _p2, "below the peak");
        assertLt(_b.cost[1], _b.cost[0], "each holder carries its own blend");
        assertLt(_b.cost[0], _b.cost[2], "set by its own entries");
    }

    function test_entrants_at_one_valuation_pay_the_same_gross_value_per_share_beside_a_holders_gain() public {
        _openFund();
        (address[] memory _users, uint[] memory _keys) = _cohort("gross-", 3);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        address[3] memory _p;
        for (uint _j; _j < 3; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            _mandateCall(_users[_j], _keys[_j], _list(_m));
            _p[_j] = _account(_users[_j]);
        }
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p[0], 200e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        usdc.mint(body, 2 * usdc.balanceOf(body));
        _escrowOnHub(address(usdc), 300e6);

        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        _rows[0] = _row(_p[1], 100e6);
        _rows[1] = _row(_p[2], 400e6);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 300e6), _rows);
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        uint _price = _nav * PRICE_PRECISION / _supply;
        uint _holderCost = fundStore.getHolding(body, _p[0]).cost;
        assertLt(_holderCost * 2, _price, "the first backer sits on a gain a pending fee would have priced in");
        uint _masterShares = shareToken.balanceOf(body);
        hub.allocate(_i, _sig, _ownerCoSig(_i));

        uint _slice = FEE_VALUE / 3;
        uint _contributed = shareToken.balanceOf(body) - _masterShares;
        assertEq(
            shareToken.balanceOf(_p[1]),
            Math.mulDiv(100e6 * USD - _slice, _supply, _nav),
            "an entrant mints on the plain supply over the gross valuation"
        );
        assertEq(
            shareToken.balanceOf(_p[2]),
            Math.mulDiv(400e6 * USD - _slice, _supply, _nav),
            "so does a larger entrant in the same round"
        );
        assertEq(_contributed, Math.mulDiv(300e6 * USD - _slice, _supply, _nav), "and the master's own credit");
        assertApproxEqAbs(
            fundStore.getHolding(body, _p[1]).cost,
            fundStore.getHolding(body, _p[2]).cost,
            1,
            "two entrants at one valuation pay the same value per share"
        );
        assertApproxEqAbs(fundStore.getHolding(body, _p[1]).cost, _price, 1, "which is the gross value per share");
        assertApproxEqAbs(
            (300e6 * USD - _slice) * PRICE_PRECISION / _contributed,
            _price,
            1,
            "the master's credit buys at that price too"
        );
        assertEq(fundStore.getHolding(body, _p[0]).cost, _holderCost, "and the holder's gain is left to its own exit");
    }

    function test_relay_fee_cap_skips_at_exactly_max_bps_and_includes_one_wei_above() public {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _p,,) = _backer("fee-cap", _m);

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, 10e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);

        uint _held = usdc.balanceOf(_p);
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, 10e6 + 1));
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            shareToken.balanceOf(_p),
            Math.mulDiv((10e6 + 1) * USD - FEE_VALUE, _supply, _nav),
            "one wei above the cap is included"
        );
        assertEq(shareToken.balanceOf(_p), 9_000_001e12, "and carries the whole fee as the only row");
        assertEq(usdc.balanceOf(_p), _held - 10e6 - 1, "the puppet pays its row");
        assertEq(usdc.balanceOf(feeReceiver) - _feeBefore, FEE, "the lone row bills the whole fee");
    }

    function test_a_row_that_would_mint_no_shares_is_skipped_and_pulls_nothing() public {
        _openFund();
        uint _t0 = vm.getBlockTimestamp();
        (address[] memory _users, uint[] memory _keys) = _cohort("dust-", 3);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, _t0 + 365 days);
        address[3] memory _p;
        for (uint _j; _j < 3; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            _mandateCall(_users[_j], _keys[_j], _list(_m));
            _p[_j] = _account(_users[_j]);
            _wethTo(_p[_j], 1000 ether);
        }
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p[0], 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        FundStore.Holding memory _held = fundStore.getHolding(body, _p[0]);
        uint _stake = shareToken.balanceOf(_p[0]);

        usdc.mint(body, 10 * usdc.balanceOf(body));
        vm.warp(_t0 + 1 hours);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](3);
        _rows[0] = _row(_p[0], 11);
        _rows[1] = _row(_p[1], 11);
        _rows[2] = _row(_p[2], 300 ether);
        (_i, _sig) = _roundIn(address(wnt), Fund.Price({amount: 1 ether, value: ETH_USD * USD}), _noCredit(), _rows);
        _i.header.fee = 3;
        _sig = _pair(masterKey, _allocateDigest(_i));
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        assertEq(Math.mulDiv(11 - 1, _supply, _nav), 0, "a dust row nets less than one share is worth");
        uint _feeBefore = wnt.balanceOf(feeReceiver);
        uint _bodyBefore = wnt.balanceOf(body);
        hub.allocate(_i, _sig, _ownerCoSig(_i));

        FundStore.Holding memory _after = fundStore.getHolding(body, _p[0]);
        assertEq(wnt.balanceOf(_p[0]), 1000 ether, "a holder's zero-share row pulls nothing");
        assertEq(shareToken.balanceOf(_p[0]), _stake, "mints nothing");
        assertEq(_after.allocatedAt, _held.allocatedAt, "keeps its holding's stamp");
        assertEq(_after.cost, _held.cost, "and its cost");
        assertEq(wnt.balanceOf(_p[1]), 1000 ether, "a newcomer's zero-share row pulls nothing either");
        assertEq(fundStore.getHolding(body, _p[1]).allocatedAt, 0, "and opens no holding");
        assertEq(
            shareToken.balanceOf(_p[2]),
            Math.mulDiv(300 ether - 1, _supply, _nav),
            "the round still mints the row that buys shares"
        );
        assertEq(wnt.balanceOf(_p[2]), 700 ether, "which pays its row");
        assertEq(wnt.balanceOf(feeReceiver) - _feeBefore, 1, "only the minted row's slice is billed");
        assertEq(wnt.balanceOf(body) - _bodyBefore, 300 ether - 1, "and the body keeps the rest");
    }

    function test_credit_slice_is_capped_at_a_tenth_of_the_credit_whatever_the_rows_do() public {
        _openFund();
        _escrowOnHub(address(usdc), 5e6);
        uint _t0 = vm.getBlockTimestamp();
        MandateLib.Mandate memory _good = _mandateOf(MAX_SKIN, 0, _t0 + 365 days);
        MandateLib.Mandate memory _expiring = _mandateOf(MAX_SKIN, 0, _t0 + 1);
        (address _q,,) = _backer("credit-good", _good);
        (address _p,,) = _backer("credit-expiring", _expiring);

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 1e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, FEE, 1e6, 1000));
        hub.allocate(_i, _sig, _ownerSig);

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 5e6 - 1), _one(_q, 100e6));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, FEE / 2, 5e6 - 1, 1000));
        hub.allocate(_i, _sig, _ownerSig);

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 5e6), _one(_p, 100e6));
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        uint _bodyBefore = usdc.balanceOf(body);
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        uint _sharesBefore = shareToken.balanceOf(body);
        uint _held = usdc.balanceOf(_p);
        vm.warp(_t0 + 1);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(usdc.balanceOf(_p), _held, "a mandate that expired after signing skips its row");
        assertEq(shareToken.balanceOf(_p), 0, "and mints nothing for it");
        assertEq(usdc.balanceOf(feeReceiver) - _feeBefore, FEE / 2, "the master leg pays only its own slice");
        assertEq(usdc.balanceOf(body) - _bodyBefore, 4.5e6, "the body keeps the credit net of that slice");
        assertEq(
            shareToken.balanceOf(body) - _sharesBefore,
            Math.mulDiv(4.5e6 * USD, _supply, _nav),
            "the master mints on the credit above its slice, a slice of exactly a tenth being allowed"
        );
        assertEq(
            hubEscrowStore.releasedMap(_account(master), address(usdc)),
            SEED + 5e6,
            "the whole credit leaves the hub escrow, its slice paid out of it"
        );
    }

    function test_all_rows_skipped_without_credit_reverts_zero_amount() public {
        _openFund();
        (address[] memory _users, uint[] memory _keys) = _cohort("all-skip-", 2);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        for (uint _j; _j < 2; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            _mandateCall(_users[_j], _keys[_j], _list(_m));
            _rows[_j] = _row(_account(_users[_j]), _j == 0 ? 1e6 : 100e6);
        }
        vm.prank(_users[1]);
        UserAccount(payable(_rows[1].puppet)).revokeSessions();
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
    }

    function test_cooldown_reverts_with_exact_args_until_the_period_elapses() public {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 1 days, vm.getBlockTimestamp() + 365 days);
        (address _p,,) = _backer("cooldown", _m);
        Fund.Allocation[] memory _rows = _one(_p, 20e6);

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _t0 = vm.getBlockTimestamp();
        assertEq(fundStore.getHolding(body, _p).allocatedAt, _t0, "the first round starts the cooldown");

        vm.warp(_t0 + 1 days - 1);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__Cooldown.selector, _p, _t0, 1 days));
        hub.allocate(_i, _sig, _ownerSig);

        vm.warp(_t0 + 1 days);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        FundStore.Holding memory _h = fundStore.getHolding(body, _p);
        assertEq(_h.allocatedAt, _t0 + 1 days, "the round at the period boundary lands and restarts the cooldown");
    }

    function test_cooldown_near_max_reverts_typed_and_orders_between_fee_skip_and_transfer_skip() public {
        _openFund();
        _escrowOnHub(address(usdc), 50e6);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, type(uint).max, type(uint).max);
        (address _p,,) = _backer("cooldown-max", _m);

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, 20e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _t0 = vm.getBlockTimestamp();

        vm.warp(_t0 + 36_500 days);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, 20e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__Cooldown.selector, _p, _t0, type(uint).max));
        hub.allocate(_i, _sig, _ownerSig);

        uint _sharesBefore = shareToken.balanceOf(_p);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 50e6), _one(_p, 1e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_p), _sharesBefore, "a row over the fee cap skips before its cooldown is read");
        assertEq(fundStore.getHolding(body, _p).allocatedAt, _t0, "and leaves the cooldown untouched");
    }

    function test_unsorted_or_duplicate_rows_revert_even_when_the_offender_would_skip() public {
        _openFund();
        (address[] memory _users, uint[] memory _keys) = _cohort("sorted-", 2);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        address[2] memory _acct;
        for (uint _j; _j < 2; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            _mandateCall(_users[_j], _keys[_j], _list(_m));
            _acct[_j] = _account(_users[_j]);
        }
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);

        _rows[0] = _row(_acct[1], 100e6);
        _rows[1] = _row(_acct[0], 100e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__AllocationListNotSorted.selector, _acct[1], _acct[0]));
        hub.allocate(_i, _sig, _ownerSig);

        _rows[0] = _row(_acct[0], 100e6);
        _rows[1] = _row(_acct[0], 100e6);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__AllocationListNotSorted.selector, _acct[0], _acct[0]));
        hub.allocate(_i, _sig, _ownerSig);

        _rows[0] = _row(_acct[1], 1e6);
        _rows[1] = _row(_acct[0], 100e6);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__AllocationListNotSorted.selector, _acct[1], _acct[0]));
        hub.allocate(_i, _sig, _ownerSig);

        _rows[0] = _row(_acct[0], 100e6);
        _rows[1] = _row(_acct[1], 100e6);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_acct[0]), 99.5e18, "the sorted pair lands, each row carrying half the fee");
        assertEq(shareToken.balanceOf(_acct[1]), 99.5e18, "the sorted pair lands, each row carrying half the fee");
    }

    function test_non_canonical_round_token_reverts_and_the_list_is_read_when_the_round_executes() public {
        _openFund();
        _escrowOnHub(address(usdc), 10e6);
        MockERC20 _stray = new MockERC20("STRAY", "STRAY", 6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _roundIn(
            address(_stray), _usdcPrice(), _credit(block.chainid, address(_stray), 10e6), new Fund.Allocation[](0)
        );
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__TokenNotCanonical.selector, address(_stray)));
        hub.allocate(_i, _sig, _ownerSig);

        address _impl =
            address(uint160(uint(vm.load(address(hub), bytes32(uint(keccak256("eip1967.proxy.implementation")) - 1)))));
        address _wethOnly = address(
            new HubGate(
                accountModule,
                depositModule,
                hubEscrowStore,
                fundModule,
                redeemModule,
                hub.getConfig(),
                _endpoints(ATTESTOR_ENDPOINT),
                _list(address(wnt)),
                50,
                PERFORMANCE_FEE,
                WEBSITE_RELEASE
            )
        );
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 10e6), new Fund.Allocation[](0));
        vm.prank(address(governorAccount));
        RouterProxy(payable(address(hub))).upgrade(_wethOnly);
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__TokenNotCanonical.selector, address(usdc)));
        hub.allocate(_i, _sig, _ownerSig);

        vm.prank(address(governorAccount));
        RouterProxy(payable(address(hub))).upgrade(_impl);
        uint _held = usdc.balanceOf(_account(master));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            hubEscrowStore.releasedMap(_account(master), address(usdc)),
            SEED + 10e6,
            "the canonical list is read when the round executes, so the same signed round lands once listed again"
        );
        assertEq(usdc.balanceOf(_account(master)), _held, "out of the hub escrow, not the owner's account");
    }

    function test_native_is_never_a_round_token_and_weth_rows_pull_wrapped() public {
        _openFund();
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _roundIn(
            NATIVE_TOKEN,
            Fund.Price({amount: 1 ether, value: ETH_USD * USD}),
            _credit(block.chainid, NATIVE_TOKEN, 1 ether),
            new Fund.Allocation[](0)
        );
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__TokenNotCanonical.selector, NATIVE_TOKEN));
        hub.allocate(_i, _sig, _ownerSig);

        (address[] memory _users, uint[] memory _keys) = _cohort("weth-", 2);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        for (uint _j; _j < 2; ++_j) {
            _fundWallet(_users[_j], 1e6);
            _mandateCall(_users[_j], _keys[_j], _list(_m));
            _wethTo(_account(_users[_j]), 12_000 ether);
            _rows[_j] = _row(_account(_users[_j]), 300 ether);
        }
        uint _bodyBefore = wnt.balanceOf(body);
        (_i, _sig) = _roundIn(address(wnt), Fund.Price({amount: 1 ether, value: 1 ether + 1}), _noCredit(), _rows);
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__UnitPriceMismatch.selector, 1 ether, 1 ether + 1));
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _roundIn(address(wnt), Fund.Price({amount: 1 ether, value: ETH_USD * USD}), _noCredit(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        for (uint _j; _j < 2; ++_j) {
            assertGt(shareToken.balanceOf(_rows[_j].puppet), 0, "a WETH row mints its backer");
        }
        assertGt(wnt.balanceOf(body), _bodyBefore, "and the rows' WETH lands in the body");
    }

    function test_local_credit_must_be_in_the_round_token_and_foreign_credit_moves_nothing_on_the_hub() public {
        _openFund();
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(outToken), 100e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(
            abi.encodeWithSelector(Error.Fund__CreditTokenMismatch.selector, address(outToken), address(usdc))
        );
        hub.allocate(_i, _sig, _ownerSig);

        address _owner = _account(master);
        _escrowOnHub(address(usdc), 100e6);
        uint _bodyBefore = usdc.balanceOf(body);
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        uint _ownerHeld = usdc.balanceOf(_owner);
        uint _storeHeld = usdc.balanceOf(address(hubEscrowStore));
        uint _sharesBefore = shareToken.balanceOf(body);
        (_i, _sig) = _round(_usdcPrice(), _credit(FOREIGN_CHAIN_ID, address(outToken), 100e6), new Fund.Allocation[](0));
        uint _ownerNonce = _nonceOf(_owner);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            _nonceOf(_owner),
            _ownerNonce,
            "a foreign credit is a signed total and spends no nonce of the owner's account"
        );
        assertEq(
            shareToken.balanceOf(body) - _sharesBefore,
            99e18,
            "a foreign credit mints the master on its value net of the signed fee"
        );
        FundStore.Credit memory _kept = fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(outToken));
        assertEq(_kept.total, 100e6, "the hub keeps the signed total for the spoke to settle");
        assertEq(_kept.feeTotal, FEE, "beside the signed fee total");

        _sharesBefore = shareToken.balanceOf(body);
        (_i, _sig) = _round(_usdcPrice(), _credit(FOREIGN_CHAIN_ID, address(usdc), 100e6), new Fund.Allocation[](0));
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            shareToken.balanceOf(body) - _sharesBefore,
            Math.mulDiv(100e6 * USD - FEE_VALUE, _supply, _nav),
            "a foreign credit in the round token mints the same way"
        );
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)),
            SEED,
            "and leaves the open hub escrow in that token alone"
        );
        assertEq(hubEscrowStore.fulfilledMap(_owner, body, address(usdc)), SEED, "fulfilling nothing for the body here");
        assertEq(usdc.balanceOf(address(hubEscrowStore)), _storeHeld, "the hub escrow pays nothing out");
        assertEq(usdc.balanceOf(_owner), _ownerHeld, "nor does the owner's account");
        assertEq(usdc.balanceOf(body), _bodyBefore, "nothing moves on the hub for a foreign credit");
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore, "and the hub bills nothing it cannot collect here");
    }

    function test_a_local_credit_releases_from_the_owners_hub_escrow_and_never_beyond_it() public {
        _openFund();
        address _owner = _account(master);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,,) = _backer("escrow-x", _m);
        _escrowOnHub(address(usdc), 200e6);
        _retireEscrow(LiquidityGate(address(hub)), hubEscrowStore, address(usdc), 100e6);
        assertEq(
            hubEscrowStore.escrowedMap(_owner, address(usdc)),
            SEED + 300e6,
            "the wallet and the account escrow into one hub ledger"
        );

        uint _ownerHeld = usdc.balanceOf(_owner);
        uint _ownerNonce = _nonceOf(_owner);
        uint _storeHeld = usdc.balanceOf(address(hubEscrowStore));
        uint _bodyBefore = usdc.balanceOf(body);
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        uint _masterShares = shareToken.balanceOf(body);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 300e6), _one(_x, 100e6));
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        hub.allocate(_i, _sig, _ownerCoSig(_i));

        uint _masterBilled = Math.mulDiv(FEE_VALUE / 2, 1e6, 1e6 * USD);
        assertEq(hubEscrowStore.escrowedMap(_owner, address(usdc)), SEED + 300e6, "the escrowed total stands");
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)), SEED + 300e6, "the released total grows by the credit"
        );
        assertEq(
            hubEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            SEED + 300e6,
            "and so does the body's fulfilled total"
        );
        assertEq(hubEscrowStore.heldMap(address(usdc)), 0, "the store owes nothing more");
        assertEq(usdc.balanceOf(address(hubEscrowStore)), _storeHeld - 300e6, "having paid out exactly the credit");
        assertEq(
            usdc.balanceOf(feeReceiver) - _feeBefore,
            _masterBilled + FEE / 2,
            "the master's slice and the row's slice are billed"
        );
        assertEq(
            usdc.balanceOf(body) - _bodyBefore,
            300e6 - _masterBilled + 100e6 - FEE / 2,
            "the body receives the credit and the row, each net of its slice"
        );
        assertEq(usdc.balanceOf(_owner), _ownerHeld, "the owner's account balance is untouched");
        assertEq(_nonceOf(_owner), _ownerNonce, "and so is its nonce, the owner's consent being a signed total");
        assertEq(
            shareToken.balanceOf(body) - _masterShares,
            Math.mulDiv(300e6 * USD - FEE_VALUE / 2, _supply, _nav),
            "the master mints on the released credit"
        );

        _escrowOnHub(address(usdc), 50e6);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 50e6 + 1), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 50e6, 50e6 + 1));
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 50e6), new Fund.Allocation[](0));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)), SEED + 350e6, "a credit of exactly the open escrow lands"
        );
    }

    function test_cohort_cap_refuses_a_hundred_and_one_rows_and_admits_a_hundred() public {
        _openFund();
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _dustRows(101));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Gate__ListTooLong.selector, 101, 100));
        hub.allocate(_i, _sig, _ownerSig);

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _dustRows(100));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
    }

    function _dustRows(
        uint _n
    ) internal returns (Fund.Allocation[] memory rows_) {
        rows_ = new Fund.Allocation[](_n);
        for (uint _j; _j < _n; ++_j) {
            address _acct = _account(makeAddr(string.concat("dust-row-", vm.toString(_j))));
            uint _k = _j;
            while (_k > 0 && uint160(rows_[_k - 1].puppet) > uint160(_acct)) {
                rows_[_k] = rows_[_k - 1];
                --_k;
            }
            rows_[_k] = _row(_acct, 1);
        }
    }

    function test_mandate_skin_above_the_bound_is_refused_at_mandate() public {
        _openFund();
        (address _user, uint _key) = makeAddrAndKey("skin-cap");
        _fundWallet(_user, 10e6);
        address _acct = _account(_user);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN + 1, 0, vm.getBlockTimestamp() + 365 days);
        (HubGate.MandateIntent memory _i, bytes memory _sig) = _mandateIntent(_user, _key, _list(_m));
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__InvalidSkin.selector, MAX_SKIN + 1));
        hub.mandate(_i, _sig);
        assertEq(mandateStore.mandateMap(_acct, body), bytes32(0), "nothing is committed for the refused skin");

        _m.skin = MAX_SKIN;
        _m.exitCap = 10_001;
        (_i, _sig) = _mandateIntent(_user, _key, _list(_m));
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__InvalidExitCap.selector, 10_001));
        hub.mandate(_i, _sig);

        _m.exitCap = 10_000;
        _mandateCall(_user, _key, _list(_m));
        assertEq(
            mandateStore.mandateMap(_acct, body),
            keccak256(abi.encode(_m, uint(0))),
            "the bounds themselves are accepted"
        );
    }

    function test_a_round_and_a_redemption_priced_off_one_eth_per_usdc_keep_their_units() public {
        _openFund();
        Fund.Price memory _price = Fund.Price({amount: 1e6, value: 4e14});
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _acct, uint _key, address _user) = _backer("usdc-rate", _m);
        uint _bodyUsdc = usdc.balanceOf(body);
        uint _fees = usdc.balanceOf(feeReceiver);
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _worth = Math.mulDiv(_bodyUsdc, _price.value, _price.amount) / USD;
        (Fund.AllocateIntent memory _i,) = _round(_price, _noCredit(), _one(_acct, 400e6));
        _i.header.fee = 1e15;
        _i.valuation = _valuation(_worth);
        hub.allocate(_i, _pair(masterKey, _allocateDigest(_i)), _ownerCoSig(_i));
        uint _value = Math.mulDiv(400e6, _price.value, _price.amount);
        uint _shares = Math.mulDiv(_value - 1e15, _supply, _worth * USD + VIRTUAL_VALUE);
        assertEq(
            shareToken.balanceOf(_acct), _shares, "a backer is minted on its stake's ETH value, not its USDC count"
        );
        assertEq(
            usdc.balanceOf(feeReceiver) - _fees, 2.5e6, "the 0.001 ETH slice is billed as 2.5 USDC at 0.0004 ETH each"
        );
        assertEq(usdc.balanceOf(body) - _bodyUsdc, 400e6 - 2.5e6, "the stake lands in the body net of that fee");
        assertEq(
            fundStore.getHolding(body, _acct).cost,
            (_value - 1e15) * PRICE_PRECISION / _shares,
            "and the holding keeps its cost in ETH per share"
        );

        _sell(_user, _key, _shares);
        uint _held = usdc.balanceOf(body);
        Fund.Valuation memory _v;
        _v.assetList = new Fund.Asset[](1);
        _v.assetList[0] = Fund.Asset({
            chainId: block.chainid,
            token: address(usdc),
            id: 0,
            amount: _held,
            value: Math.mulDiv(_held, _price.value, _price.amount)
        });
        Redeem.RedeemIntent memory _r = Redeem.RedeemIntent({
            header: _fundHeader(_nonceOf(body)),
            shareToken: shareToken,
            valuation: _v,
            token: address(usdc),
            fraction: 0,
            join: 0
        });
        _r.header.feeToken = address(usdc);
        _r.header.fee = 2.5e6;
        uint _base = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _pot = Math.mulDiv(
            _shares, Math.mulDiv(_v.assetList[0].value + VIRTUAL_VALUE, _price.amount, _price.value), _base
        );
        uint _paid = usdc.balanceOf(_acct);
        _fees = usdc.balanceOf(feeReceiver);
        address[] memory _queue = new address[](1);
        _queue[0] = _acct;
        hub.redeem(_r, _redeemSig(_r), _queue);
        assertEq(
            usdc.balanceOf(_acct) - _paid,
            _pot - 2.5e6,
            "the seller is paid its share of the USDC nav, at the ETH rate, less one USDC fee"
        );
        assertEq(usdc.balanceOf(feeReceiver) - _fees, 2.5e6, "the fee is charged in USDC");
        assertEq(_held - usdc.balanceOf(body), _pot, "exactly the pot leaves the body");
        assertEq(usdc.balanceOf(address(fundStore)), 0, "and the store keeps nothing");
    }

    function test_a_live_mandate_with_a_zero_rate_or_exit_cap_is_refused_while_a_clearing_is_not() public {
        _openFund();
        (address _user, uint _key) = makeAddrAndKey("zero-terms");
        _fundWallet(_user, 10e6);
        address _acct = _account(_user);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        _m.allocationRate = 0;
        (HubGate.MandateIntent memory _i, bytes memory _sig) = _mandateIntent(_user, _key, _list(_m));
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__InvalidAllocationRate.selector, 0));
        hub.mandate(_i, _sig);

        _m.allocationRate = 5000;
        _m.exitCap = 0;
        (_i, _sig) = _mandateIntent(_user, _key, _list(_m));
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__InvalidExitCap.selector, 0));
        hub.mandate(_i, _sig);
        assertEq(
            mandateStore.mandateMap(_acct, body),
            bytes32(0),
            "a live mandate that could never allocate or exit is not committed"
        );

        _m.exitCap = 10_000;
        _mandateCall(_user, _key, _list(_m));
        assertEq(
            mandateStore.mandateMap(_acct, body),
            keccak256(abi.encode(_m, uint(0))),
            "the same terms with both rates set are committed"
        );

        _m.allocationRate = 0;
        _m.exitCap = 0;
        _m.expiry = 0;
        _mandateCall(_user, _key, _list(_m));
        assertEq(
            mandateStore.mandateMap(_acct, body),
            bytes32(0),
            "a clearing may carry zero rates and clears the commitment"
        );
    }

    function test_a_mandate_commits_each_masters_terms_under_the_backers_epoch_while_an_expiry_at_or_before_now_clears_them()
        public
    {
        _openFund();
        uint _t0 = vm.getBlockTimestamp();
        (address _user, uint _key) = makeAddrAndKey("commit-x");
        _fundWallet(_user, 1000e6);
        address _x = _account(_user);
        address _other = makeAddr("commit-other-master");
        bool _bodyFirst = uint160(body) < uint160(_other);
        MandateLib.Mandate memory _a = _mandateOf(MAX_SKIN, 1 hours, _t0 + 365 days);
        MandateLib.Mandate memory _b = _mandateOf(5000, 0, _t0 + 30 days);
        _b.master = _other;
        MandateLib.Mandate[] memory _both = new MandateLib.Mandate[](2);
        (_both[0], _both[1]) = _bodyFirst ? (_a, _b) : (_b, _a);
        vm.recordLogs();
        _mandateCall(_user, _key, _both);
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        assertEq(
            mandateStore.mandateMap(_x, body),
            keccak256(abi.encode(_a, uint(0))),
            "the hub commits to the fund's terms by digest, under the backer's epoch"
        );
        assertEq(
            mandateStore.mandateMap(_x, _other),
            keccak256(abi.encode(_b, uint(0))),
            "and to another master's beside them"
        );

        uint _k;
        while (
            _logs[_k].topics[0] != AccountModule.AccountCall.selector
                || _logs[_k].topics[2] != bytes32(uint(uint160(address(hub))))
        ) {
            ++_k;
        }
        (,,,,, bytes memory _data, IAccount.Call[] memory _legs,,) = abi.decode(
            _logs[_k].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_logs[_k].topics[1], bytes32(uint(uint160(_x))), "the mandate is recorded on the backer's account");
        assertEq(_data, this.mandateRecordOf(_both), "carrying the signed epoch, the signed list and the relay fee");
        assertEq(_legs.length, 1, "the account runs the relay fee leg alone");
        assertEq(_legs[0].target, address(usdc), "in the fee token");
        assertEq(_legs[0].callData, abi.encodeCall(IERC20.transfer, (feeReceiver, FEE)), "paying the relay fee");

        MandateLib.Mandate memory _lapsing = _mandateOf(MAX_SKIN, 1 hours, _t0);
        _lapsing.allocationRate = 0;
        _lapsing.exitCap = 0;
        MandateLib.Mandate memory _renewed = _mandateOf(2500, 0, _t0 + 60 days);
        _renewed.master = _other;
        (_both[0], _both[1]) = _bodyFirst ? (_lapsing, _renewed) : (_renewed, _lapsing);
        _mandateCall(_user, _key, _both);
        assertEq(
            mandateStore.mandateMap(_x, body),
            bytes32(0),
            "an expiry of exactly now clears the fund's commitment, zero rates being allowed on a clearing"
        );
        assertEq(
            mandateStore.mandateMap(_x, _other),
            keccak256(abi.encode(_renewed, uint(0))),
            "while new terms replace the other master's in the same intent"
        );

        MandateLib.Mandate memory _next = _mandateOf(MAX_SKIN, 0, _t0 + 1);
        _mandateCall(_user, _key, _list(_next));
        assertEq(
            mandateStore.mandateMap(_x, body),
            keccak256(abi.encode(_next, uint(0))),
            "an expiry one second ahead is live and committed"
        );

        MandateLib.Mandate memory _gone = _mandateOf(0, 0, 0);
        _gone.master = _other;
        _gone.allocationRate = 0;
        _gone.exitCap = 0;
        _mandateCall(_user, _key, _list(_gone));
        assertEq(
            mandateStore.mandateMap(_x, _other), bytes32(0), "an expiry of zero clears the other master's commitment"
        );
        assertEq(
            mandateStore.mandateMap(_x, body),
            keccak256(abi.encode(_next, uint(0))),
            "leaving the fund's commitment standing"
        );
    }

    function test_a_backers_wallet_revoke_stops_its_mandates_and_rounds_skip_it_until_it_registers_one_in_the_new_epoch()
        public
    {
        _openFund();
        _escrowOnHub(address(usdc), 200e6);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x, uint _key, address _user) = _backer("revoke-x", _m);
        UserAccount _ua = UserAccount(payable(_x));
        address[4] memory _callers = [makeAddr("revoke-stranger"), body, address(hub), address(accountModule)];
        uint _epoch = _ua.epoch();
        for (uint _k; _k < 4; ++_k) {
            vm.prank(_callers[_k]);
            vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
            _ua.revokeSessions();
        }
        assertEq(_ua.epoch(), _epoch, "neither a stranger, the fund, a gate nor the module revokes for the backer");

        uint _held = usdc.balanceOf(_x);
        uint _revokedAt = vm.getBlockTimestamp();
        vm.recordLogs();
        vm.prank(_user);
        _ua.revokeSessions();
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        assertEq(_ua.epoch(), _epochAfterRevoke(_epoch), "the backer's own wallet revokes, advancing the epoch");
        assertTrue(_ua.epoch() != _epoch, "off the epoch its mandate was registered in");
        assertEq(
            mandateStore.mandateMap(_x, body),
            keccak256(abi.encode(_m, uint(0))),
            "while the hub's commitment stands under the epoch the backer left"
        );
        assertEq(usdc.balanceOf(_x), _held, "with no relay fee and no attestor");
        assertEq(_logs.length, 1, "one record");
        assertEq(_logs[0].topics[1], bytes32(uint(uint160(_x))), "on the backer's account");
        assertEq(_logs[0].topics[2], bytes32(uint(uint160(_x))), "written by the account itself");
        (,,, bytes32 _digest,, bytes memory _data,,,) = abi.decode(
            _logs[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, bytes32(0), "under no signature: the caller is the user");
        assertEq(_data, abi.encode(UserAccount.revokeSessions.selector, _ua.epoch()), "carrying the new epoch");

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 200e6), _one(_x, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), 0, "the next round skips the backer on its stale commitment");
        assertEq(usdc.balanceOf(_x), _held, "and pulls nothing from it");

        vm.warp(_revokedAt + 2 * SESSION_REVOKE_DELAY);
        _mandateCall(_user, _key, _list(_m));
        assertEq(
            mandateStore.mandateMap(_x, body),
            keccak256(abi.encode(_m, _ua.epoch())),
            "a mandate registered after the revoke commits the same terms under the new epoch"
        );
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_x), 0, "so the next round pulls the backer's row again");
        assertEq(usdc.balanceOf(_x), _held - FEE - 100e6, "paying the new mandate's relay fee and the row");
    }

    function test_a_backers_wallet_revokes_only_outside_its_own_dispatch_and_the_next_round_skips_it() public {
        _openFund();
        _escrowOnHub(address(usdc), 100e6);
        (address _user, uint _key) = makeAddrAndKey("revoking-wallet");
        UserAccount _ua = UserAccount(payable(accountModule.predictUserAccount(_user)));
        vm.etch(_user, address(new RevokingWallet(_ua)).code);
        vm.deal(_user, 1 ether);
        vm.prank(_user);
        hub.deposit{value: 1 ether}(NATIVE_TOKEN, 1 ether);
        _fundWallet(_user, 1000e6);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        _mandateCall(_user, _key, _list(_m));
        assertEq(
            mandateStore.mandateMap(address(_ua), body),
            keccak256(abi.encode(_m, uint(0))),
            "a contract wallet's account commits to the fund"
        );

        Deposit.SwapIntent memory _w = Deposit.SwapIntent({
            header: _header(address(_ua), _user, _ua.nonce()),
            swap: SwapLib.SwapParams({
                inputToken: NATIVE_TOKEN,
                inputAmount: 0.5 ether,
                outputToken: NATIVE_TOKEN,
                outputAmount: 0.5 ether - 1e15,
                provider: address(0),
                providerCallData: ""
            }),
            destinationChainId: block.chainid
        });
        _w.header.feeToken = NATIVE_TOKEN;
        _w.header.fee = 1e15;
        _w.header.deadline = vm.getBlockTimestamp() + 300;
        bytes memory _wSig = _swapSig(WITHDRAW_INTENT_TYPEHASH, _key, address(_ua), _w);
        uint _epoch = _ua.epoch();
        vm.expectRevert(Error.Account__Executing.selector);
        hub.withdraw(_w, _wSig);
        assertEq(_ua.epoch(), _epoch, "the wallet cannot revoke inside the account's own dispatch");
        assertEq(address(_ua).balance, 1 ether, "and the dispatch it tried it in never landed");

        vm.prank(_user);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), _epochAfterRevoke(_epoch), "the same revoke lands from the wallet outside a dispatch");
        assertTrue(_ua.epoch() != _epoch, "off the epoch its mandate was registered in");

        uint _held = usdc.balanceOf(address(_ua));
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 100e6), _one(address(_ua), 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(address(_ua)), 0, "after which the round skips the backer");
        assertEq(usdc.balanceOf(address(_ua)), _held, "pulling nothing");
    }

    function test_any_dispatcher_moves_one_plain_value_zero_transfer_of_any_amount_to_any_destination_and_no_other_shape()
        public
    {
        _openFund();
        address _user = makeAddr("pull-x");
        _fundWallet(_user, 1000e6);
        address _x = _account(_user);
        vm.deal(_x, 1 ether);
        uint _held = usdc.balanceOf(_x);
        address _hostile = makeAddr("hostile-dispatcher");
        vm.prank(address(governorAccount));
        accountModule.setAccess(_hostile, AccountModule.dispatch.selector);
        uint _deadline = vm.getBlockTimestamp() + 300;

        IAccount.Call[] memory _double = new IAccount.Call[](2);
        _double[0] = CallLib.pay(address(usdc), body, 1, 0);
        _double[1] = CallLib.pay(address(usdc), _hostile, 1, 0);
        vm.prank(_hostile);
        vm.expectRevert(Error.Account__ForbiddenPull.selector);
        accountModule.dispatch(IAccount(_x), address(0), bytes32(0), _deadline, "", "", _double, new address[](0));

        vm.prank(_hostile);
        vm.expectRevert(Error.Account__ForbiddenPull.selector);
        accountModule.dispatch(
            IAccount(_x), address(0), bytes32(0), _deadline, "", "", new IAccount.Call[](0), new address[](0)
        );

        IAccount.Call[] memory _pull = new IAccount.Call[](1);
        _pull[0] = IAccount.Call({
            target: _hostile, value: 1 ether, gasLimit: 0, callData: abi.encodeCall(IERC20.transfer, (body, 0))
        });
        vm.prank(_hostile);
        vm.expectRevert(Error.Account__ForbiddenPull.selector);
        accountModule.dispatch(IAccount(_x), address(0), bytes32(0), _deadline, "", "", _pull, new address[](0));

        _pull[0] = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: 0,
            callData: abi.encodeCall(IERC20.approve, (_hostile, type(uint).max))
        });
        vm.prank(_hostile);
        vm.expectRevert(Error.Account__ForbiddenPull.selector);
        accountModule.dispatch(IAccount(_x), address(0), bytes32(0), _deadline, "", "", _pull, new address[](0));

        assertEq(usdc.balanceOf(_x), _held, "no refused shape moved a token");
        assertEq(_x.balance, 1 ether, "nor native");
        assertEq(usdc.allowance(_x, _hostile), 0, "nor left an allowance");

        _pull[0] = CallLib.pay(address(usdc), _hostile, 1, 0);
        vm.prank(_hostile);
        accountModule.dispatch(IAccount(_x), address(0), bytes32(0), _deadline, "", "", _pull, new address[](0));
        assertEq(
            usdc.balanceOf(_hostile),
            1,
            "one plain transfer lands wherever it points, the dispatcher itself included: its destination is Fund's to bound"
        );

        vm.prank(_user);
        UserAccount(payable(_x)).revokeSessions();
        uint _bodyBefore = usdc.balanceOf(body);
        _pull[0] = CallLib.pay(address(usdc), body, _held - 1, 0);
        vm.prank(_hostile);
        accountModule.dispatch(IAccount(_x), address(0), bytes32(0), _deadline, "", "", _pull, new address[](0));
        assertEq(
            usdc.balanceOf(_x),
            0,
            "and so does one moving the whole balance after a revoke: the account bounds no amount, the revoke binds Fund's commitments"
        );
        assertEq(usdc.balanceOf(body) - _bodyBefore, _held - 1, "every unit of it reaching that destination");
    }

    function test_exit_cap_tapers_a_backers_stake_with_the_queue_and_freezes_it_until_the_master_drains() public {
        _openFund();
        (address _a, uint _aKey, address _aUser) =
            _backer("exit-a", _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days));
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_a, 400e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.totalSupply(), 898e18, "the backer joins beside the master");
        _sell(_aUser, _aKey, 89.8e18);
        assertEq(fundStore.getRedemption(body).queued, 89.8e18, "a tenth of the supply waits to exit");

        MandateLib.Mandate memory _tapered = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        _tapered.exitCap = 2000;
        (address _b,,) = _backer("exit-b", _tapered);
        uint _stake = usdc.balanceOf(_b) / 4;
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_b, _stake + 1));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_b, _stake));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_b), 0, "10% exiting against a 20% cap halves the half-balance rate cap");

        MandateLib.Mandate memory _frozen = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        _frozen.exitCap = 1000;
        (address _c,,) = _backer("exit-c", _frozen);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_c, 1e6 + FEE));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);

        _wethTo(body, 3000 ether);
        _redeem(0, 0, _list(_a));
        assertEq(fundStore.getRedemption(body).queued, 0, "the master clears the whole queue");
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_c, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_c), 0, "a cleared queue lets the frozen backer in again");
    }

    function test_a_first_fund_opens_on_a_spoke_escrow_before_its_owner_exists_on_the_hub() public {
        (address _user, uint _userKey) = makeAddrAndKey("spoke-only-owner");
        (address _body, uint _bodyKey) = makeAddrAndKey("spoke-only-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _bodyKey);
        address _owner = accountModule.predictUserAccount(_user);
        assertEq(_owner.code.length, 0, "the owner has only escrowed on a spoke, never touched the hub");
        bytes32 _symbol = bytes32("SE");
        bytes memory _pixels = new bytes(GRID_BYTES);
        Fund.AllocateIntent memory _i;
        _i.header = _header(_body, _user, 0);
        _i.header.feeToken = address(wnt);
        _i.header.fee = FEE * USD;
        _i.shareToken = ShareToken(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(_body, _symbol, _pixels, uint16(hub.performanceFee())),
                bytes32(uint(uint160(_body))),
                address(hub)
            )
        );
        _i.valuation = _valuation(0);
        _i.token = address(usdc);
        _i.price = _usdcPrice();
        _i.credit = Fund.Credit({chainId: FOREIGN_CHAIN_ID, token: address(usdc), total: 100e6, feeTotal: FEE});
        _i.allocationList = new Fund.Allocation[](0);
        bytes32 _structHash = _allocateStructHash(_i);
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), _body, _owner);
        hub.createFund(
            _symbol,
            _pixels,
            _coSig(_bodyKey, _genesis),
            _fundApproval(_userKey, _body),
            _i,
            _pair(_userKey, _typed(_body, _i.header.deadline, _structHash)),
            _coSig(_userKey, AccountLib.creditDigest(_owner, _body, FOREIGN_CHAIN_ID, address(usdc), 100e6, FEE))
        );
        assertGt(_owner.code.length, 0, "createFund creates the owner account in the same transaction");
        assertEq(
            _nonceOf(_owner),
            0,
            "the owner signed a credit total against the account before it existed, spending no nonce"
        );
        assertEq(
            fundStore.getCredit(_body, FOREIGN_CHAIN_ID, address(usdc)).total,
            100e6,
            "the hub keeps that total for the spoke"
        );
        assertGt(_i.shareToken.balanceOf(_body), 0, "minting the master on the spoke escrow alone");
    }

    function test_allocation_rate_paces_each_round_on_the_backers_balance() public {
        _openFund();
        _escrowOnHub(address(usdc), 1100e6);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,,) = _backer("rate-x", _m);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), 99e18, "the first round takes 100 of the backer's balance");
        assertEq(usdc.balanceOf(_x), 899e6, "leaving 899 after the mandate's relay fee");

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 1000e6), _one(_x, 449.5e6 + 1));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), 99e18, "a round above half of the 899 left is skipped");
        assertEq(usdc.balanceOf(_x), 899e6, "and pulls nothing");

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 449.5e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_x), 99e18, "half of the balance joins, whatever the backer already holds");
        assertEq(usdc.balanceOf(_x), 449.5e6);

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 100e6), _one(_x, 224.75e6 + 1));
        uint _held = shareToken.balanceOf(_x);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), _held, "the next round's room halves with the balance");
    }

    function test_skin_caps_each_backer_at_its_share_of_the_master_and_counts_the_round_contribution() public {
        _openFund();
        _escrowOnHub(address(usdc), 200e6);
        MandateLib.Mandate memory _half = _mandateOf(5000, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,,) = _backer("skin-x", _half);
        (address _y,,) = _backer("skin-y", _half);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 200e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), 199e18, "a backer within half of the master's 499 shares joins");
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_y, 200e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_y), 199e18, "a second backer joins on the same cap, the first one's stake aside");

        MandateLib.Mandate memory _tenth = _mandateOf(1000, 0, vm.getBlockTimestamp() + 365 days);
        (address _z,,) = _backer("skin-z", _tenth);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_z, 200e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 200e6), _one(_x, 100e6));
        uint _masterBefore = shareToken.balanceOf(body);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(body), _masterBefore, "the master contributes in the same round");
        assertGt(shareToken.balanceOf(_x), 199e18, "and its contribution lifts the backer's cap within the round");
        assertLe(
            shareToken.balanceOf(_x) * 2,
            shareToken.balanceOf(body),
            "the backer stays within half of the master's shares"
        );
    }

    function test_skin_zero_admits_a_row_while_the_master_holds_no_shares_and_the_rate_and_exit_cap_still_bind()
        public
    {
        uint _t0 = vm.getBlockTimestamp();
        MandateLib.Mandate memory _bare = _mandateOf(0, 0, _t0 + 365 days);
        MandateLib.Mandate memory _skinned = _mandateOf(5000, 0, _t0 + 365 days);
        (address[] memory _users, uint[] memory _keys) = _cohort("skin-zero-", 2);
        _fundWallet(_users[0], 1000e6);
        _mandateCall(_users[0], _keys[0], _list(_bare));
        _fundWallet(_users[1], 1000e6);
        _mandateCall(_users[1], _keys[1], _list(_skinned));
        address _x = _account(_users[0]);
        address _y = _account(_users[1]);
        Fund.Allocation[] memory _opening = new Fund.Allocation[](2);
        _opening[0] = _row(_x, 100e6);
        _opening[1] = _row(_y, 100e6);

        bytes32 _symbol = bytes32("SZ");
        bytes memory _pixels = new bytes(GRID_BYTES);
        shareToken = ShareToken(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(body, _symbol, _pixels, uint16(hub.performanceFee())),
                bytes32(uint(uint160(body))),
                address(hub)
            )
        );
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _opening);
        hub.createFund(
            _symbol,
            _pixels,
            _coSig(bodyKey, AccountLib.genesisDigest(address(accountModule), body, _account(master))),
            _fundApproval(masterKey, body),
            _i,
            _sig,
            _ownerCoSig(_i)
        );
        assertEq(shareToken.balanceOf(body), 0, "the fund opens without a master stake");
        assertEq(shareToken.balanceOf(_x), 99.5e18, "a skin-0 backer joins a master that holds no shares");
        assertEq(shareToken.balanceOf(_y), 0, "a backer asking for skin still needs master shares to join beside");
        assertEq(usdc.balanceOf(_y), 999e6, "and pays nothing");
        assertEq(fundStore.getHolding(body, _y).allocatedAt, 0, "nor opens a holding");

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 449.5e6 + 1));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 449.5e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), 548e18, "the rate room still caps a skin-0 row at half the balance");

        _sell(_users[0], _keys[0], 109.6e18);
        (address[] memory _late, uint[] memory _lateKeys) = _cohort("skin-zero-exit-", 2);
        MandateLib.Mandate memory _tapered = _mandateOf(0, 0, _t0 + 365 days);
        _tapered.exitCap = 4000;
        MandateLib.Mandate memory _frozen = _mandateOf(0, 0, _t0 + 365 days);
        _frozen.exitCap = 2000;
        _fundWallet(_late[0], 1000e6);
        _mandateCall(_late[0], _lateKeys[0], _list(_tapered));
        _fundWallet(_late[1], 1000e6);
        _mandateCall(_late[1], _lateKeys[1], _list(_frozen));
        address _w = _account(_late[0]);
        address _z = _account(_late[1]);

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_w, 249.75e6 + 1));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        _rows[0] = _row(_w, 249.75e6);
        _rows[1] = _row(_z, 100e6);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(
            shareToken.balanceOf(_w), 0, "a fifth of the supply exiting against a 40% cap halves a skin-0 row's room"
        );
        assertEq(shareToken.balanceOf(_z), 0, "and a cap the queue already fills freezes a skin-0 row");
        assertEq(usdc.balanceOf(_z), 999e6, "which pulls nothing");
        assertEq(shareToken.balanceOf(body), 0, "all while the master holds no shares");
    }

    function test_a_backers_queued_shares_count_toward_its_skin_until_they_fill() public {
        _openFund();
        MandateLib.Mandate memory _half = _mandateOf(5000, 0, vm.getBlockTimestamp() + 365 days);
        (address _x, uint _xKey, address _xUser) = _backer("queued-x", _half);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 200e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        _sell(_xUser, _xKey, 199e18);
        assertEq(shareToken.balanceOf(_x), 199e18, "the backer's 199 shares stay locked in its balance, still exposed");
        assertEq(_queuedOf(_x), 199e18);
        _mandateCall(_xUser, _xKey, _list(_half));

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);

        uint _exitedCost = fundStore.getHolding(body, _x).cost;
        _wethTo(body, 3000 ether);
        _redeem(0, 0, _list(_x));
        assertEq(_queuedOf(_x), 0, "the redemption pays the whole queue out");
        assertEq(shareToken.balanceOf(_x), 0, "and burns the queued shares");
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _shares = shareToken.balanceOf(_x);
        assertEq(
            _shares,
            Math.mulDiv(100e6 * USD - FEE_VALUE, _supply, _nav),
            "so the same round joins once nothing of the backer waits unfilled"
        );
        assertEq(
            fundStore.getHolding(body, _x).cost,
            (100e6 * USD - FEE_VALUE) * PRICE_PRECISION / _shares,
            "a re-entry after a full exit costs the new price alone"
        );
        assertGt(fundStore.getHolding(body, _x).cost, _exitedCost, "the gain since the exited entry is not averaged in");
    }

    function test_a_sell_clears_the_funds_commitment_and_leaves_another_masters_standing() public {
        _openFund();
        uint _t0 = vm.getBlockTimestamp();
        (address _user, uint _key) = makeAddrAndKey("sell-clears-x");
        _fundWallet(_user, 1000e6);
        address _other = makeAddr("sell-clears-other-master");
        MandateLib.Mandate memory _a = _mandateOf(MAX_SKIN, 0, _t0 + 365 days);
        MandateLib.Mandate memory _b = _mandateOf(MAX_SKIN, 0, _t0 + 365 days);
        _b.master = _other;
        MandateLib.Mandate[] memory _both = new MandateLib.Mandate[](2);
        (_both[0], _both[1]) = uint160(body) < uint160(_other) ? (_a, _b) : (_b, _a);
        _mandateCall(_user, _key, _both);
        address _x = _account(_user);
        (address _y,,) = _backer("sell-clears-y", _a);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _shares = shareToken.balanceOf(_x);

        _sell(_user, _key, _shares / 2);
        assertEq(mandateStore.mandateMap(_x, body), bytes32(0), "a sell clears the backer's commitment to the fund");
        assertEq(
            mandateStore.mandateMap(_x, _other),
            keccak256(abi.encode(_b, uint(0))),
            "another master's commitment stands"
        );

        uint _held = usdc.balanceOf(_x);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _two(_x, _y, 100e6));
        vm.expectCall(_x, abi.encodeWithSelector(UserAccount.execute.selector, address(0)), 0);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), _shares, "the next round skips the seller without asking its account to pay");
        assertEq(usdc.balanceOf(_x), _held, "pulling nothing");
        assertGt(shareToken.balanceOf(_y), 0, "while it mints the other row");
    }

    function test_a_round_waits_while_a_redemption_is_open() public {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,,) = _backer("open-x", _m);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _held = shareToken.balanceOf(_x);
        uint _masterHeld = shareToken.balanceOf(body);

        _wethTo(body, 3000 ether);
        _redeem(2500, 0, new address[](0));
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        assertGt(_r.owedLeft, 0, "the backer's quarter is still owed");

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__Open.selector, _r.id));
        hub.allocate(_i, _sig, _ownerSig);

        uint _paidBefore = wnt.balanceOf(_x);
        uint _ownerBefore = wnt.balanceOf(_ownerAccount());
        hub.redeemCohort(shareToken, _list(_x));
        assertEq(shareToken.balanceOf(_x), _held - _held / 4, "the backer burns the same quarter");
        assertEq(shareToken.balanceOf(body), _masterHeld - _masterHeld / 4, "as the master did at the open");
        assertGt(wnt.balanceOf(_x), _paidBefore, "the cohort pays the backer its quarter in WETH");
        assertGt(wnt.balanceOf(_ownerAccount()), _ownerBefore, "and the master last, once nobody else is owed");
        assertFalse(isOpen(fundStore.getRedemption(body)), "which closes the redemption");

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_x), _held - _held / 4, "the next round runs once the redemption closed");
    }

    function test_each_fund_paces_a_backer_on_its_own_terms_skipping_above_the_rate_or_past_expiry_and_refusing_inside_its_own_cooldown()
        public
    {
        _openFund();
        uint _t0 = vm.getBlockTimestamp();
        address _bodyA = body;
        uint _keyA = bodyKey;
        ShareToken _shareA = shareToken;
        (address _bodyB, uint _keyB) = makeAddrAndKey("paced-second-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _keyB);
        MandateLib.Mandate memory _termsA = _mandateOf(MAX_SKIN, 1 days, _t0 + 365 days);
        MandateLib.Mandate memory _termsB = _mandateOf(MAX_SKIN, 1 days, _t0 + 1 hours);
        _termsB.master = _bodyB;
        (address _user, uint _key) = makeAddrAndKey("paced");
        _fundWallet(_user, 1000e6);
        _mandateCall(_user, _key, _list(_termsA));
        address _x = _account(_user);

        body = _bodyB;
        bodyKey = _keyB;
        _escrowOnHub(address(usdc), SEED);
        bytes32 _symbol = bytes32("AMB");
        bytes memory _pixels = new bytes(GRID_BYTES);
        shareToken = ShareToken(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(_bodyB, _symbol, _pixels, uint16(hub.performanceFee())),
                bytes32(uint(uint160(_bodyB))),
                address(hub)
            )
        );
        ShareToken _shareB = shareToken;
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), SEED), new Fund.Allocation[](0));
        hub.createFund(
            _symbol,
            _pixels,
            _coSig(_keyB, AccountLib.genesisDigest(address(accountModule), _bodyB, _account(master))),
            _fundApproval(masterKey, _bodyB),
            _i,
            _sig,
            _ownerCoSig(_i)
        );
        assertEq(_shareB.balanceOf(_bodyB), 499e18, "the owner opens a second fund beside the first");

        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = Fund.Allocation({puppet: _x, mandate: _termsB, amount: 100e6});
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);

        _mandateCall(_user, _key, _list(_termsB));
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _sharesB = _shareB.balanceOf(_x);
        assertGt(_sharesB, 0, "a fund takes the backer's row only once the backer commits to its terms");
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 20e6));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__Cooldown.selector, _x, _t0, 1 days));
        hub.allocate(_i, _sig, _ownerSig);

        body = _bodyA;
        bodyKey = _keyA;
        shareToken = _shareA;
        uint _room = usdc.balanceOf(_x) / 2;
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _room + 1));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _room));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(
            _shareA.balanceOf(_x),
            0,
            "the first fund admits a row of exactly its rate, the second fund's cooldown aside"
        );
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 20e6));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__Cooldown.selector, _x, _t0, 1 days));
        hub.allocate(_i, _sig, _ownerSig);

        vm.warp(_t0 + 1 hours);
        body = _bodyB;
        bodyKey = _keyB;
        shareToken = _shareB;
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 20e6));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        assertEq(
            _shareB.balanceOf(_x), _sharesB, "past its expiry the second fund skips the row before its cooldown is read"
        );

        vm.warp(_t0 + 1 days);
        body = _bodyA;
        bodyKey = _keyA;
        shareToken = _shareA;
        uint _sharesA = _shareA.balanceOf(_x);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 20e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(
            _shareA.balanceOf(_x),
            _sharesA,
            "the first fund's cooldown ends exactly one period after its last allocation"
        );
        assertEq(
            usdc.balanceOf(_x),
            998e6 - 100e6 - _room - 20e6,
            "the backer paid only the rows each fund's own terms admit"
        );
    }

    function test_fund_skips_a_row_above_the_backers_rate_without_asking_its_account_even_where_the_value_room_rounds_it_in()
        public
    {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,,) = _backer("coarse-x", _m);
        (address _y,, address _yUser) = _backer("coarse-y", _m);
        _fundWallet(_yUser, 1000e6);
        Fund.Price memory _coarse = Fund.Price({amount: 1e6, value: 1e5});
        assertGt(
            (499.5e6 + 1) * 10_000, usdc.balanceOf(_x) * 5000, "the row asks for more than half of the backer's balance"
        );
        assertLe(
            Math.mulDiv(499.5e6 + 1, _coarse.value, _coarse.amount) * 10_000,
            Math.mulDiv(usdc.balanceOf(_x), _coarse.value, _coarse.amount) * 5000,
            "while its value, rounded down, fits the value room"
        );
        (Fund.AllocateIntent memory _i,) = _round(_coarse, _noCredit(), _two(_x, _y, 499.5e6 + 1));
        _i.header.fee = 2;
        bytes memory _sig = _pair(masterKey, _allocateDigest(_i));
        vm.expectCall(_x, abi.encodeWithSelector(UserAccount.execute.selector), 0);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), 0, "the row is skipped");
        assertEq(usdc.balanceOf(_x), 999e6, "without its account ever being asked to pay");
        assertGt(shareToken.balanceOf(_y), 0, "while a backer whose rate admits the same amount joins");
        assertEq(usdc.balanceOf(_y), 1999e6 - 499.5e6 - 1, "paying its row");
    }

    function test_a_row_carrying_terms_the_backer_never_committed_to_is_skipped_without_asking_its_account() public {
        _openFund();
        uint _t0 = vm.getBlockTimestamp();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, _t0 + 365 days);
        (address _x,,) = _backer("forged-x", _m);
        (address _y,,) = _backer("forged-y", _m);
        Fund.Allocation[] memory _rows = _two(_x, _y, 100e6);
        uint _at = _rows[0].puppet == _x ? 0 : 1;
        (Fund.AllocateIntent memory _honest, bytes memory _honestSig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_honest, _honestSig, _ownerCoSig(_honest));
        uint _stake = shareToken.balanceOf(_x);
        uint _held = usdc.balanceOf(_x);
        assertGt(_stake, 0, "a row carrying the committed terms joins");

        vm.expectCall(_x, abi.encodeWithSelector(UserAccount.execute.selector, address(0)), 0);
        for (uint _k; _k < 6; ++_k) {
            MandateLib.Mandate memory _forged = _mandateOf(MAX_SKIN, 0, _t0 + 365 days);
            _rows[_at].amount = 100e6;
            if (_k == 0) {
                _forged.allocationRate = 9000;
                _rows[_at].amount = 600e6;
            } else if (_k == 1) {
                _forged.expiry += 1;
            } else if (_k == 2) {
                _forged.cooldownPeriod = 1;
            } else if (_k == 3) {
                _forged.skin -= 1;
            } else if (_k == 4) {
                _forged.exitCap -= 1;
            } else {
                _forged.master = makeAddr("forged-master");
            }
            _rows[_at].mandate = _forged;
            uint _yShares = shareToken.balanceOf(_y);
            (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
            hub.allocate(_i, _sig, _ownerCoSig(_i));
            assertEq(
                shareToken.balanceOf(_x), _stake, "a row whose terms differ from the commitment in any field is skipped"
            );
            assertEq(usdc.balanceOf(_x), _held, "without its account being asked, even for a raised rate it would pay");
            assertGt(shareToken.balanceOf(_y), _yShares, "while the round mints the honest row");
        }
    }

    function test_a_row_carrying_a_replaced_or_cleared_mandate_is_skipped_without_asking_its_account() public {
        _openFund();
        uint _t0 = vm.getBlockTimestamp();
        MandateLib.Mandate memory _first = _mandateOf(MAX_SKIN, 0, _t0 + 365 days);
        (address _x, uint _xKey, address _xUser) = _backer("replaced-x", _first);
        (address _y,,) = _backer("replaced-y", _mandateOf(MAX_SKIN, 0, _t0 + 365 days));
        MandateLib.Mandate memory _second = _mandateOf(MAX_SKIN, 0, _t0 + 365 days);
        _second.allocationRate = 2000;
        _mandateCall(_xUser, _xKey, _list(_second));
        assertEq(
            mandateStore.mandateMap(_x, body), keccak256(abi.encode(_second, uint(0))), "the backer replaces its terms"
        );

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 300e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 150e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _stake = shareToken.balanceOf(_x);
        assertGt(_stake, 0, "the new terms admit only what their own lower rate allows");

        uint _held = usdc.balanceOf(_x);
        Fund.Allocation[] memory _rows = _two(_x, _y, 300e6);
        uint _at = _rows[0].puppet == _x ? 0 : 1;
        _rows[_at].mandate = _first;
        assertLe(300e6 * 10_000, _held * _first.allocationRate, "the replaced terms would admit a larger row");
        vm.expectCall(_x, abi.encodeWithSelector(UserAccount.execute.selector, address(0)), 0);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            shareToken.balanceOf(_x), _stake, "yet a row carrying them is skipped without asking the account to pay"
        );
        assertEq(usdc.balanceOf(_x), _held, "pulling nothing");
        assertGt(shareToken.balanceOf(_y), 0, "while the round mints the other row");

        MandateLib.Mandate memory _cleared = _mandateOf(MAX_SKIN, 0, 0);
        _cleared.allocationRate = 0;
        _cleared.exitCap = 0;
        _mandateCall(_xUser, _xKey, _list(_cleared));
        assertEq(mandateStore.mandateMap(_x, body), bytes32(0), "a clearing empties the commitment");
        _rows = _two(_x, _y, 100e6);
        _rows[_at].mandate = _second;
        _held = usdc.balanceOf(_x);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            shareToken.balanceOf(_x),
            _stake,
            "so a row carrying the cleared terms is skipped without asking the account"
        );
        assertEq(usdc.balanceOf(_x), _held, "pulling nothing");
    }

    function test_a_lapsed_mandate_is_skipped_before_its_running_cooldown_could_refuse_the_round() public {
        _openFund();
        uint _t0 = vm.getBlockTimestamp();
        (address _x,,) = _backer("lapse-x", _mandateOf(MAX_SKIN, 1 days, _t0 + 1 hours));
        (address _y,,) = _backer("lapse-y", _mandateOf(MAX_SKIN, 0, _t0 + 365 days));
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _stake = shareToken.balanceOf(_x);
        assertGt(_stake, 0, "the backer joins while its mandate is live");

        vm.warp(_t0 + 1 hours);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _two(_x, _y, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            mandateStore.mandateMap(_x, body),
            keccak256(abi.encode(mandateLog[_x][body], uint(0))),
            "the hub still commits to the lapsed terms the row carries"
        );
        assertEq(mandateLog[_x][body].cooldownPeriod, 1 days, "which hold a running cooldown");
        assertEq(shareToken.balanceOf(_x), _stake, "yet its row is skipped instead of refusing the round");
        assertEq(usdc.balanceOf(_x), 899e6, "pulling nothing");
        assertEq(fundStore.getHolding(body, _x).allocatedAt, _t0, "and leaving its holding's stamp");
        assertGt(shareToken.balanceOf(_y), 0, "while the round mints the other row");
    }

    function test_a_row_naming_a_contract_that_imitates_an_account_reverts_the_round_and_mints_it_nothing() public {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,, address _xUser) = _backer("imitated-x", _m);
        address _imitation = address(new ImitationAccount(_xUser));
        usdc.mint(_imitation, 1000e6);
        vm.prank(address(hub));
        mandateStore.setMandate(_imitation, body, keccak256(abi.encode(_m, uint(0))));
        assertEq(UserAccount(payable(_imitation)).user(), _xUser, "the imitation answers as the backer's own wallet");
        assertEq(
            mandateStore.mandateMap(_imitation, body),
            keccak256(abi.encode(_m, UserAccount(payable(_imitation)).epoch())),
            "and the store even commits to the terms its row carries, under the epoch it answers"
        );

        Fund.Allocation[] memory _rows = _two(_x, _imitation, 100e6);
        _rows[_rows[0].puppet == _imitation ? 0 : 1].mandate = _m;
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NotAccount.selector, _imitation));
        hub.allocate(_i, _sig, _ownerSig);
        assertEq(shareToken.balanceOf(_imitation), 0, "a contract the module did not create for its user is refused");
        assertEq(usdc.balanceOf(_x), 999e6, "and the whole round with it");

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_x), 0, "the same round without it lands");
        assertEq(shareToken.balanceOf(_imitation), 0, "and the imitation holds no share");
    }

    function test_a_backer_that_revokes_after_a_round_is_signed_is_skipped_by_it_at_once_while_the_round_mints_the_rest()
        public
    {
        _openFund();
        uint _t0 = vm.getBlockTimestamp();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, _t0 + 365 days);
        (address _x,, address _xUser) = _backer("revoked-x", _m);
        (address _y,,) = _backer("revoked-y", _m);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _two(_x, _y, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _xShares = shareToken.balanceOf(_x);
        uint _yShares = shareToken.balanceOf(_y);
        assertGt(_xShares, 0, "both backers join the first round");
        assertEq(usdc.balanceOf(_x), 899e6, "each paying its row");

        vm.warp(_t0 + 1 hours);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _two(_x, _y, 100e6));
        vm.prank(_xUser);
        UserAccount(payable(_x)).revokeSessions();
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        vm.expectCall(_x, abi.encodeWithSelector(UserAccount.execute.selector, address(0)), 0);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            shareToken.balanceOf(_x),
            _xShares,
            "a round signed before the revoke lands in the same block without the backer's row, never asking its account"
        );
        assertEq(usdc.balanceOf(_x), 899e6, "pulling nothing");
        assertEq(fundStore.getHolding(body, _x).allocatedAt, _t0, "nor restamping its holding");
        assertGt(shareToken.balanceOf(_y), _yShares, "while the round mints the other row");
        assertEq(usdc.balanceOf(feeReceiver) - _feeBefore, FEE / 2, "and bills only that row's slice");
    }

    function test_an_owner_credit_mints_only_its_increment_and_records_the_signed_totals_on_the_owner_account() public {
        _openFund();
        address _owner = _account(master);
        _escrowOnHub(address(usdc), 300e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0));
        assertEq(_i.credit.total, SEED + 100e6, "the owner signs the running total released to the fund");
        assertEq(_i.credit.feeTotal, 2 * FEE, "beside the running total of the master slices billed out of it");
        hub.allocate(_i, _sig, _ownerCoSig(_i));

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 200e6), new Fund.Allocation[](0));
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        uint _masterShares = shareToken.balanceOf(body);
        uint _bodyBefore = usdc.balanceOf(body);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.recordLogs();
        hub.allocate(_i, _sig, _ownerSig);
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        assertEq(
            shareToken.balanceOf(body) - _masterShares,
            Math.mulDiv(200e6 * USD - FEE_VALUE, _supply, _nav),
            "a larger total mints the master on its increment alone"
        );
        assertEq(usdc.balanceOf(body) - _bodyBefore, 200e6 - FEE, "and releases only that increment, net of its slice");
        assertEq(
            hubEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            SEED + 300e6,
            "the escrow keeps the signed total as fulfilled"
        );
        assertEq(hubEscrowStore.feePaidMap(_owner, body, address(usdc)), 3 * FEE, "and the signed fee total as paid");

        uint _k;
        while (
            _logs[_k].topics[0] != AccountModule.AccountCall.selector
                || _logs[_k].topics[1] != bytes32(uint(uint160(_owner)))
        ) {
            ++_k;
        }
        (,,, bytes32 _digest,, bytes memory _data,,,) = abi.decode(
            _logs[_k].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(
            _logs[_k].topics[2],
            bytes32(uint(uint160(address(fundModule)))),
            "the Fund module records the credit on the owner account"
        );
        assertEq(
            _digest,
            AccountLib.creditDigest(_owner, body, block.chainid, address(usdc), SEED + 300e6, 3 * FEE),
            "under the digest the owner signed"
        );
        assertEq(
            _data,
            abi.encode(Fund.allocate.selector, body, _i.credit),
            "carrying the fund and the signed totals"
        );
    }

    function test_a_credit_is_refused_unless_its_total_grows_its_fee_total_adds_the_billed_slice_and_the_owner_signs_it()
        public
    {
        _openFund();
        address _owner = _account(master);
        _escrowOnHub(address(usdc), 100e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0));
        uint _total = _i.credit.total;
        uint _feeTotal = _i.credit.feeTotal;

        _i.credit.total = SEED;
        _i.credit.feeTotal = FEE;
        _sig = _pair(masterKey, _allocateDigest(_i));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__CreditNotIncreasing.selector, SEED, SEED));
        hub.allocate(_i, _sig, _ownerSig);

        _i.credit.total = SEED - 1;
        _sig = _pair(masterKey, _allocateDigest(_i));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__CreditNotIncreasing.selector, SEED, SEED - 1));
        hub.allocate(_i, _sig, _ownerSig);

        _i.credit.total = _total;
        _i.credit.feeTotal = _feeTotal + 1;
        _sig = _pair(masterKey, _allocateDigest(_i));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__CreditFeeMismatch.selector, _feeTotal + 1, _feeTotal));
        hub.allocate(_i, _sig, _ownerSig);

        _i.credit.feeTotal = FEE;
        _sig = _pair(masterKey, _allocateDigest(_i));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__CreditFeeMismatch.selector, FEE, _feeTotal));
        hub.allocate(_i, _sig, _ownerSig);

        _i.credit.feeTotal = _feeTotal;
        _sig = _pair(masterKey, _allocateDigest(_i));
        _ownerSig =
            _coSig(backerKey, AccountLib.creditDigest(_owner, body, block.chainid, address(usdc), _total, _feeTotal));
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _sig, _ownerSig);
        _ownerSig = _creditSignature(block.chainid, address(usdc), _total + 1, _feeTotal);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _sig, _ownerSig);

        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            hubEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            _total,
            "the owner's signature over the exact totals lands"
        );

        (_i, _sig) = _round(_usdcPrice(), _credit(FOREIGN_CHAIN_ID, address(usdc), 100e6), new Fund.Allocation[](0));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), new Fund.Allocation[](0));
        _i.credit = Fund.Credit({chainId: FOREIGN_CHAIN_ID, token: address(usdc), total: 100e6, feeTotal: FEE});
        _sig = _pair(masterKey, _allocateDigest(_i));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__CreditNotIncreasing.selector, 100e6, 100e6));
        hub.allocate(_i, _sig, _ownerSig);
    }

    function test_a_session_the_owner_granted_signs_local_and_abroad_credits_and_a_strangers_session_signs_neither()
        public
    {
        _openFund();
        address _owner = _account(master);
        _escrowOnHub(address(usdc), 100e6);
        uint _issuedAt = vm.getBlockTimestamp();

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0));
        bytes memory _stranger = _strangerSessionCredit(_issuedAt, _i);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _sig, _stranger);
        hub.allocate(_i, _sig, _sessionCredit(0, _issuedAt, _i));
        assertEq(
            hubEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            SEED + 100e6,
            "a session the owner granted signs a local credit"
        );

        (_i, _sig) = _round(_usdcPrice(), _credit(FOREIGN_CHAIN_ID, address(usdc), 100e6), new Fund.Allocation[](0));
        _stranger = _strangerSessionCredit(_issuedAt, _i);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _sig, _stranger);
        hub.allocate(_i, _sig, _sessionCredit(0, _issuedAt, _i));
        assertEq(
            fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total,
            100e6,
            "an abroad credit lands under the same session, since its spoke settles it before the hub credits it"
        );
    }

    function test_an_owner_credit_its_old_epoch_session_signed_lands_through_the_revoke_grace_and_is_refused_after_while_its_own_key_still_credits()
        public
    {
        _openFund();
        address _owner = _account(master);
        UserAccount _ua = UserAccount(payable(_owner));
        _escrowOnHub(address(usdc), 400e6);
        uint _t0 = vm.getBlockTimestamp();
        vm.prank(master);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), _epochAfterRevoke(0), "the owner's wallet revokes its sessions");
        assertTrue(_ua.epoch() != 0, "off the epoch its old session was granted in");

        vm.warp(_t0 + SESSION_REVOKE_DELAY - 1);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0));
        hub.allocate(_i, _sig, _sessionCredit(0, _t0, _i));
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)),
            SEED + 100e6,
            "a credit its old-epoch session signed lands through the grace"
        );

        vm.warp(_t0 + SESSION_REVOKE_DELAY);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0));
        bytes memory _stale = _sessionCredit(0, _t0, _i);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _sig, _stale);
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)),
            SEED + 100e6,
            "once the grace is over that session credits nothing"
        );
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)),
            SEED + 200e6,
            "while the owner's raw wallet signature credits the same total, the revoke halting no credit of its own"
        );

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0));
        hub.allocate(_i, _sig, _sessionCredit(_ua.epoch(), _t0 + SESSION_REVOKE_DELAY, _i));
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)),
            SEED + 300e6,
            "and a session granted in the new epoch signs credits again"
        );

        (_i, _sig) = _round(_usdcPrice(), _credit(FOREIGN_CHAIN_ID, address(usdc), 100e6), new Fund.Allocation[](0));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(
            fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total,
            100e6,
            "an abroad credit after the revoke lands under the owner's own key"
        );
    }

    function mandateRecordOf(
        MandateLib.Mandate[] calldata _list
    ) external view returns (bytes memory) {
        return abi.encode(HubGate.mandate.selector, uint(0), _list, address(usdc), FEE);
    }

    function _strangerSessionCredit(
        uint _issuedAt,
        Fund.AllocateIntent memory _i
    ) internal view returns (bytes memory) {
        address _signer = vm.addr(backerKey + 1);
        return abi.encode(
            _signer,
            _issuedAt,
            _issuedAt + 1 days,
            uint(0),
            body,
            _coSig(
                backerKey,
                AccountLib.sessionDigest(
                    address(accountModule), backer, _signer, _issuedAt, _issuedAt + 1 days, 0, body
                )
            ),
            _coSig(
                backerKey + 1,
                AccountLib.creditDigest(
                    _ownerAccount(), body, _i.credit.chainId, _i.credit.token, _i.credit.total, _i.credit.feeTotal
                )
            )
        );
    }

    function _sessionCredit(
        uint _epoch,
        uint _issuedAt,
        Fund.AllocateIntent memory _i
    ) internal view returns (bytes memory) {
        address _signer = vm.addr(masterKey + 1);
        return abi.encode(
            _signer,
            _issuedAt,
            _issuedAt + 1 days,
            _epoch,
            body,
            _coSig(
                masterKey,
                AccountLib.sessionDigest(
                    address(accountModule), master, _signer, _issuedAt, _issuedAt + 1 days, _epoch, body
                )
            ),
            _coSig(
                masterKey + 1,
                AccountLib.creditDigest(
                    _ownerAccount(), body, _i.credit.chainId, _i.credit.token, _i.credit.total, _i.credit.feeTotal
                )
            )
        );
    }
}
