// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {HubGate, MANDATE_INTENT_TYPEHASH, MAX_SKIN} from "src/HubGate.sol";
import {Fund, PRICE_PRECISION, VIRTUAL_SHARES, VIRTUAL_VALUE} from "src/core/Fund.sol";
import {FundStore, isOpen} from "src/core/FundStore.sol";
import {GRID_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {MandateLib} from "src/utils/MandateLib.sol";
import {Error} from "src/utils/Error.sol";
import {LiquidityGate} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";

import {HotPathTest} from "./HotPath.t.sol";
import {MockERC20} from "./mock/MockERC20.t.sol";
import {MockWallet1271} from "./mock/MockWallet1271.t.sol";

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
        MandateLib.Mandate mandate;
        uint[3] stake;
        uint[3] cost;
        uint[3] basis;
    }

    function _usdcPrice() internal view returns (Fund.Price memory) {
        return Fund.Price({amount: 1e6, value: 1e6 * USD});
    }

    function _noCredit() internal pure returns (Fund.Credit memory) {
        return Fund.Credit({chainId: 0, token: address(0), amount: 0});
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
        intent_.header = AccountLib.IntentHeader({
            account: body,
            user: master,
            nonce: _nonceOf(body),
            deadline: vm.getBlockTimestamp() + 300,
            feeToken: address(wnt),
            fee: FEE_VALUE
        });
        intent_.shareToken = shareToken;
        intent_.valuation = _valuation(_nav());
        intent_.token = _token;
        intent_.price = _price;
        intent_.credit = _c;
        intent_.allocationList = _rows;
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
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(body), 499e18, "the opening credit mints the seed net of the round fee");
        assertEq(usdc.balanceOf(body), SEED - FEE, "and lands it in the body net of that fee");
        assertEq(
            hubEscrowStore.releasedMap(_account(master), address(usdc)), SEED, "the seed is released from the hub escrow"
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
        MandateLib.Mandate memory _m,
        uint _amount
    ) internal view returns (Fund.Allocation[] memory rows_) {
        rows_ = new Fund.Allocation[](1);
        rows_[0] = _row(_puppet, _m, _amount);
    }

    function _mandateIntent(
        address _user,
        uint _key,
        MandateLib.Mandate[] memory _mandates
    ) internal returns (HubGate.MandateIntent memory intent_, bytes memory coSig_) {
        address _acct = _account(_user);
        bytes[] memory _sigs = new bytes[](_mandates.length);
        for (uint _j; _j < _mandates.length; ++_j) {
            _sigs[_j] = _mandateSig(_key, _acct, _mandates[_j]);
        }
        intent_ = HubGate.MandateIntent({
            header: AccountLib.IntentHeader({
                account: _acct,
                user: _user,
                nonce: _nonceOf(_acct),
                deadline: vm.getBlockTimestamp() + 300,
                feeToken: address(usdc),
                fee: FEE
            }),
            mandateList: _mandates,
            signatureList: _sigs
        });
        coSig_ = _pair(
            _key,
            _typed(
                _acct,
                intent_.header.deadline,
                keccak256(
                    abi.encode(
                        MANDATE_INTENT_TYPEHASH,
                        _hashHeader(intent_.header),
                        keccak256(abi.encode(_mandates))
                    )
                )
            )
        );
    }

    function _mandateCall(
        address _user,
        uint _key,
        MandateLib.Mandate[] memory _mandates
    ) internal {
        (HubGate.MandateIntent memory _i, bytes memory _sig) = _mandateIntent(_user, _key, _mandates);
        hub.mandate(_i, _sig);
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
            MandateLib.Mandate memory _m = _mandateOf(_skins[_j], 0, vm.getBlockTimestamp() + 365 days);
            _mandateCall(_users[_j], _keys[_j], _list(_m));
            _rows[_j] = _row(_account(_users[_j]), _m, _amounts[_j]);
        }
        _rows[2].signature = _coSig(_keys[2], keccak256("a session that has since ended"));

        (intent_, coSig_) = _round(
            _usdcPrice(),
            _creditAmount > 0 ? _credit(block.chainid, address(usdc), _creditAmount) : _noCredit(),
            _rows
        );

        _mandateCall(_users[4], _keys[4], _list(_mandateOf(5000, 0, vm.getBlockTimestamp())));

        assertFalse(
            UserAccount(payable(_rows[2].puppet)).approves(
                this.digestOf(_rows[2].puppet, _rows[2].mandate), _rows[2].signature
            ),
            "B's row carries a signature that no longer verifies"
        );
        assertEq(
            mandateStore.mandateMap(_rows[2].puppet, body),
            this.digestOf(_rows[2].puppet, _rows[2].mandate),
            "B's mandate still stands, so only the pull can skip it"
        );
        assertEq(mandateStore.mandateMap(_rows[4].puppet, body), bytes32(0), "C revoked after the round was signed");
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

        hub.allocate(_i, _sig, _ownerCoSig(_i));

        _b.slice = FEE_VALUE / (_creditAmount > 0 ? 7 : 6);
        _b.billed = Math.mulDiv(2 * _b.slice, 1e6, 1e6 * USD);
        _b.masterBilled = _creditAmount > 0 ? Math.mulDiv(_b.slice, 1e6, 1e6 * USD, Math.Rounding.Ceil) : 0;

        uint[4] memory _skipped = [uint(0), 2, 4, 5];
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
        assertEq(shareToken.totalSupply() - _b.totalSupply, _sharesE + _sharesF + _sharesMaster, "supply grows by exactly the minted shares");

        assertEq(usdc.balanceOf(feeReceiver) - _b.fee, _b.billed + _b.masterBilled, "fee receiver gets the row billing plus the master billing");
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
            _nonceOf(_account(master)), _b.ownerNonce + (_creditAmount > 0 ? 1 : 0), "the owner co-signs only a round that credits it"
        );
    }

    function test_matrix_without_credit_skips_four_and_the_relayer_absorbs_their_slices() public {
        _matrix(0, 333_333, 99_833_333_333_333_333_334, 199_833_333_333_333_333_334, 0);
    }

    function test_matrix_with_local_credit_bills_the_master_one_fixed_slice() public {
        _matrix(
            100e6, 428_572, 99_857_142_857_142_857_143, 199_857_142_857_142_857_143, 99_857_142_857_142_857_143
        );
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
            if (_amounts[_j] > 0) _rows[_k++] = _row(_b.puppet[_j], _b.mandate, _amounts[_j]);
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
            usdc.balanceOf(body), _body + _paid - Math.mulDiv(_slice * _len, 1e6, 1e6 * USD), "the body nets every row less its slice"
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
            assertEq(shareToken.balanceOf(_b.puppet[_j]), _b.stake[_j], "the stake is every mint at its round price less every burn");
            assertEq(fundStore.getHolding(body, _b.puppet[_j]).cost, _b.cost[_j], "the cost blends the entry into the stake held before it");
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
        _b.mandate = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        address[] memory _holders = new address[](3);
        for (uint _j; _j < 3; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            _mandateCall(_users[_j], _keys[_j], _list(_b.mandate));
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
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p[0], _m, 200e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        usdc.mint(body, 2 * usdc.balanceOf(body));
        _escrowOnHub(address(usdc), 300e6);

        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        _rows[0] = _row(_p[1], _m, 100e6);
        _rows[1] = _row(_p[2], _m, 400e6);
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
            (300e6 * USD - _slice) * PRICE_PRECISION / _contributed, _price, 1, "the master's credit buys at that price too"
        );
        assertEq(fundStore.getHolding(body, _p[0]).cost, _holderCost, "and the holder's gain is left to its own exit");
    }

    function test_relay_fee_cap_skips_at_exactly_max_bps_and_includes_one_wei_above() public {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _p,,) = _backer("fee-cap", _m);

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, _m, 10e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);

        uint _held = usdc.balanceOf(_p);
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, _m, 10e6 + 1));
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_p), Math.mulDiv((10e6 + 1) * USD - FEE_VALUE, _supply, _nav), "one wei above the cap is included");
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
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p[0], _m, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        FundStore.Holding memory _held = fundStore.getHolding(body, _p[0]);
        uint _stake = shareToken.balanceOf(_p[0]);

        usdc.mint(body, 10 * usdc.balanceOf(body));
        vm.warp(_t0 + 1 hours);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](3);
        _rows[0] = _row(_p[0], _m, 11);
        _rows[1] = _row(_p[1], _m, 11);
        _rows[2] = _row(_p[2], _m, 300 ether);
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
            shareToken.balanceOf(_p[2]), Math.mulDiv(300 ether - 1, _supply, _nav), "the round still mints the row that buys shares"
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

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 5e6 - 1), _one(_q, _good, 100e6));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, FEE / 2, 5e6 - 1, 1000));
        hub.allocate(_i, _sig, _ownerSig);

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 5e6), _one(_p, _expiring, 100e6));
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
            _rows[_j] = _row(_account(_users[_j]), _m, _j == 0 ? 1e6 : 100e6);
        }
        _rows[1].signature = _coSig(_keys[1], keccak256("a session that has since ended"));
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
    }

    function test_cooldown_reverts_with_exact_args_until_the_period_elapses() public {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 1 days, vm.getBlockTimestamp() + 365 days);
        (address _p,,) = _backer("cooldown", _m);
        Fund.Allocation[] memory _rows = _one(_p, _m, 20e6);

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

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, _m, 20e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _t0 = vm.getBlockTimestamp();

        vm.warp(_t0 + 36_500 days);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, _m, 20e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__Cooldown.selector, _p, _t0, type(uint).max));
        hub.allocate(_i, _sig, _ownerSig);

        uint _sharesBefore = shareToken.balanceOf(_p);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 50e6), _one(_p, _m, 1e6));
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

        _rows[0] = _row(_acct[1], _m, 100e6);
        _rows[1] = _row(_acct[0], _m, 100e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__AllocationListNotSorted.selector, _acct[1], _acct[0]));
        hub.allocate(_i, _sig, _ownerSig);

        _rows[0] = _row(_acct[0], _m, 100e6);
        _rows[1] = _row(_acct[0], _m, 100e6);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__AllocationListNotSorted.selector, _acct[0], _acct[0]));
        hub.allocate(_i, _sig, _ownerSig);

        _rows[0] = _row(_acct[1], _m, 1e6);
        _rows[1] = _row(_acct[0], _m, 100e6);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__AllocationListNotSorted.selector, _acct[1], _acct[0]));
        hub.allocate(_i, _sig, _ownerSig);

        _rows[0] = _row(_acct[0], _m, 100e6);
        _rows[1] = _row(_acct[1], _m, 100e6);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_acct[0]), 99.5e18, "the sorted pair lands, each row carrying half the fee");
        assertEq(shareToken.balanceOf(_acct[1]), 99.5e18, "the sorted pair lands, each row carrying half the fee");
    }

    function test_non_canonical_round_token_reverts_and_the_list_is_read_when_the_round_executes() public {
        _openFund();
        _escrowOnHub(address(usdc), 10e6);
        MockERC20 _stray = new MockERC20("STRAY", "STRAY", 6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _roundIn(address(_stray), _usdcPrice(), _credit(block.chainid, address(_stray), 10e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__TokenNotCanonical.selector, address(_stray)));
        hub.allocate(_i, _sig, _ownerSig);

        address _impl = address(uint160(uint(vm.load(address(hub), bytes32(uint(keccak256("eip1967.proxy.implementation")) - 1)))));
        address _wethOnly = address(
            new HubGate(
                accountModule,
                depositModule,
                hubEscrowStore,
                mandateStore,
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
        vm.prank(owner);
        dictate.setGate(bytes32("HubGate"), _wethOnly);
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__TokenNotCanonical.selector, address(usdc)));
        hub.allocate(_i, _sig, _ownerSig);

        vm.prank(owner);
        dictate.setGate(bytes32("HubGate"), _impl);
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
            _wethTo(_account(_users[_j]), 12000 ether);
            _rows[_j] = _row(_account(_users[_j]), _m, 300 ether);
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
        assertEq(_nonceOf(_owner), _ownerNonce + 1, "a foreign credit spends the owner's nonce");
        assertEq(shareToken.balanceOf(body) - _sharesBefore, 99e18, "a foreign credit mints the master on its value net of the signed fee");

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
        assertEq(hubEscrowStore.releasedMap(_owner, address(usdc)), SEED, "and leaves the open hub escrow in that token alone");
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
            hubEscrowStore.escrowedMap(_owner, address(usdc)), SEED + 300e6, "the wallet and the account escrow into one hub ledger"
        );

        uint _ownerHeld = usdc.balanceOf(_owner);
        uint _ownerNonce = _nonceOf(_owner);
        uint _storeHeld = usdc.balanceOf(address(hubEscrowStore));
        uint _bodyBefore = usdc.balanceOf(body);
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        uint _masterShares = shareToken.balanceOf(body);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 300e6), _one(_x, _m, 100e6));
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        hub.allocate(_i, _sig, _ownerCoSig(_i));

        uint _masterBilled = Math.mulDiv(FEE_VALUE / 2, 1e6, 1e6 * USD, Math.Rounding.Ceil);
        assertEq(hubEscrowStore.escrowedMap(_owner, address(usdc)), SEED + 300e6, "the escrowed total stands");
        assertEq(hubEscrowStore.releasedMap(_owner, address(usdc)), SEED + 300e6, "the released total grows by the credit");
        assertEq(
            hubEscrowStore.fulfilledMap(_owner, body, address(usdc)), SEED + 300e6, "and so does the body's fulfilled total"
        );
        assertEq(hubEscrowStore.heldMap(address(usdc)), 0, "the store owes nothing more");
        assertEq(usdc.balanceOf(address(hubEscrowStore)), _storeHeld - 300e6, "having paid out exactly the credit");
        assertEq(
            usdc.balanceOf(feeReceiver) - _feeBefore, _masterBilled + FEE / 2, "the master's slice and the row's slice are billed"
        );
        assertEq(
            usdc.balanceOf(body) - _bodyBefore,
            300e6 - _masterBilled + 100e6 - FEE / 2,
            "the body receives the credit and the row, each net of its slice"
        );
        assertEq(usdc.balanceOf(_owner), _ownerHeld, "the owner's account balance is untouched");
        assertEq(_nonceOf(_owner), _ownerNonce + 1, "while its co-signature is spent as the round's consent");
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
    ) internal view returns (Fund.Allocation[] memory rows_) {
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        rows_ = new Fund.Allocation[](_n);
        for (uint _j; _j < _n; ++_j) {
            rows_[_j] = _row(address(uint160(0x1000 + _j)), _m, 1);
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
        assertEq(mandateStore.mandateMap(_acct, body), bytes32(0), "nothing is stored for the refused skin");

        _m.skin = MAX_SKIN;
        _m.exitCap = 10_001;
        (_i, _sig) = _mandateIntent(_user, _key, _list(_m));
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__InvalidExitCap.selector, 10_001));
        hub.mandate(_i, _sig);

        _m.exitCap = 10_000;
        _mandateCall(_user, _key, _list(_m));
        assertEq(mandateStore.mandateMap(_acct, body), this.digestOf(_acct, _m), "the bounds themselves are accepted");
    }

    function test_exit_cap_tapers_a_backers_stake_with_the_queue_and_freezes_it_until_the_master_drains() public {
        _openFund();
        (address _a, uint _aKey, address _aUser) = _backer("exit-a", _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days));
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _noCredit(), _one(_a, _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days), 400e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.totalSupply(), 898e18, "the backer joins beside the master");
        _sell(_aUser, _aKey, 89.8e18);
        assertEq(fundStore.getRedemption(body).queued, 89.8e18, "a tenth of the supply waits to exit");

        MandateLib.Mandate memory _tapered = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        _tapered.exitCap = 2000;
        (address _b,,) = _backer("exit-b", _tapered);
        uint _stake = usdc.balanceOf(_b) / 4;
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_b, _tapered, _stake + 1));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_b, _tapered, _stake));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_b), 0, "10% exiting against a 20% cap halves the half-balance rate cap");

        MandateLib.Mandate memory _frozen = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        _frozen.exitCap = 1000;
        (address _c,,) = _backer("exit-c", _frozen);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_c, _frozen, 1e6 + FEE));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);

        _wethTo(body, 3000 ether);
        _redeem(0, 0, _list(_a));
        assertEq(fundStore.getRedemption(body).queued, 0, "the master clears the whole queue");
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_c, _frozen, 100e6));
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
        _i.credit = _credit(FOREIGN_CHAIN_ID, address(usdc), 100e6);
        _i.allocationList = new Fund.Allocation[](0);
        bytes32 _structHash = _allocateStructHash(_i);
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), _body, _owner);
        hub.createFund(
            _symbol,
            _pixels,
            _coSig(_bodyKey, _genesis), _fundApproval(_userKey, _body),
            _i,
            _pair(_userKey, _typed(_body, _i.header.deadline, _structHash)),
            _pair(_userKey, _typed(_owner, _i.header.deadline, _structHash))
        );
        assertGt(_owner.code.length, 0, "createFund creates the owner account in the same transaction");
        assertEq(_nonceOf(_owner), 1, "and the foreign credit spends its first nonce, signed against a fresh account");
        assertGt(_i.shareToken.balanceOf(_body), 0, "minting the master on the spoke escrow alone");
    }

    function test_allocation_rate_paces_each_round_on_the_backers_balance() public {
        _openFund();
        _escrowOnHub(address(usdc), 1100e6);
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,,) = _backer("rate-x", _m);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _m, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), 99e18, "the first round takes 100 of the backer's balance");
        assertEq(usdc.balanceOf(_x), 899e6, "leaving 899 after the mandate's relay fee");

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 1000e6), _one(_x, _m, 449.5e6 + 1));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), 99e18, "a round above half of the 899 left is skipped");
        assertEq(usdc.balanceOf(_x), 899e6, "and pulls nothing");

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _m, 449.5e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_x), 99e18, "half of the balance joins, whatever the backer already holds");
        assertEq(usdc.balanceOf(_x), 449.5e6);

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 100e6), _one(_x, _m, 224.75e6 + 1));
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
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _half, 200e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_x), 199e18, "a backer within half of the master's 499 shares joins");
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_y, _half, 200e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_y), 199e18, "a second backer joins on the same cap, the first one's stake aside");

        MandateLib.Mandate memory _tenth = _mandateOf(1000, 0, vm.getBlockTimestamp() + 365 days);
        (address _z,,) = _backer("skin-z", _tenth);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_z, _tenth, 200e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _half, 100e6));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 200e6), _one(_x, _half, 100e6));
        uint _masterBefore = shareToken.balanceOf(body);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(body), _masterBefore, "the master contributes in the same round");
        assertGt(shareToken.balanceOf(_x), 199e18, "and its contribution lifts the backer's cap within the round");
        assertLe(
            shareToken.balanceOf(_x) * 2, shareToken.balanceOf(body), "the backer stays within half of the master's shares"
        );
    }

    function test_skin_zero_admits_a_row_while_the_master_holds_no_shares_and_the_rate_and_exit_cap_still_bind() public {
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
        _opening[0] = _row(_x, _bare, 100e6);
        _opening[1] = _row(_y, _skinned, 100e6);

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

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _bare, 449.5e6 + 1));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _bare, 449.5e6));
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

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_w, _tapered, 249.75e6 + 1));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        _rows[0] = _row(_w, _tapered, 249.75e6);
        _rows[1] = _row(_z, _frozen, 100e6);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_w), 0, "a fifth of the supply exiting against a 40% cap halves a skin-0 row's room");
        assertEq(shareToken.balanceOf(_z), 0, "and a cap the queue already fills freezes a skin-0 row");
        assertEq(usdc.balanceOf(_z), 999e6, "which pulls nothing");
        assertEq(shareToken.balanceOf(body), 0, "all while the master holds no shares");
    }

    function test_a_backers_queued_shares_count_toward_its_skin_until_they_fill() public {
        _openFund();
        MandateLib.Mandate memory _half = _mandateOf(5000, 0, vm.getBlockTimestamp() + 365 days);
        (address _x, uint _xKey, address _xUser) = _backer("queued-x", _half);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _half, 200e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        _sell(_xUser, _xKey, 199e18);
        assertEq(shareToken.balanceOf(_x), 199e18, "the backer's 199 shares stay locked in its balance, still exposed");
        assertEq(_queuedOf(_x), 199e18);
        _mandateCall(_xUser, _xKey, _list(_half));

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _half, 100e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);

        uint _exitedCost = fundStore.getHolding(body, _x).cost;
        _wethTo(body, 3000 ether);
        _redeem(0, 0, _list(_x));
        assertEq(_queuedOf(_x), 0, "the redemption pays the whole queue out");
        assertEq(shareToken.balanceOf(_x), 0, "and burns the queued shares");
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _half, 100e6));
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

    function test_a_round_waits_while_a_redemption_is_open() public {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,,) = _backer("open-x", _m);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _m, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _held = shareToken.balanceOf(_x);
        uint _masterHeld = shareToken.balanceOf(body);

        _wethTo(body, 3000 ether);
        _redeem(2500, 0, new address[](0));
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        assertGt(_r.owedLeft, 0, "the backer's quarter is still owed");

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _m, 100e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__Open.selector, _r.id));
        hub.allocate(_i, _sig, _ownerSig);

        uint _paidBefore = wnt.balanceOf(_x);
        uint _ownerBefore = wnt.balanceOf(master);
        hub.redeemCohort(shareToken, _list(_x));
        assertEq(shareToken.balanceOf(_x), _held - _held / 4, "the backer burns the same quarter");
        assertEq(shareToken.balanceOf(body), _masterHeld - _masterHeld / 4, "as the master did at the open");
        assertGt(wnt.balanceOf(_x), _paidBefore, "the cohort pays the backer its quarter in WETH");
        assertGt(wnt.balanceOf(master), _ownerBefore, "and the master last, once nobody else is owed");
        assertFalse(isOpen(fundStore.getRedemption(body)), "which closes the redemption");

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _m, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_x), _held - _held / 4, "the next round runs once the redemption closed");
    }

    function _walletBacker(
        string memory _tag,
        MandateLib.Mandate memory _m
    ) internal returns (address acct_, MockWallet1271 wallet_) {
        address _user;
        (acct_,, _user) = _backer(_tag, _m);
        vm.etch(_user, type(MockWallet1271).runtimeCode);
        wallet_ = MockWallet1271(_user);
        mandateSigOf[this.digestOf(acct_, _m)] = abi.encodePacked(bytes32(uint(1)), bytes32(uint(2)), uint8(27));
    }

    function _two(
        address _a,
        address _b,
        MandateLib.Mandate memory _m,
        uint _amount
    ) internal view returns (Fund.Allocation[] memory rows_) {
        rows_ = new Fund.Allocation[](2);
        (address _lo, address _hi) = uint160(_a) < uint160(_b) ? (_a, _b) : (_b, _a);
        rows_[0] = _row(_lo, _m, _amount);
        rows_[1] = _row(_hi, _m, _amount);
    }

    function test_a_backer_wallet_gets_one_verdict_per_row_and_cannot_revert_the_round() public {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,,) = _backer("verdict-x", _m);
        (address _w, MockWallet1271 _wallet) = _walletBacker("verdict-w", _m);
        _wallet.set(3, fundStore, body, _w);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _two(_x, _w, _m, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_x), 0, "the honest row joins");
        assertGt(
            shareToken.balanceOf(_w), 0, "the wallet is asked once, before its holding is stamped, so it cannot flip"
        );

        _wallet.set(1, fundStore, body, _w);
        uint _heldX = shareToken.balanceOf(_x);
        uint _heldW = shareToken.balanceOf(_w);
        FundStore.Holding memory _stamped = fundStore.getHolding(body, _w);
        usdc.mint(body, usdc.balanceOf(body));
        vm.warp(vm.getBlockTimestamp() + 1);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _two(_x, _w, _m, 100e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_x), _heldX, "a rejecting wallet costs the round only its own row");
        assertEq(shareToken.balanceOf(_w), _heldW, "the rejecting wallet mints nothing");
        assertEq(fundStore.getHolding(body, _w).allocatedAt, _stamped.allocatedAt, "and its holding keeps its last stamp");
        assertEq(fundStore.getHolding(body, _w).cost, _stamped.cost, "and its cost, though the round priced higher");
    }

    function test_a_backer_wallet_that_burns_its_gas_skips_only_its_own_row() public {
        _openFund();
        MandateLib.Mandate memory _m = _mandateOf(MAX_SKIN, 0, vm.getBlockTimestamp() + 365 days);
        (address _x,,) = _backer("bomb-x", _m);
        (address _w, MockWallet1271 _wallet) = _walletBacker("bomb-w", _m);
        _wallet.set(2, fundStore, body, _w);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _two(_x, _w, _m, 100e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        hub.allocate{gas: 600_000}(_i, _sig, _ownerSig);
        assertGt(shareToken.balanceOf(_x), 0, "the honest row joins within a bounded round");
        assertEq(shareToken.balanceOf(_w), 0, "the wallet burns at most the transfer gas limit and its row is skipped");
        assertEq(fundStore.getHolding(body, _w).allocatedAt, 0, "with nothing of its holding stamped");
        assertEq(fundStore.getHolding(body, _w).cost, 0, "nor costed");
    }
}
