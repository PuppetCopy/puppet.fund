// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {LibString} from "solady/utils/LibString.sol";

import {HubGate} from "src/HubGate.sol";
import {FULFIL_TYPEHASH, SpokeGate} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {Fund} from "src/core/Fund.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {GRID_BYTES, GRID_SIDE, PALETTE_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {BalanceLib} from "src/utils/BalanceLib.sol";
import {Error} from "src/utils/Error.sol";
import {GateConfig} from "src/utils/GateConfig.sol";
import {LiquidityGate, RETIRE_ESCROW_INTENT_TYPEHASH, RETURN_ESCROW_TYPEHASH} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {RouterProxy} from "src/utils/RouterProxy.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

import {HotPathTest} from "./HotPath.t.sol";
import {MockTarget} from "./mock/MockTarget.t.sol";

contract EscrowGovernanceTest is HotPathTest {
    bytes32 constant ROUND = keccak256("escrow-governance-round");
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function _grid() internal pure returns (bytes memory pixels_) {
        pixels_ = new bytes(GRID_BYTES);
        for (uint _p; _p < GRID_BYTES; ++_p) {
            pixels_[_p] = bytes1(uint8(_p < PALETTE_BYTES ? 1 + (_p * 37) % 255 : (_p - PALETTE_BYTES) % (PALETTE_BYTES / 3)));
        }
    }

    function _openFund() internal {
        _walletEscrow(hub, master, 500e6);
        _createFund(bytes32("EG"), 500e6);
    }

    function _createFund(
        bytes32 _symbol,
        uint _amount
    ) internal {
        bytes memory _pixels = _grid();
        shareToken = ShareToken(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(body, _symbol, _pixels, uint16(hub.performanceFee())),
                bytes32(uint(uint160(body))),
                address(hub)
            )
        );
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), _amount), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i));
    }

    function _creditRound(
        uint _chainId,
        uint _amount
    ) internal returns (bytes32 round_) {
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body), _nav(), _credit(_chainId, address(usdc), _amount), new Fund.Allocation[](0)
        );
        round_ = _allocateDigest(_i);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
    }

    function _walletEscrow(
        LiquidityGate _gate,
        address _user,
        uint _amount
    ) internal {
        usdc.mint(_user, _amount);
        vm.startPrank(_user);
        IERC20(address(usdc)).approve(address(depositModule), _amount);
        _gate.depositEscrow(address(usdc), _amount);
        vm.stopPrank();
    }

    function _storeSignature(
        address _store,
        address _body,
        uint _from,
        uint _total,
        uint _fee
    ) internal view returns (bytes memory) {
        return _coSig(
            attestorKey,
            AccountLib.typedDigest(
                block.chainid,
                _body,
                keccak256(abi.encode(FULFIL_TYPEHASH, _store, address(usdc), ROUND, _from, _total, _fee))
            )
        );
    }

    function _returnSignature(
        EscrowStore _store,
        address _owner,
        address _token,
        uint _from,
        uint _total,
        uint _deadline
    ) internal view returns (bytes memory) {
        return _coSig(
            attestorKey,
            AccountLib.typedDigest(
                block.chainid,
                _owner,
                keccak256(abi.encode(RETURN_ESCROW_TYPEHASH, address(_store), _token, _from, _total, _deadline))
            )
        );
    }

    function _returnEscrow(
        LiquidityGate _gate,
        address _owner,
        address _token,
        uint _total
    ) internal {
        EscrowStore _store = _gate.escrowStore();
        uint _from = _store.returnedMap(_owner, _token);
        uint _deadline = vm.getBlockTimestamp() + 300;
        _gate.returnEscrow(
            _owner, _token, _from, _total, _deadline, _returnSignature(_store, _owner, _token, _from, _total, _deadline)
        );
    }

    function _assertLedger(
        EscrowStore _store,
        address _owner,
        uint _escrowed,
        uint _released,
        uint _returned
    ) internal view {
        assertEq(_store.escrowedMap(_owner, address(usdc)), _escrowed, "the escrowed total counts every booking and never falls");
        assertEq(_store.releasedMap(_owner, address(usdc)), _released, "the released total counts every fund's draw");
        assertEq(_store.returnedMap(_owner, address(usdc)), _returned, "the returned total counts what went back to the wallet");
    }

    function _assertShareMismatch(
        address _master,
        address _shareToken
    ) internal {
        uint _before = gasleft();
        (bool _ok, bytes memory _ret) =
            address(hub).call{gas: 1_000_000}(abi.encodeCall(HubGate.verifyShare, (_master, ShareToken(_shareToken))));
        uint _spent = _before - gasleft();
        assertFalse(_ok, "a share that is not the master's clone is refused");
        assertEq(
            _ret,
            abi.encodeWithSelector(Error.Fund__ShareMismatch.selector, _master, _shareToken),
            "with the mismatch selector, not an out-of-gas"
        );
        assertLt(_spent, 100_000, "and without burning the forwarded gas");
    }

    function test_fulfil_signature_is_bound_to_fromTotal() public {
        _openFund();
        address _parent = _account(master);
        _walletEscrow(spoke, master, 300e6);
        bytes memory _first = _fulfilSignature(address(usdc), ROUND, 0, 100e6, FEE);
        bytes memory _overlap = _fulfilSignature(address(usdc), ROUND, 0, 250e6, FEE);
        uint _fees = usdc.balanceOf(feeReceiver);
        uint _held = usdc.balanceOf(body);

        spoke.fulfil(body, address(usdc), ROUND, 0, 100e6, FEE, _first, _noGenesis());
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 100e6, "the first release advances the total");

        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 100e6, 250e6));
        spoke.fulfil(body, address(usdc), ROUND, 0, 250e6, FEE, _overlap, _noGenesis());

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, address(usdc), ROUND, 100e6, 250e6, FEE, _overlap, _noGenesis());

        assertEq(usdc.balanceOf(feeReceiver), _fees + FEE, "the stale overlapping signature bills nothing");
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "and releases nothing");

        vm.recordLogs();
        spoke.fulfil(
            body,
            address(usdc),
            ROUND,
            100e6,
            250e6,
            FEE,
            _fulfilSignature(address(usdc), ROUND, 100e6, 250e6, FEE),
            _noGenesis()
        );
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 250e6, "a re-signed delta releases");
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), body),
            abi.encode(SpokeGate.fulfil.selector, address(usdc), ROUND, uint(100e6), uint(250e6), FEE),
            "the record carries the totals it moved between, never the delta"
        );
        assertEq(usdc.balanceOf(feeReceiver), _fees + 2 * FEE, "one fee per priced delta");
        assertEq(usdc.balanceOf(body), _held + 250e6 - 2 * FEE, "the body holds the whole release net of both fees");

        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 250e6, 100e6));
        spoke.fulfil(body, address(usdc), ROUND, 0, 100e6, FEE, _first, _noGenesis());
        assertEq(usdc.balanceOf(address(spokeEscrowStore)), 50e6, "the unreleased escrow stays in the store");
    }

    function test_fulfil_signature_is_bound_to_the_escrow_store() public {
        _openFund();
        address _parent = _account(master);
        _walletEscrow(spoke, master, 100e6);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(
            body,
            address(usdc),
            ROUND,
            0,
            100e6,
            FEE,
            _storeSignature(makeAddr("another-store"), body, 0, 100e6, FEE),
            _noGenesis()
        );

        bytes memory _old = _storeSignature(address(spokeEscrowStore), body, 0, 100e6, FEE);
        spoke.fulfil(body, address(usdc), ROUND, 0, 100e6, FEE, _old, _noGenesis());
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 100e6, "the store the signature names releases");

        EscrowStore _rekeyed = new EscrowStore(address(dictate), accountModule, feeReceiver, 1000);
        vm.startPrank(owner);
        address _proxy = dictate.setGate(
            bytes32("SpokeGate"), address(new SpokeGate(accountModule, depositModule, _rekeyed, spoke.getConfig()))
        );
        dictate.setAccess(_rekeyed, _proxy);
        vm.stopPrank();
        assertEq(_proxy, address(spoke), "the re-key keeps the gate address");
        assertEq(address(spoke.escrowStore()), address(_rekeyed), "and points it at the fresh ledger");

        _walletEscrow(spoke, master, 100e6);
        assertEq(_rekeyed.escrowedMap(_parent, address(usdc)), 100e6);
        assertEq(_rekeyed.fulfilledMap(_parent, body, address(usdc)), 0, "the fresh ledger starts at zero");

        uint _held = usdc.balanceOf(body);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, address(usdc), ROUND, 0, 100e6, FEE, _old, _noGenesis());

        spoke.fulfil(
            body,
            address(usdc),
            ROUND,
            0,
            100e6,
            FEE,
            _storeSignature(address(_rekeyed), body, 0, 100e6, FEE),
            _noGenesis()
        );
        assertEq(_rekeyed.fulfilledMap(_parent, body, address(usdc)), 100e6, "only a signature naming the new store releases");
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "exactly once");
        assertEq(usdc.balanceOf(address(_rekeyed)), 0);
    }

    function test_fulfil_fee_is_capped_by_max_relay_fee_bps() public {
        _openFund();
        _walletEscrow(spoke, master, 100e6);
        assertEq(spokeEscrowStore.maxFeeBps(), 1000, "the store's own cap is the limb a release checks");

        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 10e6 + 1, 100e6, 1000));
        spoke.fulfil(
            body,
            address(usdc),
            ROUND,
            0,
            100e6,
            10e6 + 1,
            _fulfilSignature(address(usdc), ROUND, 0, 100e6, 10e6 + 1),
            _noGenesis()
        );

        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 100e6, 100e6, 1000));
        spoke.fulfil(
            body, address(usdc), ROUND, 0, 100e6, 100e6, _fulfilSignature(address(usdc), ROUND, 0, 100e6, 100e6), _noGenesis()
        );

        uint _fees = usdc.balanceOf(feeReceiver);
        uint _held = usdc.balanceOf(body);
        spoke.fulfil(
            body, address(usdc), ROUND, 0, 100e6, 10e6, _fulfilSignature(address(usdc), ROUND, 0, 100e6, 10e6), _noGenesis()
        );
        assertEq(usdc.balanceOf(feeReceiver), _fees + 10e6, "a fee exactly at the cap is billed");
        assertEq(usdc.balanceOf(body), _held + 90e6, "and the rest of the release lands in the body");
    }

    function test_fulfil_releases_only_the_escrow_of_the_bodys_bound_owner() public {
        address _stranger = accountModule.predictUserAccount(backer);
        _walletEscrow(spoke, backer, 100e6);
        _openFund();
        address _parent = _account(master);
        (address _module, address _bound) = FundAccount(payable(body)).bound();
        assertEq(_module, address(accountModule));
        assertEq(_bound, _parent);
        uint _held = usdc.balanceOf(body);

        bytes memory _signed = _fulfilSignature(address(usdc), ROUND, 0, 100e6, FEE);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 100e6));
        spoke.fulfil(body, address(usdc), ROUND, 0, 100e6, FEE, _signed, _noGenesis());
        assertEq(spokeEscrowStore.releasedMap(_stranger, address(usdc)), 0, "a stranger's escrow is never released");
        assertEq(spokeEscrowStore.escrowedMap(_stranger, address(usdc)), 100e6);
        assertEq(usdc.balanceOf(body), _held, "into the body, even with an attestor signature");

        _walletEscrow(spoke, master, 100e6);
        spoke.fulfil(body, address(usdc), ROUND, 0, 100e6, FEE, _signed, _noGenesis());
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "the bound owner's escrow releases");
        assertEq(spokeEscrowStore.releasedMap(_parent, address(usdc)), 100e6, "drawn from the owner the body names");
        assertEq(spokeEscrowStore.releasedMap(_stranger, address(usdc)), 0, "and from no one else");
    }

    function test_fulfil_reads_the_owner_from_each_body_and_releases_only_to_it() public {
        _openFund();
        address _owner = _account(master);
        address _other = _account(backer);
        _walletEscrow(spoke, master, 100e6);
        _walletEscrow(spoke, backer, 100e6);
        (address _fresh, uint _freshKey) = makeAddrAndKey("fresh-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _freshKey);
        AccountLib.Genesis memory _genesis = AccountLib.Genesis({
            parent: _other,
            key: _coSig(_freshKey, AccountLib.genesisDigest(address(accountModule), _fresh, _other)),
            approval: _fundApproval(backerKey, _fresh)
        });

        bytes memory _forBody = _storeSignature(address(spokeEscrowStore), body, 0, 60e6, FEE);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_fresh, address(usdc), ROUND, 0, 60e6, FEE, _forBody, _genesis);

        spoke.fulfil(
            _fresh, address(usdc), ROUND, 0, 60e6, FEE, _storeSignature(address(spokeEscrowStore), _fresh, 0, 60e6, FEE), _genesis
        );
        (, address _bound) = FundAccount(payable(_fresh)).bound();
        assertEq(_bound, _other, "the first fulfil binds the fresh body to the parent its key signed");
        assertEq(usdc.balanceOf(_fresh), 60e6 - FEE, "and releases to that body net of the fee");
        assertEq(spokeEscrowStore.releasedMap(_other, address(usdc)), 60e6, "drawn from the escrow of the owner it read");
        assertEq(spokeEscrowStore.releasedMap(_owner, address(usdc)), 0, "never from another owner's");

        uint _held = usdc.balanceOf(body);
        bytes memory _beyond = _storeSignature(address(spokeEscrowStore), body, 0, 101e6, FEE);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 100e6, 101e6));
        spoke.fulfil(body, address(usdc), ROUND, 0, 101e6, FEE, _beyond, _noGenesis());
        spoke.fulfil(body, address(usdc), ROUND, 0, 60e6, FEE, _forBody, _noGenesis());
        assertEq(usdc.balanceOf(body) - _held, 60e6 - FEE, "the master's body is paid from the master's escrow");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)), 60e6, "each body keeps its own total");
        assertEq(spokeEscrowStore.fulfilledMap(_other, _fresh, address(usdc)), 60e6);
        assertEq(spokeEscrowStore.fulfilledMap(_owner, _fresh, address(usdc)), 0, "under its own owner only");
        assertEq(spokeEscrowStore.fulfilledMap(_other, body, address(usdc)), 0);

        bytes memory _rest = _storeSignature(address(spokeEscrowStore), _fresh, 60e6, 101e6, FEE);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 40e6, 41e6));
        spoke.fulfil(_fresh, address(usdc), ROUND, 60e6, 101e6, FEE, _rest, _noGenesis());
        assertEq(
            spokeEscrowStore.heldMap(address(usdc)), 80e6, "a body never borrows the open escrow of another owner on the store"
        );
    }

    function test_one_owner_escrow_funds_several_funds_on_each_store_and_never_its_account() public {
        _fundWallet(master, 2000e6);
        address _owner = _account(master);
        address _backer = _account(backer);
        _walletEscrow(hub, backer, 70e6);
        _walletEscrow(spoke, backer, 30e6);
        _walletEscrow(hub, master, 600e6);
        _retireEscrow(hub, hubEscrowStore, address(usdc), 300e6);
        _walletEscrow(spoke, master, 200e6);
        _retireEscrow(spoke, spokeEscrowStore, address(usdc), 100e6);
        uint _accountHeld = usdc.balanceOf(_owner);
        uint _consents = _nonceOf(_owner);
        uint _fees = usdc.balanceOf(feeReceiver);
        assertEq(_accountHeld, 1600e6 - 2 * FEE, "the account paid only the escrow it moved and the relay fees it signed");

        _createFund(bytes32("EGA"), 500e6);
        address _first = body;
        _fulfil(address(usdc), _creditRound(FOREIGN_CHAIN_ID, 120e6), 120e6, FEE);

        (body, bodyKey) = makeAddrAndKey("second-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), bodyKey);
        _createFund(bytes32("EGB"), 350e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _nav(), _credit(block.chainid, address(usdc), 60e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 50e6, 60e6));
        hub.allocate(_i, _sig, _ownerSig);
        vm.recordLogs();
        _creditRound(block.chainid, 30e6);
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), _owner),
            abi.encode(
                Fund.allocate.selector,
                body,
                _credit(block.chainid, address(usdc), 30e6),
                FEE,
                hubEscrowStore.fulfilledMap(_owner, body, address(usdc))
            ),
            "the owner's consent record names the fund, the credit, the slice billed from it and the fulfilled total"
        );
        _fulfil(address(usdc), _creditRound(FOREIGN_CHAIN_ID, 150e6), 150e6, FEE);

        bytes memory _over = _storeSignature(address(spokeEscrowStore), _first, 120e6, 151e6, FEE);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 30e6, 31e6));
        spoke.fulfil(_first, address(usdc), ROUND, 120e6, 151e6, FEE, _over, _noGenesis());

        _returnEscrow(hub, _owner, address(usdc), 15e6);
        _returnEscrow(spoke, _owner, address(usdc), 25e6);

        _assertLedger(hubEscrowStore, _owner, 900e6, 880e6, 15e6);
        _assertLedger(spokeEscrowStore, _owner, 300e6, 270e6, 25e6);
        _assertLedger(hubEscrowStore, _backer, 70e6, 0, 0);
        _assertLedger(spokeEscrowStore, _backer, 30e6, 0, 0);
        assertEq(hubEscrowStore.fulfilledMap(_owner, _first, address(usdc)), 500e6, "the first fund drew its local credit");
        assertEq(hubEscrowStore.fulfilledMap(_owner, body, address(usdc)), 380e6, "the second its two");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, _first, address(usdc)), 120e6, "each fulfilled its abroad credit");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)), 150e6, "on the spoke");
        assertEq(hubEscrowStore.heldMap(address(usdc)), 5e6 + 70e6, "the hub store owes each owner's open escrow");
        assertEq(usdc.balanceOf(address(hubEscrowStore)), 75e6, "and holds exactly that");
        assertEq(spokeEscrowStore.heldMap(address(usdc)), 5e6 + 30e6, "so does the spoke store");
        assertEq(usdc.balanceOf(address(spokeEscrowStore)), 35e6);
        assertEq(usdc.balanceOf(_first), 500e6 + 120e6 - 2 * FEE, "the first fund holds its credits net of their slices");
        assertEq(usdc.balanceOf(body), 350e6 + 30e6 + 150e6 - 3 * FEE, "the second its own");
        assertEq(
            usdc.balanceOf(_first) + usdc.balanceOf(body) + usdc.balanceOf(feeReceiver) - _fees,
            hubEscrowStore.releasedMap(_owner, address(usdc)) + spokeEscrowStore.releasedMap(_owner, address(usdc)),
            "every released unit reached a fund or the fee receiver"
        );
        assertEq(usdc.balanceOf(master), 40e6, "the wallet holds exactly what came back");
        assertEq(usdc.balanceOf(_owner), _accountHeld, "no round, fulfil or return touched the owner's account");
        assertEq(_nonceOf(_owner) - _consents, 5, "each settled credited round spent one owner consent");
        assertEq(
            hubEscrowStore.escrowedMap(_first, address(usdc)) + hubEscrowStore.escrowedMap(body, address(usdc))
                + spokeEscrowStore.escrowedMap(_first, address(usdc)) + spokeEscrowStore.escrowedMap(body, address(usdc)),
            0,
            "a fund body never holds escrow"
        );
    }

    function testFuzz_the_hub_escrow_ledger_matches_the_balance_deltas(
        uint _wallet,
        uint _retired,
        uint _first,
        uint _second,
        uint _back
    ) public {
        _wallet = bound(_wallet, 10e6, 1e15);
        _retired = bound(_retired, 1, 1e15);
        _fundWallet(master, 100e6);
        address _owner = _account(master);
        _walletEscrow(hub, backer, 70e6);
        _walletEscrow(hub, master, _wallet);
        usdc.mint(_owner, _retired + FEE);
        _retireEscrow(hub, hubEscrowStore, address(usdc), _retired);
        uint _escrowed = _wallet + _retired;
        _first = bound(_first, 10e6, _escrowed);
        _second = bound(_second, 0, _escrowed - _first);
        if (_second < 10e6) _second = 0;
        _back = bound(_back, 0, _escrowed - _first - _second);
        uint _fees = usdc.balanceOf(feeReceiver);

        _createFund(bytes32("EG"), _first);
        if (_second > 0) _creditRound(block.chainid, _second);
        if (_back > 0) _returnEscrow(hub, _owner, address(usdc), _back);

        uint _billed = (_second > 0 ? 2 : 1) * FEE;
        assertEq(usdc.balanceOf(body), _first + _second - _billed, "the body receives each local credit net of its slice");
        assertEq(usdc.balanceOf(feeReceiver) - _fees, _billed, "the store's fee receiver exactly the slices");
        assertEq(usdc.balanceOf(master), _back, "the wallet exactly the return");
        assertEq(usdc.balanceOf(_owner), 100e6, "and the owner's account nothing");
        _assertLedger(hubEscrowStore, _owner, _escrowed, _first + _second, _back);
        assertEq(hubEscrowStore.fulfilledMap(_owner, body, address(usdc)), _first + _second, "the body's total is its credits");
        assertEq(
            hubEscrowStore.heldMap(address(usdc)),
            70e6 + _escrowed - _first - _second - _back,
            "the store owes each owner's open escrow"
        );
        assertEq(usdc.balanceOf(address(hubEscrowStore)), hubEscrowStore.heldMap(address(usdc)), "and holds exactly that");
    }

    function testFuzz_the_spoke_escrow_ledger_matches_the_balance_deltas(
        uint _wallet,
        uint _retired,
        uint _first,
        uint _second,
        uint _firstFee,
        uint _secondFee,
        uint _back
    ) public {
        _wallet = bound(_wallet, 1, 1e15);
        _retired = bound(_retired, 1, 1e15);
        _openFund();
        _fundWallet(master, 100e6);
        address _owner = _account(master);
        _walletEscrow(spoke, backer, 30e6);
        _walletEscrow(spoke, master, _wallet);
        usdc.mint(_owner, _retired + FEE);
        _retireEscrow(spoke, spokeEscrowStore, address(usdc), _retired);
        uint _escrowed = _wallet + _retired;
        _first = bound(_first, 1, _escrowed);
        _second = bound(_second, _first, _escrowed);
        _firstFee = bound(_firstFee, 0, _first / 10);
        _secondFee = bound(_secondFee, 0, (_second - _first) / 10);
        _back = bound(_back, 0, _escrowed - _second);
        uint[3] memory _before = [usdc.balanceOf(body), usdc.balanceOf(feeReceiver), usdc.balanceOf(master)];

        spoke.fulfil(
            body, address(usdc), ROUND, 0, _first, _firstFee, _fulfilSignature(address(usdc), ROUND, 0, _first, _firstFee), _noGenesis()
        );
        spoke.fulfil(
            body,
            address(usdc),
            ROUND,
            _first,
            _second,
            _secondFee,
            _fulfilSignature(address(usdc), ROUND, _first, _second, _secondFee),
            _noGenesis()
        );
        if (_back > 0) _returnEscrow(spoke, _owner, address(usdc), _back);

        assertEq(usdc.balanceOf(body) - _before[0], _second - _firstFee - _secondFee, "the body receives each release net of its fee");
        assertEq(usdc.balanceOf(feeReceiver) - _before[1], _firstFee + _secondFee, "the fee receiver exactly the fees");
        assertEq(usdc.balanceOf(master) - _before[2], _back, "the wallet exactly the return");
        assertEq(usdc.balanceOf(_owner), 100e6, "and the owner's account nothing");
        _assertLedger(spokeEscrowStore, _owner, _escrowed, _second, _back);
        assertEq(spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)), _second, "the body's total is its last fulfil");
        assertEq(
            spokeEscrowStore.heldMap(address(usdc)), 30e6 + _escrowed - _second - _back, "the store owes each owner's open escrow"
        );
        assertEq(usdc.balanceOf(address(spokeEscrowStore)), spokeEscrowStore.heldMap(address(usdc)), "and holds exactly that");

        uint _open = _escrowed - _second - _back;
        bytes memory _beyond = _fulfilSignature(address(usdc), ROUND, _second, _second + _open + 1, 0);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, _open, _open + 1));
        spoke.fulfil(body, address(usdc), ROUND, _second, _second + _open + 1, 0, _beyond, _noGenesis());
    }

    function test_returnEscrow_pays_the_owners_wallet_only_up_to_the_open_escrow() public {
        _openFund();
        _fundWallet(master, 100e6);
        address _owner = _account(master);
        _walletEscrow(hub, master, 300e6);
        _creditRound(block.chainid, 100e6);
        _walletEscrow(spoke, master, 300e6);
        _fulfil(address(usdc), _creditRound(FOREIGN_CHAIN_ID, 100e6), 100e6, FEE);

        _returnsOnlyTheOpenEscrow(hub, spokeEscrowStore);
        _returnsOnlyTheOpenEscrow(spoke, hubEscrowStore);
        assertEq(usdc.balanceOf(_owner), 100e6, "no return ever lands in the owner's account");
        assertEq(usdc.balanceOf(master), 400e6, "both stores returned their open escrow to the wallet");

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _nav(), _credit(block.chainid, address(usdc), 10e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 10e6));
        hub.allocate(_i, _sig, _ownerSig);
        bytes memory _signed = _fulfilSignature(address(usdc), ROUND, 100e6, 110e6, FEE);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 10e6));
        spoke.fulfil(body, address(usdc), ROUND, 100e6, 110e6, FEE, _signed, _noGenesis());
    }

    function _returnsOnlyTheOpenEscrow(
        LiquidityGate _gate,
        EscrowStore _other
    ) internal {
        EscrowStore _store = _gate.escrowStore();
        address _owner = _account(master);
        uint _released = _store.releasedMap(_owner, address(usdc));
        assertEq(_store.escrowedMap(_owner, address(usdc)) - _released, 200e6, "the owner's open escrow on this store");
        uint _wallet = usdc.balanceOf(master);
        uint _now = vm.getBlockTimestamp();

        bytes memory _over = _returnSignature(_store, _owner, address(usdc), 0, 200e6 + 1, _now + 300);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 200e6, 200e6 + 1));
        _gate.returnEscrow(_owner, address(usdc), 0, 200e6 + 1, _now + 300, _over);

        bytes memory _elsewhere = _returnSignature(_other, _owner, address(usdc), 0, 150e6, _now + 300);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        _gate.returnEscrow(_owner, address(usdc), 0, 150e6, _now + 300, _elsewhere);

        bytes memory _late = _returnSignature(_store, _owner, address(usdc), 0, 150e6, _now - 1);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__ExpiredDeadline.selector, _now - 1, _now));
        _gate.returnEscrow(_owner, address(usdc), 0, 150e6, _now - 1, _late);

        bytes memory _far = _returnSignature(_store, _owner, address(usdc), 0, 150e6, _now + 601);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__DeadlineTooFar.selector, _now + 601, _now, 600));
        _gate.returnEscrow(_owner, address(usdc), 0, 150e6, _now + 601, _far);

        bytes memory _part = _returnSignature(_store, _owner, address(usdc), 0, 150e6, _now + 300);
        vm.recordLogs();
        _gate.returnEscrow(_owner, address(usdc), 0, 150e6, _now + 300, _part);
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), _owner),
            abi.encode(LiquidityGate.returnEscrow.selector, address(usdc), uint(0), uint(150e6)),
            "the record carries the running returned total"
        );
        assertEq(usdc.balanceOf(master) - _wallet, 150e6, "the return pays the owner's wallet");

        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidReturn.selector, 150e6, 150e6));
        _gate.returnEscrow(_owner, address(usdc), 0, 150e6, _now + 300, _part);

        vm.recordLogs();
        _returnEscrow(_gate, _owner, address(usdc), 200e6);
        assertEq(usdc.balanceOf(master) - _wallet, 200e6, "the rest follows on a fresh total");
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), _owner),
            abi.encode(LiquidityGate.returnEscrow.selector, address(usdc), uint(150e6), uint(200e6)),
            "recorded as the totals it moved between, never the delta"
        );
        bytes memory _beyond = _returnSignature(_store, _owner, address(usdc), 200e6, 200e6 + 1, _now + 300);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 1));
        _gate.returnEscrow(_owner, address(usdc), 200e6, 200e6 + 1, _now + 300, _beyond);
        assertEq(_store.returnedMap(_owner, address(usdc)), 200e6, "the returned total stops at the open escrow");
        assertEq(
            _store.escrowedMap(_owner, address(usdc)), _released + 200e6, "every escrowed unit is now released or returned"
        );
    }

    function test_escrow_refuses_an_unfunded_booking_and_returns_the_new_escrowed_total() public {
        address _accessor = makeAddr("escrow-accessor");
        vm.startPrank(owner);
        dictate.setAccess(hubEscrowStore, _accessor);
        dictate.setAccess(spokeEscrowStore, _accessor);
        vm.stopPrank();
        _booksOnlyWhatItHolds(hubEscrowStore, _accessor);
        _booksOnlyWhatItHolds(spokeEscrowStore, _accessor);
    }

    function _booksOnlyWhatItHolds(
        EscrowStore _store,
        address _accessor
    ) internal {
        address _a = makeAddr("owner-a");
        address _b = makeAddr("owner-b");
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _store.escrow(_a, address(usdc), 0);

        vm.startPrank(_accessor);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__Unfunded.selector, address(usdc), 0, 1));
        _store.escrow(_a, address(usdc), 1);
        usdc.mint(address(_store), 70e6);
        assertEq(_store.escrow(_a, address(usdc), 40e6), 40e6, "a booking returns the owner's new escrowed total");
        assertEq(_store.escrow(_b, address(usdc), 10e6), 10e6, "kept per owner");
        assertEq(_store.escrow(_a, address(usdc), 20e6), 60e6, "a second booking returns the running total, not its amount");
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__Unfunded.selector, address(usdc), 70e6, 70e6 + 1));
        _store.escrow(_b, address(usdc), 1);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__Unfunded.selector, address(wnt), 0, 1));
        _store.escrow(_b, address(wnt), 1);
        vm.stopPrank();

        assertEq(_store.heldMap(address(usdc)), 70e6, "the store owes exactly what it holds");
        assertEq(_store.escrowedMap(_a, address(usdc)), 60e6);
        assertEq(_store.escrowedMap(_b, address(usdc)), 10e6);
    }

    function test_an_escrow_accessor_moves_escrow_only_along_its_own_ledger() public {
        _openFund();
        address _parent = _account(master);
        _walletEscrow(spoke, master, 40e6);
        address _rogue = makeAddr("rogue-accessor");
        vm.prank(owner);
        dictate.setAccess(spokeEscrowStore, _rogue);
        uint[4] memory _before =
            [usdc.balanceOf(_parent), usdc.balanceOf(master), usdc.balanceOf(body), usdc.balanceOf(feeReceiver)];
        assertEq(spokeEscrowStore.heldMap(address(usdc)), 40e6, "the store owes exactly the open escrow");

        vm.startPrank(_rogue);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__Unfunded.selector, address(usdc), 40e6, 40e6 + 1));
        spokeEscrowStore.escrow(_rogue, address(usdc), 1);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 3e6 + 1, 30e6, 1000));
        spokeEscrowStore.release(_parent, body, address(usdc), 30e6, 3e6 + 1, 200_000);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NotDelegated.selector, _rogue));
        spokeEscrowStore.release(_parent, _rogue, address(usdc), 30e6, 0, 200_000);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 40e6, 41e6));
        spokeEscrowStore.refund(_parent, address(usdc), 41e6, 200_000);
        spokeEscrowStore.refund(_parent, address(usdc), 10e6, 200_000);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 30e6, 31e6));
        spokeEscrowStore.release(_parent, body, address(usdc), 31e6, 3e6, 200_000);
        spokeEscrowStore.release(_parent, body, address(usdc), 30e6, 3e6, 200_000);
        vm.stopPrank();

        assertEq(usdc.balanceOf(_parent), _before[0], "a refund never lands in the owner's account");
        assertEq(usdc.balanceOf(master) - _before[1], 10e6, "the store pays the owner's own wallet, whoever calls");
        assertEq(usdc.balanceOf(body) - _before[2], 27e6, "a release goes only to a fund the owner's account opened");
        assertEq(usdc.balanceOf(_rogue), 0, "so an accessor can never take escrow for itself");
        assertEq(usdc.balanceOf(feeReceiver) - _before[3], 3e6, "with at most a tenth to the store's fixed fee receiver");
        assertEq(spokeEscrowStore.heldMap(address(usdc)), 0, "the ledger is settled");
        assertEq(usdc.balanceOf(address(spokeEscrowStore)), 0, "and so is the store");
    }

    function test_a_native_escrow_carries_its_whole_amount_as_value() public {
        _nativeEscrow(hub, "hub");
        _nativeEscrow(spoke, "spoke");
    }

    function _nativeEscrow(
        LiquidityGate _gate,
        string memory _tag
    ) internal {
        EscrowStore _store = _gate.escrowStore();
        address _wallet = makeAddr(string.concat("native-", _tag));
        address _acct = accountModule.predictUserAccount(_wallet);
        vm.deal(address(_store), 1 ether);
        vm.deal(_wallet, 1.4 ether);
        _wethTo(_wallet, 1 ether);
        vm.startPrank(_wallet);
        IERC20(address(wnt)).approve(address(depositModule), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__ValueMismatch.selector, 0, 1 ether));
        _gate.depositEscrow(NATIVE_TOKEN, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__ValueMismatch.selector, 0.4 ether, 1 ether));
        _gate.depositEscrow{value: 0.4 ether}(NATIVE_TOKEN, 1 ether);
        vm.recordLogs();
        _gate.depositEscrow{value: 1 ether}(NATIVE_TOKEN, 1 ether);
        vm.stopPrank();
        assertEq(
            _store.escrowedMap(_acct, NATIVE_TOKEN),
            1 ether,
            "a native escrow books only the native it carried, never wrapped value pulled beside it"
        );
        assertEq(wnt.balanceOf(address(_store)), 0, "and no WETH lands in the store under a native booking");
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), _acct),
            abi.encode(LiquidityGate.depositEscrow.selector, NATIVE_TOKEN, uint(1 ether), uint(1 ether), uint(1 ether)),
            "the gate records the attached value beside the escrowed total"
        );

        _returnEscrow(_gate, _acct, NATIVE_TOKEN, 1 ether);
        assertEq(_wallet.balance, 1.4 ether, "the escrow returns to the wallet as native");
        assertEq(_store.heldMap(NATIVE_TOKEN), 0, "the store owes nothing more");
        assertEq(address(_store).balance, 1 ether, "and keeps only the balance it never booked");
    }

    function test_eth_escrows_fused_as_weth_from_attached_value_and_wallet_weth() public {
        _fusedEscrow(hub, "hub");
        _fusedEscrow(spoke, "spoke");
    }

    function _fusedEscrow(
        LiquidityGate _gate,
        string memory _tag
    ) internal {
        EscrowStore _store = _gate.escrowStore();
        address _wallet = makeAddr(string.concat("fused-", _tag));
        address _acct = accountModule.predictUserAccount(_wallet);
        vm.deal(_wallet, 0.4 ether);
        _wethTo(_wallet, 0.6 ether);
        vm.startPrank(_wallet);
        IERC20(address(wnt)).approve(address(depositModule), 0.6 ether);
        vm.recordLogs();
        _gate.depositEscrow{value: 0.4 ether}(address(wnt), 1 ether);
        vm.stopPrank();
        assertEq(_store.escrowedMap(_acct, address(wnt)), 1 ether, "the fused ETH escrow books WETH");
        assertEq(wnt.balanceOf(address(_store)), 1 ether, "wrapping the attached 0.4 ETH beside 0.6 wallet WETH");
        assertEq(_wallet.balance, 0, "the attached ETH is spent");
        assertEq(wnt.balanceOf(_wallet), 0, "and so is the wallet WETH");
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), _acct),
            abi.encode(LiquidityGate.depositEscrow.selector, address(wnt), uint(1 ether), uint(0.4 ether), uint(1 ether)),
            "the record carries the amount, the attached value and the escrowed total"
        );

        _wethTo(_wallet, 0.5 ether);
        vm.startPrank(_wallet);
        IERC20(address(wnt)).approve(address(depositModule), 0.5 ether);
        vm.recordLogs();
        _gate.depositEscrow(address(wnt), 0.5 ether);
        vm.stopPrank();
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), _acct),
            abi.encode(LiquidityGate.depositEscrow.selector, address(wnt), uint(0.5 ether), uint(0), uint(1.5 ether)),
            "a second escrow records the running total, never just its amount"
        );
        assertEq(_store.escrowedMap(_acct, address(wnt)), 1.5 ether);
    }

    function _lastRecordOf(
        Vm.Log[] memory _logs,
        address _acct
    ) internal view returns (bytes memory executionData_) {
        for (uint _i; _i < _logs.length; ++_i) {
            if (_logs[_i].emitter != address(accountModule) || _logs[_i].topics[0] != AccountModule.AccountCall.selector) continue;
            if (_logs[_i].topics[1] != bytes32(uint(uint160(_acct)))) continue;
            (,,,,, executionData_,,,) =
                abi.decode(_logs[_i].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[]));
        }
    }

    function _escrowFromAccount(
        uint _userKey,
        address _acct,
        uint _amount
    ) internal view returns (LiquidityGate.RetireEscrowIntent memory intent_, bytes memory signature_) {
        intent_ = LiquidityGate.RetireEscrowIntent({
            header: _header(_acct, vm.addr(_userKey), _acct.code.length == 0 ? 0 : _nonceOf(_acct)),
            token: address(usdc),
            amount: _amount
        });
        signature_ = _pair(
            _userKey,
            _typed(
                _acct,
                intent_.header.deadline,
                keccak256(abi.encode(RETIRE_ESCROW_INTENT_TYPEHASH, _hashHeader(intent_.header), intent_.token, intent_.amount))
            )
        );
    }

    function test_an_account_escrows_funds_that_landed_in_it_under_its_own_signed_intent() public {
        _accountEscrowsWhatLanded(hub, "hub");
        _accountEscrowsWhatLanded(spoke, "spoke");
    }

    function _accountEscrowsWhatLanded(
        LiquidityGate _gate,
        string memory _tag
    ) internal {
        EscrowStore _store = _gate.escrowStore();
        (address _user, uint _userKey) = makeAddrAndKey(string.concat("bridged-user-", _tag));
        address _acct = accountModule.predictUserAccount(_user);
        usdc.mint(_acct, 150e6 + 2 * FEE);
        (LiquidityGate.RetireEscrowIntent memory _intent, bytes memory _sig) = _escrowFromAccount(_userKey, _acct, 100e6);
        uint _fees = usdc.balanceOf(feeReceiver);
        vm.recordLogs();
        vm.prank(makeAddr("matchmaker"));
        _gate.retireEscrow(_intent, _sig);
        assertGt(_acct.code.length, 0, "a bridge that landed before the account existed escrows once the account is created");
        assertEq(_store.escrowedMap(_acct, address(usdc)), 100e6, "under the account's own key, as a wallet escrow books it");
        assertEq(usdc.balanceOf(_acct), 50e6 + FEE, "the escrowed funds leave the account");
        assertEq(usdc.balanceOf(address(_store)), 100e6, "into the store of the gate that relayed it");
        assertEq(usdc.balanceOf(feeReceiver), _fees + FEE, "paying the relay fee it signed");
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), _acct),
            abi.encode(LiquidityGate.retireEscrow.selector, address(usdc), uint(100e6), uint(100e6), address(usdc), FEE),
            "the record carries the amount and the account's escrowed total after it"
        );

        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, _acct, 1, 0));
        _gate.retireEscrow(_intent, _sig);

        (_intent, _sig) = _escrowFromAccount(_userKey, _acct, 50e6);
        vm.recordLogs();
        _gate.retireEscrow(_intent, _sig);
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), _acct),
            abi.encode(LiquidityGate.retireEscrow.selector, address(usdc), uint(50e6), uint(150e6), address(usdc), FEE),
            "a second escrow records the running total"
        );
        assertEq(usdc.balanceOf(_acct), 0);
    }

    function test_only_the_accounts_own_user_moves_its_funds_into_escrow() public {
        _openFund();
        (address _user, uint _userKey) = makeAddrAndKey("bridged-user");
        (, uint _strangerKey) = makeAddrAndKey("stranger");
        address _acct = _account(_user);
        usdc.mint(_acct, 100e6 + FEE);
        uint _fundHeld = usdc.balanceOf(body);
        LiquidityGate[2] memory _gates = [LiquidityGate(hub), LiquidityGate(spoke)];
        for (uint _g; _g < 2; ++_g) {
            (LiquidityGate.RetireEscrowIntent memory _forged, bytes memory _forgedSig) =
                _escrowFromAccount(_strangerKey, _acct, 100e6);
            vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, _acct));
            _gates[_g].retireEscrow(_forged, _forgedSig);

            (LiquidityGate.RetireEscrowIntent memory _intent,) = _escrowFromAccount(_userKey, _acct, 100e6);
            (, bytes memory _strangerSig) = _escrowFromAccount(_strangerKey, _acct, 100e6);
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            _gates[_g].retireEscrow(_intent, _strangerSig);

            (LiquidityGate.RetireEscrowIntent memory _fromBody, bytes memory _bodySig) =
                _escrowFromAccount(masterKey, body, 100e6);
            vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
            _gates[_g].retireEscrow(_fromBody, _bodySig);
            assertEq(
                _gates[_g].escrowStore().escrowedMap(body, address(usdc)),
                0,
                "a fund body never escrows, not even under its owner's signature"
            );
        }
        assertEq(usdc.balanceOf(_acct), 100e6 + FEE, "nothing moves without the account's own user");
        assertEq(usdc.balanceOf(body), _fundHeld, "and nothing leaves the fund");
    }

    function test_an_account_escrow_releases_into_its_fund_like_a_wallet_escrow() public {
        _openFund();
        address _parent = _account(master);
        usdc.mint(_parent, 100e6 + FEE);
        (LiquidityGate.RetireEscrowIntent memory _intent, bytes memory _sig) = _escrowFromAccount(masterKey, _parent, 100e6);
        spoke.retireEscrow(_intent, _sig);
        uint _held = usdc.balanceOf(body);
        spoke.fulfil(
            body, address(usdc), ROUND, 0, 100e6, FEE, _fulfilSignature(address(usdc), ROUND, 0, 100e6, FEE), _noGenesis()
        );
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 100e6, "the round's release draws on it");
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "into the fund body, net of the round fee");
    }

    function test_a_repeated_fulfil_lands_once_so_a_copied_call_cannot_fail_the_matchmakers() public {
        _openFund();
        address _parent = _account(master);
        _walletEscrow(spoke, master, 300e6);
        bytes memory _signed = _fulfilSignature(address(usdc), ROUND, 0, 100e6, FEE);
        uint _held = usdc.balanceOf(body);

        vm.recordLogs();
        vm.prank(makeAddr("copier"));
        spoke.fulfil(body, address(usdc), ROUND, 0, 100e6, FEE, _signed, _noGenesis());
        assertEq(
            _lastRecordOf(vm.getRecordedLogs(), body),
            abi.encode(SpokeGate.fulfil.selector, address(usdc), ROUND, uint(0), uint(100e6), FEE),
            "the record names no owner: the body's own parent is the owner"
        );
        vm.recordLogs();
        spoke.fulfil(body, address(usdc), ROUND, 0, 100e6, FEE, _signed, _noGenesis());
        assertEq(vm.getRecordedLogs().length, 0, "the matchmaker's own submission after a copy lands nothing and reverts nothing");
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 100e6, "the release counts once");
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "and pays once");
    }

    function test_neither_gate_offers_a_user_refund_and_each_gate_escrows_into_its_own_store() public {
        _openFund();
        address _owner = _account(master);
        _walletEscrow(spoke, master, 30e6);
        _walletEscrow(hub, master, 20e6);
        assertEq(address(hub.escrowStore()), address(hubEscrowStore), "the hub gate escrows into the hub store");
        assertEq(address(fundModule.escrowStore()), address(hubEscrowStore), "the one a hub round releases from");
        assertEq(address(spoke.escrowStore()), address(spokeEscrowStore), "and the spoke gate into its own");
        _assertLedger(hubEscrowStore, _owner, 520e6, 500e6, 0);
        _assertLedger(spokeEscrowStore, _owner, 30e6, 0, 0);

        (bool _ok,) = address(spoke).call(abi.encodeWithSignature("refund(address,address,uint256)", body, address(usdc), 1));
        assertFalse(_ok, "a spoke cannot see hub credits, so it offers no refund outside the attested return");
        (_ok,) = address(hub).call(abi.encodeWithSignature("refund(address,address,uint256)", body, address(usdc), 1));
        assertFalse(_ok, "nor does the hub");
        bytes memory _call = abi.encodeCall(
            SpokeGate.fulfil,
            (body, address(usdc), ROUND, 0, 10e6, FEE, _fulfilSignature(address(usdc), ROUND, 0, 10e6, FEE), _noGenesis())
        );
        (_ok,) = address(hub).call(_call);
        assertFalse(_ok, "the hub has no fulfil: its escrow leaves only through a round the owner co-signs, or a return");
        (_ok,) = address(spoke).call(_call);
        assertTrue(_ok, "while the same call releases on the spoke");
        assertEq(spokeEscrowStore.releasedMap(_owner, address(usdc)), 10e6);
        assertEq(hubEscrowStore.releasedMap(_owner, address(usdc)), 500e6, "and leaves the hub store alone");
    }

    function test_governance_wires_a_new_gate_to_an_escrow_store_and_removing_access_stops_it() public {
        _openFund();
        address _owner = _account(master);
        vm.startPrank(owner);
        SpokeGate _next = SpokeGate(
            dictate.setGate(
                bytes32("SpokeGate2"),
                address(new SpokeGate(accountModule, depositModule, spokeEscrowStore, spoke.getConfig()))
            )
        );
        dictate.setAccess(accountModule, address(_next));
        dictate.setAccess(depositModule, address(_next));
        vm.stopPrank();
        assertEq(address(_next.escrowStore()), address(spokeEscrowStore), "the new gate names the live store");
        usdc.mint(master, 150e6);
        vm.prank(master);
        IERC20(address(usdc)).approve(address(depositModule), 150e6);

        vm.prank(master);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _next.depositEscrow(address(usdc), 100e6);
        vm.prank(backer);
        vm.expectRevert(Error.Dictate__Unauthorized.selector);
        dictate.setAccess(spokeEscrowStore, address(_next));
        vm.expectRevert(Error.Access__CallerNotAuthority.selector);
        spokeEscrowStore.setAccess(address(_next), true);

        vm.prank(owner);
        dictate.setAccess(spokeEscrowStore, address(_next));
        vm.prank(master);
        _next.depositEscrow(address(usdc), 100e6);
        assertEq(spokeEscrowStore.escrowedMap(_owner, address(usdc)), 100e6, "once wired, the new gate books into the live ledger");

        bytes memory _signed = _fulfilSignature(address(usdc), ROUND, 0, 40e6, FEE);
        _next.fulfil(body, address(usdc), ROUND, 0, 40e6, FEE, _signed, _noGenesis());
        uint _held = usdc.balanceOf(body);
        spoke.fulfil(body, address(usdc), ROUND, 0, 40e6, FEE, _signed, _noGenesis());
        assertEq(usdc.balanceOf(body), _held, "both gates read one fulfilled total, so the release lands once");
        assertEq(spokeEscrowStore.releasedMap(_owner, address(usdc)), 40e6);

        vm.prank(owner);
        dictate.removeAccess(spokeEscrowStore, address(_next));
        vm.prank(master);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _next.depositEscrow(address(usdc), 50e6);
        bytes memory _more = _fulfilSignature(address(usdc), ROUND, 40e6, 60e6, FEE);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _next.fulfil(body, address(usdc), ROUND, 40e6, 60e6, FEE, _more, _noGenesis());
        uint _deadline = vm.getBlockTimestamp() + 300;
        bytes memory _back = _returnSignature(spokeEscrowStore, _owner, address(usdc), 0, 10e6, _deadline);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _next.returnEscrow(_owner, address(usdc), 0, 10e6, _deadline, _back);

        spoke.fulfil(body, address(usdc), ROUND, 40e6, 60e6, FEE, _more, _noGenesis());
        spoke.returnEscrow(_owner, address(usdc), 0, 10e6, _deadline, _back);
        _assertLedger(spokeEscrowStore, _owner, 100e6, 60e6, 10e6);
        assertEq(usdc.balanceOf(master), 60e6, "the gate that keeps its access still releases and returns");

        vm.prank(owner);
        dictate.removeAccess(hubEscrowStore, address(fundModule));
        _walletEscrow(hub, master, 50e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _nav(), _credit(block.chainid, address(usdc), 50e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hub.allocate(_i, _sig, _ownerSig);
        _creditRound(FOREIGN_CHAIN_ID, 50e6);
        vm.prank(owner);
        dictate.setAccess(hubEscrowStore, address(fundModule));
        _creditRound(block.chainid, 50e6);
        _assertLedger(hubEscrowStore, _owner, 550e6, 550e6, 0);
    }

    function test_gateOf_is_the_proxy_setGate_returns_and_setGate_is_idempotent() public {
        assertEq(dictate.gateOf(bytes32("HubGate")), address(hub));
        assertEq(dictate.gateOf(bytes32("SpokeGate")), address(spoke));
        assertEq(dictate.gateOf(bytes32("Fund")), address(fundModule));
        assertEq(dictate.gateOf(bytes32("Deposit")), address(depositModule));

        bytes32 _name = bytes32("Fresh");
        address _predicted = vm.computeCreate2Address(
            _name,
            keccak256(abi.encodePacked(type(RouterProxy).creationCode, abi.encode(address(dictate)))),
            address(dictate)
        );
        assertEq(dictate.gateOf(_name), _predicted, "the gate address is the CREATE2 of the proxy under the name");
        assertEq(_predicted.code.length, 0);

        address _first = address(new MockTarget());
        address _second = address(new MockTarget());

        vm.prank(backer);
        vm.expectRevert(Error.Dictate__Unauthorized.selector);
        dictate.setGate(_name, _first);

        vm.prank(owner);
        address _proxy = dictate.setGate(_name, _first);
        assertEq(_proxy, _predicted, "setGate returns the derived address");
        assertEq(address(uint160(uint(vm.load(_proxy, IMPLEMENTATION_SLOT)))), _first);

        vm.prank(owner);
        assertEq(dictate.setGate(_name, _first), _proxy, "setting the same impl again is a no-op at the same address");
        assertEq(address(uint160(uint(vm.load(_proxy, IMPLEMENTATION_SLOT)))), _first);

        vm.prank(owner);
        assertEq(dictate.setGate(_name, _second), _proxy, "an upgrade keeps the address");
        assertEq(address(uint160(uint(vm.load(_proxy, IMPLEMENTATION_SLOT)))), _second);
        vm.expectCall(_second, abi.encodeCall(MockTarget.ping, ()), 1);
        vm.expectCall(_first, abi.encodeCall(MockTarget.ping, ()), 0);
        MockTarget(_proxy).ping();

        address _hubImpl = address(uint160(uint(vm.load(address(hub), IMPLEMENTATION_SLOT))));
        vm.prank(owner);
        assertEq(dictate.setGate(bytes32("HubGate"), _hubImpl), address(hub));

        vm.prank(owner);
        vm.expectRevert(Error.Access__CallerNotAuthority.selector);
        RouterProxy(payable(_proxy)).upgrade(_first);
    }

    function test_canonical_list_lives_in_the_gate_implementation() public {
        address _impl = address(uint160(uint(vm.load(address(hub), IMPLEMENTATION_SLOT))));
        assertTrue(hub.isCanonical(address(usdc)), "the proxy answers from the implementation's list");
        assertTrue(hub.isCanonical(address(wnt)), "every listed token is canonical");
        assertFalse(hub.isCanonical(address(outToken)), "an unlisted token is not");
        assertTrue(HubGate(_impl).isCanonical(address(usdc)), "the implementation answers the same, from its own storage");

        GateConfig memory _config = hub.getConfig();
        vm.expectRevert(abi.encodeWithSelector(Error.Gate__InvalidCanonicalToken.selector, NATIVE_TOKEN));
        new HubGate(
            accountModule,
            depositModule,
            hubEscrowStore,
            mandateStore,
            fundModule,
            redeemModule,
            _config,
            _endpoints(ATTESTOR_ENDPOINT),
            _list(NATIVE_TOKEN),
            50,
            PERFORMANCE_FEE,
            WEBSITE_RELEASE
        );
        address _codeless = makeAddr("codeless");
        vm.expectRevert(abi.encodeWithSelector(Error.Gate__InvalidCanonicalToken.selector, _codeless));
        new HubGate(
            accountModule,
            depositModule,
            hubEscrowStore,
            mandateStore,
            fundModule,
            redeemModule,
            _config,
            _endpoints(ATTESTOR_ENDPOINT),
            _list(_codeless),
            50,
            PERFORMANCE_FEE,
            WEBSITE_RELEASE
        );

        address _narrow = address(
            new HubGate(
                accountModule,
                depositModule,
                hubEscrowStore,
                mandateStore,
                fundModule,
                redeemModule,
                _config,
                _endpoints(ATTESTOR_ENDPOINT),
                _list(address(usdc)),
                50,
                PERFORMANCE_FEE,
                WEBSITE_RELEASE
            )
        );
        vm.prank(owner);
        dictate.setGate(bytes32("HubGate"), _narrow);
        assertFalse(hub.isCanonical(address(wnt)), "the set changes only with the gate logic");
        vm.prank(owner);
        dictate.setGate(bytes32("HubGate"), _impl);
        assertTrue(hub.isCanonical(address(wnt)), "and swapping the logic back restores it");

        outToken.mint(backer, 1e18);
        vm.startPrank(backer);
        IERC20(address(outToken)).approve(address(depositModule), 1e18);
        hub.deposit(address(outToken), 1e18);
        vm.stopPrank();
        assertEq(outToken.balanceOf(_account(backer)), 1e18, "a deposit reads no canonical list, only a round does");

        uint _whale = 1e30;
        usdc.mint(backer, _whale);
        vm.startPrank(backer);
        IERC20(address(usdc)).approve(address(depositModule), _whale);
        hub.deposit(address(usdc), _whale);
        vm.stopPrank();
        assertEq(usdc.balanceOf(_account(backer)), _whale, "a deposit has no per-call cap");
    }

    function test_createFund_refuses_a_pixel_index_past_the_palette() public {
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes memory _bad = _grid();
        _bad[PALETTE_BYTES + 57] = bytes1(uint8(PALETTE_BYTES / 3));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.ShareToken__InvalidPixel.selector, 57, PALETTE_BYTES / 3));
        hub.createFund(bytes32("EG"), _bad, "", "", _i, _sig, _ownerSig);

        _bad[PALETTE_BYTES + 5] = bytes1(uint8(255));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.ShareToken__InvalidPixel.selector, 5, 255));
        hub.createFund(bytes32("EG"), _bad, "", "", _i, _sig, _ownerSig);

        bytes memory _pixels = _grid();
        assertEq(uint8(_pixels[GRID_BYTES - 1]), PALETTE_BYTES / 3 - 1);
        _openFund();
        assertEq(shareToken.pixels(), _pixels, "a grid using the last palette index opens a fund");

        string memory _json = string(Base64.decode(LibString.slice(shareToken.tokenURI(), 29)));
        string memory _marker = '"image":"data:image/svg+xml;base64,';
        uint _at = LibString.indexOf(_json, _marker) + bytes(_marker).length;
        string memory _svg = string(Base64.decode(LibString.slice(_json, _at, bytes(_json).length - 2)));
        uint _rgb = (uint(uint8(_pixels[PALETTE_BYTES - 3])) << 16) | (uint(uint8(_pixels[PALETTE_BYTES - 2])) << 8)
            | uint(uint8(_pixels[PALETTE_BYTES - 1]));
        string memory _last = LibString.toString(GRID_SIDE - 1);
        assertTrue(
            LibString.contains(
                _svg,
                string.concat(
                    '<rect x="', _last, '" y="', _last, '" width="1" height="1" fill="#', LibString.toHexStringNoPrefix(_rgb, 3), '"/>'
                )
            ),
            "the last cell renders the last palette colour"
        );
    }

    function test_verifyShare_reverts_for_short_code_without_burning_gas() public {
        _openFund();
        hub.verifyShare(body, shareToken);
        assertEq(address(shareToken).code.length, 0x2d + 20 + 32 + GRID_BYTES + 2);

        assertEq(body.code.length, 23, "a 7702 body carries 23 bytes of code");
        _assertShareMismatch(body, body);

        address _oneByte = makeAddr("one-byte");
        vm.etch(_oneByte, hex"00");
        _assertShareMismatch(body, _oneByte);

        address _short = makeAddr("short");
        vm.etch(_short, new bytes(44));
        _assertShareMismatch(body, _short);

        _assertShareMismatch(body, makeAddr("codeless"));
        _assertShareMismatch(backer, address(shareToken));

        address _foreign = LibClone.cloneDeterministic(
            fundModule.shareImpl(),
            abi.encodePacked(body, bytes32("EG"), _grid(), uint16(hub.performanceFee())),
            bytes32(uint(uint160(body)))
        );
        assertEq(_foreign.code, address(shareToken).code, "a clone with identical code");
        _assertShareMismatch(body, _foreign);
    }

    function test_share_refuses_approve_permit_and_transfer_and_reports_no_permit2_allowance() public {
        _openFund();
        uint _held = shareToken.balanceOf(body);
        assertGt(_held, 0);
        assertEq(shareToken.master(), body, "the share answers to its fund account alone");
        assertEq(shareToken.allowance(body, PERMIT2), 0, "Permit2 holds no implicit allowance");

        vm.prank(body);
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.approve(backer, 1);

        vm.prank(body);
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.transfer(backer, 1);

        vm.prank(address(fundModule));
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.transfer(backer, 1);

        vm.prank(address(fundModule));
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.mint(backer, 1);

        vm.prank(address(fundModule));
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.burn(backer, 1);

        uint _deadline = vm.getBlockTimestamp() + 1 hours;
        (uint8 _v, bytes32 _r, bytes32 _s) = vm.sign(
            bodyKey,
            keccak256(
                abi.encodePacked(
                    hex"1901",
                    shareToken.DOMAIN_SEPARATOR(),
                    keccak256(
                        abi.encode(
                            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                            body,
                            backer,
                            1,
                            shareToken.nonces(body),
                            _deadline
                        )
                    )
                )
            )
        );
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.permit(body, backer, 1, _deadline, _v, _r, _s);

        vm.prank(PERMIT2);
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.transferFrom(body, PERMIT2, 1);

        assertEq(shareToken.allowance(body, backer), 0);
        assertEq(shareToken.nonces(body), 0);
        assertEq(shareToken.balanceOf(body), _held, "no share moved");
        assertEq(shareToken.balanceOf(backer), 0);
        assertEq(shareToken.balanceOf(PERMIT2), 0);
    }
}
