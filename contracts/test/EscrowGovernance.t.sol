// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {stdError} from "forge-std/src/StdError.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {LibString} from "solady/utils/LibString.sol";

import {HubGate} from "src/HubGate.sol";
import {SpokeGate} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {Fund} from "src/core/Fund.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {GRID_BYTES, GRID_SIDE, PALETTE_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib, ESCROW_RETURN_DELAY, WALLET_SIGNATURE_TAG} from "src/utils/AccountLib.sol";
import {BalanceLib} from "src/utils/BalanceLib.sol";
import {Error} from "src/utils/Error.sol";
import {GateConfig} from "src/utils/GateConfig.sol";
import {LiquidityGate, RETIRE_ESCROW_INTENT_TYPEHASH} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {RouterProxy} from "src/utils/RouterProxy.sol";
import {FULL_ACCESS} from "src/utils/auth/Access.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

import {HotPathTest} from "./HotPath.t.sol";
import {MockTarget} from "./mock/MockTarget.t.sol";
import {MockWallet1271} from "./mock/MockWallet1271.t.sol";

contract EscrowGovernanceTest is HotPathTest {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function _grid() internal pure returns (bytes memory pixels_) {
        pixels_ = new bytes(GRID_BYTES);
        for (uint _p; _p < GRID_BYTES; ++_p) {
            pixels_[_p] =
                bytes1(uint8(_p < PALETTE_BYTES ? 1 + (_p * 37) % 255 : (_p - PALETTE_BYTES) % (PALETTE_BYTES / 3)));
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
            _allocateIntent(0, 0, _credit(HUB_CHAIN, address(usdc), _amount), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(
            _symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i)
        );
    }

    function _creditRound(
        uint _chainId,
        uint _amount
    ) internal returns (Fund.Credit memory credit_) {
        (Fund.AllocateIntent memory _i,) =
            _allocateIntent(_nonceOf(body), _nav(), _credit(_chainId, address(usdc), _amount), new Fund.Allocation[](0));
        _i.header.deadline = vm.getBlockTimestamp() + 300;
        hub.allocate(_i, _pair(masterKey, _allocateDigest(_i)), _ownerCoSig(_i));
        credit_ = _i.credit;
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

    function _totalSignature(
        uint _key,
        address _owner,
        address _body,
        uint _total,
        uint _feeTotal
    ) internal view returns (bytes memory) {
        return _coSig(_key, AccountLib.creditDigest(_owner, _body, FOREIGN_CHAIN_ID, address(usdc), _total, _feeTotal));
    }

    function _returnOpenEscrow(
        LiquidityGate _gate,
        address _wallet,
        address _token
    ) internal {
        uint _start = vm.getBlockTimestamp();
        vm.prank(_wallet);
        _gate.requestReturn(_token);
        vm.warp(_start + ESCROW_RETURN_DELAY);
        vm.prank(_wallet);
        _gate.returnEscrow(_token);
    }

    function _assertLedger(
        EscrowStore _store,
        address _owner,
        uint _escrowed,
        uint _released,
        uint _returned
    ) internal view {
        assertEq(
            _store.escrowedMap(_owner, address(usdc)),
            _escrowed,
            "the escrowed total counts every booking and never falls"
        );
        assertEq(_store.releasedMap(_owner, address(usdc)), _released, "the released total counts every fund's draw");
        assertEq(
            _store.returnedMap(_owner, address(usdc)),
            _returned,
            "the returned total counts what went back to the wallet"
        );
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

    function _lastRecordOf(
        Vm.Log[] memory _logs,
        address _acct
    ) internal view returns (bytes32 digest_, bytes memory executionData_) {
        for (uint _i; _i < _logs.length; ++_i) {
            if (
                _logs[_i].emitter != address(accountModule) || _logs[_i].topics[0] != AccountModule.AccountCall.selector
            ) continue;
            if (_logs[_i].topics[1] != bytes32(uint(uint160(_acct)))) continue;
            (,,, digest_,, executionData_,,,) = abi.decode(
                _logs[_i].data,
                (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
            );
        }
    }

    function test_fulfil_releases_each_signed_total_only_above_the_settled_total() public {
        _openFund();
        address _parent = _account(master);
        _walletEscrow(spoke, master, 300e6);
        bytes memory _first = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 100e6, FEE);
        bytes memory _later = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 250e6, 2 * FEE);
        bytes memory _clawback = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 260e6, FEE);
        uint _fees = usdc.balanceOf(feeReceiver);
        uint _held = usdc.balanceOf(body);

        vm.chainId(FOREIGN_CHAIN_ID);
        spoke.fulfil(body, address(usdc), 100e6, FEE, _first, _noGenesis());
        assertEq(
            spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)),
            100e6,
            "the first signed total releases in full"
        );

        vm.recordLogs();
        spoke.fulfil(body, address(usdc), 250e6, 2 * FEE, _later, _noGenesis());
        (bytes32 _digest, bytes memory _record) = _lastRecordOf(vm.getRecordedLogs(), body);
        assertEq(
            spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)),
            250e6,
            "a later total releases only what it adds"
        );
        assertEq(
            _record,
            abi.encode(SpokeGate.fulfil.selector, address(usdc), uint(250e6), 2 * FEE),
            "the record carries the settled totals, never the increment"
        );
        assertEq(
            _digest,
            AccountLib.creditDigest(_parent, body, FOREIGN_CHAIN_ID, address(usdc), 250e6, 2 * FEE),
            "under the owner's own credit digest"
        );

        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 250e6, 100e6));
        spoke.fulfil(body, address(usdc), 100e6, FEE, _first, _noGenesis());
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 250e6, 250e6));
        spoke.fulfil(body, address(usdc), 250e6, 2 * FEE, _later, _noGenesis());
        vm.expectRevert(stdError.arithmeticError);
        spoke.fulfil(body, address(usdc), 260e6, FEE, _clawback, _noGenesis());
        vm.chainId(HUB_CHAIN);

        assertEq(usdc.balanceOf(feeReceiver), _fees + 2 * FEE, "each total pays only its fee increment");
        assertEq(usdc.balanceOf(body), _held + 250e6 - 2 * FEE, "the body holds both releases net of their fees");
        assertEq(
            usdc.balanceOf(address(spokeEscrowStore)), 50e6, "a stale, replayed or fee-lowering total moves nothing"
        );
    }

    function test_fulfil_fee_is_capped_by_max_relay_fee_bps() public {
        _openFund();
        _walletEscrow(spoke, master, 200e6);
        assertEq(spokeEscrowStore.maxFeeBps(), 1000, "the store's own cap is the limb a release checks");
        bytes memory _over = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 100e6, 10e6 + 1);
        bytes memory _whole = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 100e6, 100e6);
        bytes memory _atCap = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 100e6, 10e6);
        bytes memory _overIncrement = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 150e6, 15e6 + 1);
        bytes memory _atIncrementCap = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 150e6, 15e6);
        uint _fees = usdc.balanceOf(feeReceiver);
        uint _held = usdc.balanceOf(body);

        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 10e6 + 1, 100e6, 1000));
        spoke.fulfil(body, address(usdc), 100e6, 10e6 + 1, _over, _noGenesis());
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 100e6, 100e6, 1000));
        spoke.fulfil(body, address(usdc), 100e6, 100e6, _whole, _noGenesis());
        spoke.fulfil(body, address(usdc), 100e6, 10e6, _atCap, _noGenesis());
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 5e6 + 1, 50e6, 1000));
        spoke.fulfil(body, address(usdc), 150e6, 15e6 + 1, _overIncrement, _noGenesis());
        spoke.fulfil(body, address(usdc), 150e6, 15e6, _atIncrementCap, _noGenesis());
        vm.chainId(HUB_CHAIN);

        assertEq(usdc.balanceOf(feeReceiver), _fees + 15e6, "a fee exactly at the cap of each increment is billed");
        assertEq(usdc.balanceOf(body), _held + 135e6, "and the rest of each release lands in the body");
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
        bytes memory _signed = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 100e6, FEE);
        bytes memory _strangers = _totalSignature(backerKey, _stranger, body, 100e6, FEE);

        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, address(usdc), 100e6, FEE, _strangers, _noGenesis());
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 100e6));
        spoke.fulfil(body, address(usdc), 100e6, FEE, _signed, _noGenesis());
        vm.chainId(HUB_CHAIN);
        assertEq(spokeEscrowStore.releasedMap(_stranger, address(usdc)), 0, "a stranger's escrow is never released");
        assertEq(spokeEscrowStore.escrowedMap(_stranger, address(usdc)), 100e6);
        assertEq(usdc.balanceOf(body), _held, "into the body, under its own signature or the owner's");

        _walletEscrow(spoke, master, 100e6);
        vm.chainId(FOREIGN_CHAIN_ID);
        spoke.fulfil(body, address(usdc), 100e6, FEE, _signed, _noGenesis());
        vm.chainId(HUB_CHAIN);
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
        bytes memory _forBody = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 60e6, FEE);
        bytes memory _forFresh = _totalSignature(backerKey, _other, _fresh, 60e6, FEE);
        bytes memory _beyond = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 101e6, FEE);
        bytes memory _rest = _totalSignature(backerKey, _other, _fresh, 101e6, 2 * FEE);

        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_fresh, address(usdc), 60e6, FEE, _forBody, _genesis);
        spoke.fulfil(_fresh, address(usdc), 60e6, FEE, _forFresh, _genesis);
        vm.chainId(HUB_CHAIN);
        (, address _bound) = FundAccount(payable(_fresh)).bound();
        assertEq(_bound, _other, "the first settlement binds the fresh body to the parent its key signed");
        assertEq(usdc.balanceOf(_fresh), 60e6 - FEE, "and releases to that body net of the fee");
        assertEq(
            spokeEscrowStore.releasedMap(_other, address(usdc)), 60e6, "drawn from the escrow of the owner it read"
        );
        assertEq(spokeEscrowStore.releasedMap(_owner, address(usdc)), 0, "never from another owner's");

        uint _held = usdc.balanceOf(body);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 100e6, 101e6));
        spoke.fulfil(body, address(usdc), 101e6, FEE, _beyond, _noGenesis());
        spoke.fulfil(body, address(usdc), 60e6, FEE, _forBody, _noGenesis());
        vm.chainId(HUB_CHAIN);
        assertEq(usdc.balanceOf(body) - _held, 60e6 - FEE, "the master's body is paid from the master's escrow");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)), 60e6, "each body keeps its own total");
        assertEq(spokeEscrowStore.fulfilledMap(_other, _fresh, address(usdc)), 60e6);
        assertEq(spokeEscrowStore.fulfilledMap(_owner, _fresh, address(usdc)), 0, "under its own owner only");
        assertEq(spokeEscrowStore.fulfilledMap(_other, body, address(usdc)), 0);

        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 40e6, 41e6));
        spoke.fulfil(_fresh, address(usdc), 101e6, 2 * FEE, _rest, _noGenesis());
        vm.chainId(HUB_CHAIN);
        assertEq(
            spokeEscrowStore.heldMap(address(usdc)),
            80e6,
            "a body never borrows the open escrow of another owner on the store"
        );
    }

    function test_settlement_binds_an_unbound_body_only_under_the_genesis_its_key_and_owner_signed() public {
        address _owner = _account(backer);
        address _elsewhere = _account(master);
        _walletEscrow(spoke, backer, 100e6);
        (address _fresh, uint _freshKey) = makeAddrAndKey("unbound-body");
        bytes memory _key = _coSig(_freshKey, AccountLib.genesisDigest(address(accountModule), _fresh, _owner));
        AccountLib.Genesis memory _genesis =
            AccountLib.Genesis({parent: _owner, key: _key, approval: _fundApproval(backerKey, _fresh)});
        AccountLib.Genesis memory _otherParent =
            AccountLib.Genesis({parent: _elsewhere, key: _key, approval: _fundApproval(masterKey, _fresh)});
        AccountLib.Genesis memory _strangerApproval =
            AccountLib.Genesis({parent: _owner, key: _key, approval: _fundApproval(masterKey, _fresh)});
        AccountLib.Genesis memory _otherFund =
            AccountLib.Genesis({parent: _owner, key: _key, approval: _fundApproval(backerKey, body)});
        bytes memory _signed = _totalSignature(backerKey, _owner, _fresh, 60e6, FEE);
        bytes memory _more = _totalSignature(backerKey, _owner, _fresh, 90e6, 2 * FEE);

        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NotDelegated.selector, _fresh));
        spoke.fulfil(_fresh, address(usdc), 60e6, FEE, _signed, _genesis);
        vm.chainId(HUB_CHAIN);
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _freshKey);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_fresh, address(usdc), 60e6, FEE, _signed, _otherParent);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_fresh, address(usdc), 60e6, FEE, _signed, _strangerApproval);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_fresh, address(usdc), 60e6, FEE, _signed, _otherFund);
        vm.recordLogs();
        spoke.fulfil(_fresh, address(usdc), 60e6, FEE, _signed, _genesis);
        (, bytes memory _record) = _lastRecordOf(vm.getRecordedLogs(), _fresh);
        spoke.fulfil(_fresh, address(usdc), 90e6, 2 * FEE, _more, _otherParent);
        vm.chainId(HUB_CHAIN);

        (address _module, address _bound) = FundAccount(payable(_fresh)).bound();
        assertEq(_module, address(accountModule), "the first settlement binds the body under the module");
        assertEq(_bound, _owner, "to the parent its key signed and its owner approved");
        assertEq(
            _record,
            abi.encode(SpokeGate.fulfil.selector, address(usdc), uint(60e6), FEE),
            "and settles in the same call"
        );
        assertEq(usdc.balanceOf(_fresh), 90e6 - 2 * FEE, "a bound body ignores any later genesis");
        assertEq(spokeEscrowStore.releasedMap(_owner, address(usdc)), 90e6, "and keeps drawing on its owner's escrow");
        assertEq(
            spokeEscrowStore.releasedMap(_elsewhere, address(usdc)), 0, "never on the escrow a refused genesis named"
        );
    }

    function test_an_abroad_credit_takes_only_the_owner_wallets_raw_signature_the_spoke_settles() public {
        _openFund();
        address _owner = _account(master);
        _walletEscrow(spoke, master, 300e6);
        _walletEscrow(hub, master, 100e6);
        uint _now = vm.getBlockTimestamp();
        address _signer = vm.addr(masterKey + 1);
        bytes memory _grant = _coSig(
            masterKey, AccountLib.sessionDigest(address(accountModule), master, _signer, _now, _now + 7 days, 0, body)
        );
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body), _nav(), _credit(FOREIGN_CHAIN_ID, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        bytes32 _digest =
            AccountLib.creditDigest(_owner, body, FOREIGN_CHAIN_ID, address(usdc), _i.credit.total, _i.credit.feeTotal);
        bytes memory _session =
            abi.encode(_signer, _now, _now + 7 days, uint(0), body, _grant, _coSig(masterKey + 1, _digest));
        assertTrue(
            UserAccount(payable(_owner)).approves(_digest, _session),
            "the owner's account takes its session's signature as consent"
        );

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _sig, _session);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, address(usdc), _i.credit.total, _i.credit.feeTotal, _session, _noGenesis());
        vm.chainId(HUB_CHAIN);
        assertEq(
            fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total,
            0,
            "so the hub credits nothing abroad that the spoke would refuse to settle"
        );

        uint _shares = shareToken.balanceOf(body);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(body), _shares, "the wallet's own signature over the same total mints");
        assertEq(fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total, 100e6, "and the hub keeps the total");
        _fulfil(address(usdc), _i.credit.total, _i.credit.feeTotal);
        assertEq(spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)), 100e6, "which the spoke settles");

        (Fund.AllocateIntent memory _local, bytes memory _localSig) =
            _allocateIntent(_nonceOf(body), _nav(), _credit(HUB_CHAIN, address(usdc), 100e6), new Fund.Allocation[](0));
        bytes32 _localDigest = AccountLib.creditDigest(
            _owner, body, HUB_CHAIN, address(usdc), _local.credit.total, _local.credit.feeTotal
        );
        hub.allocate(
            _local,
            _localSig,
            abi.encode(_signer, _now, _now + 7 days, uint(0), body, _grant, _coSig(masterKey + 1, _localDigest))
        );
        assertEq(
            hubEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            600e6,
            "a local credit takes any consent the account accepts, since the hub releases it at once"
        );
    }

    function test_a_contract_wallet_owner_credits_locally_but_never_abroad() public {
        MockWallet1271 _wallet = new MockWallet1271();
        master = address(_wallet);
        (body, bodyKey) = makeAddrAndKey("wallet-owned-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), bodyKey);
        _openFund();
        address _owner = _account(master);
        assertEq(UserAccount(payable(_owner)).user(), address(_wallet), "the fund's owner is a contract wallet");
        _walletEscrow(spoke, master, 300e6);
        _walletEscrow(hub, master, 100e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body), _nav(), _credit(FOREIGN_CHAIN_ID, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        bytes32 _digest =
            AccountLib.creditDigest(_owner, body, FOREIGN_CHAIN_ID, address(usdc), _i.credit.total, _i.credit.feeTotal);
        bytes memory _plain = _ownerCoSig(_i);
        bytes memory _tagged = bytes.concat(WALLET_SIGNATURE_TAG, _plain);
        assertTrue(
            UserAccount(payable(_owner)).approves(_digest, _plain), "the wallet's own verdict accepts its signature"
        );
        assertTrue(UserAccount(payable(_owner)).approves(_digest, _tagged), "plain or tagged");

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _sig, _plain);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _sig, _tagged);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, address(usdc), _i.credit.total, _i.credit.feeTotal, _plain, _noGenesis());
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, address(usdc), _i.credit.total, _i.credit.feeTotal, _tagged, _noGenesis());
        vm.chainId(HUB_CHAIN);
        assertEq(
            fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total,
            0,
            "the hub never credits escrow abroad that only a wallet's verdict could release"
        );

        (Fund.AllocateIntent memory _local, bytes memory _localSig) =
            _allocateIntent(_nonceOf(body), _nav(), _credit(HUB_CHAIN, address(usdc), 100e6), new Fund.Allocation[](0));
        hub.allocate(_local, _localSig, bytes.concat(WALLET_SIGNATURE_TAG, _ownerCoSig(_local)));
        assertEq(
            hubEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            600e6,
            "while the hub releases a wallet-signed local credit at once"
        );
        assertEq(
            spokeEscrowStore.releasedMap(_owner, address(usdc)), 0, "and the spoke escrow stays the wallet's to return"
        );
    }

    function test_anyone_settles_the_total_the_hub_published_but_only_under_the_chain_id_it_names() public {
        _openFund();
        address _owner = _account(master);
        _walletEscrow(spoke, master, 300e6);
        vm.recordLogs();
        _creditRound(FOREIGN_CHAIN_ID, 120e6);
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        (bytes32 _digest, bytes memory _record) = _lastRecordOf(_logs, _owner);
        (bytes4 _selector, address _master, Fund.Credit memory _c) = abi.decode(_record, (bytes4, address, Fund.Credit));
        assertEq(_selector, Fund.allocate.selector, "the hub records the owner's credit on its account");
        assertEq(_master, body, "naming the fund");
        assertEq(
            _digest,
            AccountLib.creditDigest(_owner, body, FOREIGN_CHAIN_ID, _c.token, _c.total, _c.feeTotal),
            "under the credit digest the signature covers"
        );
        (, _record) = _lastRecordOf(_logs, body);
        (,,,,, Fund.Credit memory _applied, bytes memory _signature,,,,) = abi.decode(
            _record, (bytes4, uint, uint, address, Fund.Price, Fund.Credit, bytes, uint, uint, uint, uint)
        );
        assertEq(_applied.total, _c.total, "the fund's allocate record carries the same credit");
        assertGt(_signature.length, 0, "and publishes the owner's consent beside it");
        uint _fees = usdc.balanceOf(feeReceiver);
        uint _held = usdc.balanceOf(body);
        address _watcher = makeAddr("watcher");

        vm.startPrank(_watcher);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, _c.token, _c.total, _c.feeTotal, _signature, _noGenesis());
        vm.chainId(FOREIGN_CHAIN_ID + 1);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, _c.token, _c.total, _c.feeTotal, _signature, _noGenesis());
        vm.chainId(FOREIGN_CHAIN_ID);
        spoke.fulfil(body, _c.token, _c.total, _c.feeTotal, _signature, _noGenesis());
        vm.stopPrank();
        vm.chainId(HUB_CHAIN);
        assertEq(
            usdc.balanceOf(body),
            _held + 120e6 - FEE,
            "a watcher settles it from the record alone, on the chain it names"
        );
        assertEq(usdc.balanceOf(feeReceiver), _fees + FEE, "billing the master's slice where the capital sits");
        assertEq(usdc.balanceOf(_watcher), 0, "and paying the settler nothing");

        vm.recordLogs();
        _creditRound(FOREIGN_CHAIN_ID, 80e6);
        (, _record) = _lastRecordOf(vm.getRecordedLogs(), body);
        (,,,,, _c, _signature,,,,) = abi.decode(
            _record, (bytes4, uint, uint, address, Fund.Price, Fund.Credit, bytes, uint, uint, uint, uint)
        );
        assertEq(_c.total, 200e6, "the next abroad credit signs the running total");
        assertEq(_c.feeTotal, 2 * FEE, "and the running fee total");
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.prank(_watcher);
        spoke.fulfil(body, _c.token, _c.total, _c.feeTotal, _signature, _noGenesis());
        vm.chainId(HUB_CHAIN);
        assertEq(usdc.balanceOf(body), _held + 200e6 - 2 * FEE, "its settlement adds only the new credit");
        assertEq(usdc.balanceOf(feeReceiver), _fees + 2 * FEE, "and bills only the new slice");
        assertEq(
            spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total,
            "the spoke settled exactly the total the hub credited"
        );
        assertEq(
            spokeEscrowStore.feePaidMap(_owner, body, address(usdc)),
            fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).feeTotal,
            "and the fee total it billed"
        );
    }

    function test_a_return_requested_after_an_abroad_credit_takes_back_only_what_stays_open_after_settlement() public {
        _openFund();
        address _owner = _account(master);
        _walletEscrow(spoke, master, 300e6);
        Fund.Credit memory _c = _creditRound(FOREIGN_CHAIN_ID, 200e6);
        bytes memory _signed = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), _c.total, _c.feeTotal);
        uint _held = usdc.balanceOf(body);
        uint _start = vm.getBlockTimestamp();
        vm.prank(master);
        spoke.requestReturn(address(usdc));

        vm.warp(_start + ESCROW_RETURN_DELAY - 1);
        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, _start + ESCROW_RETURN_DELAY));
        spoke.returnEscrow(address(usdc));
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.prank(makeAddr("watcher"));
        spoke.fulfil(body, address(usdc), _c.total, _c.feeTotal, _signed, _noGenesis());
        vm.chainId(HUB_CHAIN);

        vm.warp(_start + ESCROW_RETURN_DELAY);
        vm.prank(master);
        spoke.returnEscrow(address(usdc));
        assertEq(usdc.balanceOf(master), 100e6, "the return takes back only the open remainder");
        assertEq(usdc.balanceOf(body) - _held, 200e6 - FEE, "the credited part reached the fund the hub minted against");
        _assertLedger(spokeEscrowStore, _owner, 300e6, 200e6, 100e6);
        assertEq(
            spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total,
            "every unit the hub credited is settled"
        );
        assertEq(spokeEscrowStore.heldMap(address(usdc)), 0, "and the store owes nothing more");
    }

    function test_a_return_after_the_day_takes_a_credit_nobody_settled_and_its_settlement_then_reverts() public {
        _openFund();
        address _owner = _account(master);
        _walletEscrow(spoke, master, 300e6);
        Fund.Credit memory _c = _creditRound(FOREIGN_CHAIN_ID, 200e6);
        bytes memory _signed = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), _c.total, _c.feeTotal);
        _returnOpenEscrow(spoke, master, address(usdc));
        assertEq(usdc.balanceOf(master), 300e6, "a credit left unsettled for the whole day is returned with the rest");

        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 200e6));
        spoke.fulfil(body, address(usdc), _c.total, _c.feeTotal, _signed, _noGenesis());
        vm.chainId(HUB_CHAIN);
        assertEq(
            fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total,
            200e6,
            "while the hub still counts the credit, so a settler has one day to land it"
        );
        _assertLedger(spokeEscrowStore, _owner, 300e6, 0, 300e6);
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
        uint _nonce = _nonceOf(_owner);
        uint _fees = usdc.balanceOf(feeReceiver);
        assertEq(
            _accountHeld, 1600e6 - 2 * FEE, "the account paid only the escrow it moved and the relay fees it signed"
        );

        _createFund(bytes32("EGA"), 500e6);
        address _first = body;
        _creditRound(FOREIGN_CHAIN_ID, 120e6);
        _fulfil(address(usdc), 120e6, FEE);

        (body, bodyKey) = makeAddrAndKey("second-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), bodyKey);
        _createFund(bytes32("EGB"), 350e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _nav(), _credit(HUB_CHAIN, address(usdc), 60e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 50e6, 60e6));
        hub.allocate(_i, _sig, _ownerSig);
        vm.recordLogs();
        Fund.Credit memory _local = _creditRound(HUB_CHAIN, 30e6);
        (bytes32 _digest, bytes memory _record) = _lastRecordOf(vm.getRecordedLogs(), _owner);
        assertEq(_local.total, 380e6, "a local credit signs the fund's running total");
        assertEq(
            _record,
            abi.encode(Fund.allocate.selector, body, _local),
            "the owner's credit record names the fund and the signed totals"
        );
        assertEq(
            _digest,
            AccountLib.creditDigest(_owner, body, HUB_CHAIN, address(usdc), 380e6, 2 * FEE),
            "under the owner's credit digest"
        );
        vm.recordLogs();
        Fund.Credit memory _abroad = _creditRound(FOREIGN_CHAIN_ID, 150e6);
        (, _record) = _lastRecordOf(vm.getRecordedLogs(), _owner);
        assertEq(
            _record,
            abi.encode(Fund.allocate.selector, body, _abroad),
            "an abroad credit's record has the same shape, its chain id naming the spoke that settles it"
        );
        _fulfil(address(usdc), 150e6, FEE);

        bytes memory _over = _totalSignature(masterKey, _owner, _first, 151e6, 2 * FEE);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 30e6, 31e6));
        spoke.fulfil(_first, address(usdc), 151e6, 2 * FEE, _over, _noGenesis());
        vm.chainId(HUB_CHAIN);

        _returnOpenEscrow(hub, master, address(usdc));
        _returnOpenEscrow(spoke, master, address(usdc));

        _assertLedger(hubEscrowStore, _owner, 900e6, 880e6, 20e6);
        _assertLedger(spokeEscrowStore, _owner, 300e6, 270e6, 30e6);
        _assertLedger(hubEscrowStore, _backer, 70e6, 0, 0);
        _assertLedger(spokeEscrowStore, _backer, 30e6, 0, 0);
        assertEq(
            hubEscrowStore.fulfilledMap(_owner, _first, address(usdc)), 500e6, "the first fund drew its local credit"
        );
        assertEq(hubEscrowStore.fulfilledMap(_owner, body, address(usdc)), 380e6, "the second its two");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, _first, address(usdc)), 120e6, "each settled its abroad credit");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)), 150e6, "on the spoke");
        assertEq(
            fundStore.getCredit(_first, FOREIGN_CHAIN_ID, address(usdc)).total, 120e6, "at the totals the hub credited"
        );
        assertEq(fundStore.getCredit(body, FOREIGN_CHAIN_ID, address(usdc)).total, 150e6);
        assertEq(
            hubEscrowStore.heldMap(address(usdc)), 70e6, "after its return the hub store owes only the other owner"
        );
        assertEq(usdc.balanceOf(address(hubEscrowStore)), 70e6, "and holds exactly that");
        assertEq(spokeEscrowStore.heldMap(address(usdc)), 30e6, "so does the spoke store");
        assertEq(usdc.balanceOf(address(spokeEscrowStore)), 30e6);
        assertEq(
            usdc.balanceOf(_first), 500e6 + 120e6 - 2 * FEE, "the first fund holds its credits net of their slices"
        );
        assertEq(usdc.balanceOf(body), 350e6 + 30e6 + 150e6 - 3 * FEE, "the second its own");
        assertEq(
            usdc.balanceOf(_first) + usdc.balanceOf(body) + usdc.balanceOf(feeReceiver) - _fees,
            hubEscrowStore.releasedMap(_owner, address(usdc)) + spokeEscrowStore.releasedMap(_owner, address(usdc)),
            "every released unit reached a fund or the fee receiver"
        );
        assertEq(usdc.balanceOf(master), 50e6, "the wallet holds exactly the open escrow that came back");
        assertEq(usdc.balanceOf(_owner), _accountHeld, "no round, settlement or return touched the owner's account");
        assertEq(
            _nonceOf(_owner), _nonce, "and no credit spent an owner nonce: each signed total is its own replay guard"
        );
        assertEq(
            hubEscrowStore.escrowedMap(_first, address(usdc)) + hubEscrowStore.escrowedMap(body, address(usdc))
                + spokeEscrowStore.escrowedMap(_first, address(usdc))
                + spokeEscrowStore.escrowedMap(body, address(usdc)),
            0,
            "a fund body never holds escrow"
        );
    }

    function testFuzz_the_hub_escrow_ledger_matches_the_balance_deltas(
        uint _wallet,
        uint _retired,
        uint _first,
        uint _second,
        bool _back
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
        uint _open = _escrowed - _first - _second;
        uint _fees = usdc.balanceOf(feeReceiver);

        _createFund(bytes32("EG"), _first);
        if (_second > 0) _creditRound(HUB_CHAIN, _second);
        if (_back) {
            uint _start = vm.getBlockTimestamp();
            vm.prank(master);
            hub.requestReturn(address(usdc));
            vm.warp(_start + ESCROW_RETURN_DELAY);
            if (_open == 0) vm.expectRevert(Error.Balance__NothingToWithdraw.selector);
            vm.prank(master);
            hub.returnEscrow(address(usdc));
        }
        uint _returned = _back ? _open : 0;

        uint _billed = (_second > 0 ? 2 : 1) * FEE;
        assertEq(
            usdc.balanceOf(body), _first + _second - _billed, "the body receives each local credit net of its slice"
        );
        assertEq(usdc.balanceOf(feeReceiver) - _fees, _billed, "the store's fee receiver exactly the slices");
        assertEq(usdc.balanceOf(master), _returned, "the wallet exactly the open escrow it asked back");
        assertEq(usdc.balanceOf(_owner), 100e6, "and the owner's account nothing");
        _assertLedger(hubEscrowStore, _owner, _escrowed, _first + _second, _returned);
        assertEq(
            hubEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            _first + _second,
            "the body's total is its credits"
        );
        assertEq(
            hubEscrowStore.heldMap(address(usdc)), 70e6 + _open - _returned, "the store owes each owner's open escrow"
        );
        assertEq(
            usdc.balanceOf(address(hubEscrowStore)), hubEscrowStore.heldMap(address(usdc)), "and holds exactly that"
        );
    }

    function testFuzz_the_spoke_escrow_ledger_matches_the_balance_deltas(
        uint _wallet,
        uint _retired,
        uint _first,
        uint _second,
        uint _firstFee,
        uint _secondFee,
        bool _back
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
        _first = bound(_first, 1, _escrowed - 1);
        _second = bound(_second, _first + 1, _escrowed);
        _firstFee = bound(_firstFee, 0, _first / 10);
        _secondFee = bound(_secondFee, 0, (_second - _first) / 10);
        uint _open = _escrowed - _second;
        uint[3] memory _before = [usdc.balanceOf(body), usdc.balanceOf(feeReceiver), usdc.balanceOf(master)];

        _fulfil(address(usdc), _first, _firstFee);
        _fulfil(address(usdc), _second, _firstFee + _secondFee);
        if (_back) {
            uint _start = vm.getBlockTimestamp();
            vm.prank(master);
            spoke.requestReturn(address(usdc));
            vm.warp(_start + ESCROW_RETURN_DELAY);
            if (_open == 0) vm.expectRevert(Error.Balance__NothingToWithdraw.selector);
            vm.prank(master);
            spoke.returnEscrow(address(usdc));
        }
        uint _left = _back ? 0 : _open;

        assertEq(
            usdc.balanceOf(body) - _before[0],
            _second - _firstFee - _secondFee,
            "the body receives each release net of its fee"
        );
        assertEq(
            usdc.balanceOf(feeReceiver) - _before[1],
            _firstFee + _secondFee,
            "the fee receiver exactly the fee increments"
        );
        assertEq(usdc.balanceOf(master) - _before[2], _open - _left, "the wallet exactly the open escrow it asked back");
        assertEq(usdc.balanceOf(_owner), 100e6, "and the owner's account nothing");
        _assertLedger(spokeEscrowStore, _owner, _escrowed, _second, _open - _left);
        assertEq(
            spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)),
            _second,
            "the body's total is its last settled total"
        );
        assertEq(
            spokeEscrowStore.feePaidMap(_owner, body, address(usdc)),
            _firstFee + _secondFee,
            "its fee total the last signed one"
        );
        assertEq(spokeEscrowStore.heldMap(address(usdc)), 30e6 + _left, "the store owes each owner's open escrow");
        assertEq(
            usdc.balanceOf(address(spokeEscrowStore)), spokeEscrowStore.heldMap(address(usdc)), "and holds exactly that"
        );

        bytes memory _beyond =
            _creditSignature(FOREIGN_CHAIN_ID, address(usdc), _second + _left + 1, _firstFee + _secondFee);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, _left, _left + 1));
        spoke.fulfil(body, address(usdc), _second + _left + 1, _firstFee + _secondFee, _beyond, _noGenesis());
        vm.chainId(HUB_CHAIN);
    }

    function test_returnEscrow_pays_the_owners_wallet_the_open_escrow_a_day_after_its_request() public {
        _openFund();
        _fundWallet(master, 100e6);
        _account(backer);
        address _owner = _account(master);
        _walletEscrow(hub, master, 300e6);
        _creditRound(HUB_CHAIN, 100e6);
        _walletEscrow(spoke, master, 300e6);
        _creditRound(FOREIGN_CHAIN_ID, 100e6);
        _fulfil(address(usdc), 100e6, FEE);
        (Fund.AllocateIntent memory _i,) =
            _allocateIntent(_nonceOf(body), _nav(), _credit(HUB_CHAIN, address(usdc), 10e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        bytes memory _beyond = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 110e6, 2 * FEE);

        _returnsTheOpenEscrowADayAfterItsRequest(hub);
        _returnsTheOpenEscrowADayAfterItsRequest(spoke);
        assertEq(usdc.balanceOf(_owner), 100e6, "no return ever lands in the owner's account");
        assertEq(usdc.balanceOf(master), 400e6, "both stores returned their open escrow to the wallet");

        _i.header.deadline = vm.getBlockTimestamp() + 300;
        bytes memory _sig = _pair(masterKey, _allocateDigest(_i));
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 10e6));
        hub.allocate(_i, _sig, _ownerSig);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 10e6));
        spoke.fulfil(body, address(usdc), 110e6, 2 * FEE, _beyond, _noGenesis());
        vm.chainId(HUB_CHAIN);
    }

    function _returnsTheOpenEscrowADayAfterItsRequest(
        LiquidityGate _gate
    ) internal {
        EscrowStore _store = _gate.escrowStore();
        address _owner = _account(master);
        uint _released = _store.releasedMap(_owner, address(usdc));
        assertEq(_store.escrowedMap(_owner, address(usdc)) - _released, 200e6, "the owner's open escrow on this store");
        uint _wallet = usdc.balanceOf(master);
        uint _start = vm.getBlockTimestamp();

        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        _gate.returnEscrow(address(usdc));
        vm.prank(makeAddr("no-account"));
        vm.expectRevert(Error.Account__InvalidUser.selector);
        _gate.requestReturn(address(usdc));
        vm.prank(backer);
        _gate.requestReturn(address(usdc));
        assertEq(_store.returnAtMap(_owner, address(usdc)), 0, "a request starts only the caller's own return");

        vm.recordLogs();
        vm.prank(master);
        _gate.requestReturn(address(usdc));
        (, bytes memory _record) = _lastRecordOf(vm.getRecordedLogs(), _owner);
        assertEq(
            _record,
            abi.encode(LiquidityGate.requestReturn.selector, address(usdc), _start + ESCROW_RETURN_DELAY),
            "the request records when the return opens"
        );
        vm.warp(_start + ESCROW_RETURN_DELAY / 2);
        vm.prank(master);
        _gate.requestReturn(address(usdc));
        uint _returnAt = _start + ESCROW_RETURN_DELAY * 3 / 2;
        assertEq(_store.returnAtMap(_owner, address(usdc)), _returnAt, "a second request restarts the day");
        vm.warp(_returnAt - 1);
        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, _returnAt));
        _gate.returnEscrow(address(usdc));

        vm.warp(_returnAt);
        vm.recordLogs();
        vm.prank(master);
        _gate.returnEscrow(address(usdc));
        (, _record) = _lastRecordOf(vm.getRecordedLogs(), _owner);
        assertEq(
            _record,
            abi.encode(LiquidityGate.returnEscrow.selector, address(usdc), uint(200e6)),
            "the record carries the running returned total"
        );
        assertEq(usdc.balanceOf(master) - _wallet, 200e6, "the return pays the owner's wallet the whole open escrow");
        assertEq(_store.returnAtMap(_owner, address(usdc)), 0, "and spends the request");
        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        _gate.returnEscrow(address(usdc));

        vm.prank(master);
        _gate.requestReturn(address(usdc));
        vm.warp(_returnAt + ESCROW_RETURN_DELAY);
        vm.prank(master);
        vm.expectRevert(Error.Balance__NothingToWithdraw.selector);
        _gate.returnEscrow(address(usdc));
        assertEq(_store.returnedMap(_owner, address(usdc)), 200e6, "the returned total stops at the open escrow");
        assertEq(
            _store.escrowedMap(_owner, address(usdc)),
            _released + 200e6,
            "every escrowed unit is now released or returned"
        );
    }

    function test_a_new_escrow_cancels_a_pending_or_ready_return_so_a_later_escrow_needs_a_fresh_request_and_a_full_day()
        public
    {
        _aNewEscrowCancelsTheReturn(hub);
        _aNewEscrowCancelsTheReturn(spoke);
    }

    function _aNewEscrowCancelsTheReturn(
        LiquidityGate _gate
    ) internal {
        EscrowStore _store = _gate.escrowStore();
        address _owner = _account(master);
        uint _wallet = usdc.balanceOf(master);
        uint _start = vm.getBlockTimestamp();
        uint _ready = _start + ESCROW_RETURN_DELAY;

        vm.prank(master);
        _gate.requestReturn(address(usdc));
        vm.warp(_ready);
        vm.prank(master);
        vm.expectRevert(Error.Balance__NothingToWithdraw.selector);
        _gate.returnEscrow(address(usdc));
        assertEq(
            _store.returnAtMap(_owner, address(usdc)),
            _ready,
            "a refund with nothing open reverts and keeps the ready request"
        );

        _walletEscrow(_gate, master, 100e6);
        assertEq(_store.returnAtMap(_owner, address(usdc)), 0, "a new escrow cancels the ready request");
        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        _gate.returnEscrow(address(usdc));

        vm.prank(master);
        _gate.requestReturn(address(usdc));
        vm.warp(_ready + ESCROW_RETURN_DELAY / 2);
        _walletEscrow(_gate, master, 50e6);
        assertEq(_store.returnAtMap(_owner, address(usdc)), 0, "and a pending one");
        vm.warp(_ready + ESCROW_RETURN_DELAY);
        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        _gate.returnEscrow(address(usdc));

        uint _fresh = _ready + 2 * ESCROW_RETURN_DELAY;
        vm.prank(master);
        _gate.requestReturn(address(usdc));
        vm.warp(_fresh - 1);
        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, _fresh));
        _gate.returnEscrow(address(usdc));
        vm.warp(_fresh);
        vm.prank(master);
        _gate.returnEscrow(address(usdc));
        assertEq(usdc.balanceOf(master) - _wallet, 150e6, "a fresh request returns both escrows after its own full day");
        _assertLedger(_store, _owner, 150e6, 0, 150e6);
    }

    function test_escrow_refuses_an_unfunded_booking_and_returns_the_new_escrowed_total() public {
        address _accessor = makeAddr("escrow-accessor");
        vm.startPrank(address(governorAccount));
        hubEscrowStore.setAccess(_accessor, EscrowStore.escrow.selector);
        spokeEscrowStore.setAccess(_accessor, EscrowStore.escrow.selector);
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
        assertEq(
            _store.escrow(_a, address(usdc), 20e6), 60e6, "a second booking returns the running total, not its amount"
        );
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
        vm.prank(address(governorAccount));
        spokeEscrowStore.setAccess(_rogue, FULL_ACCESS);
        uint[4] memory _before =
            [usdc.balanceOf(_parent), usdc.balanceOf(master), usdc.balanceOf(body), usdc.balanceOf(feeReceiver)];
        assertEq(spokeEscrowStore.heldMap(address(usdc)), 40e6, "the store owes exactly the open escrow");
        uint _start = vm.getBlockTimestamp();

        vm.startPrank(_rogue);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__Unfunded.selector, address(usdc), 40e6, 40e6 + 1));
        spokeEscrowStore.escrow(_rogue, address(usdc), 1);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 3e6 + 1, 30e6, 1000));
        spokeEscrowStore.release(_parent, body, address(usdc), 30e6, 3e6 + 1, feeReceiver, 200_000);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NotDelegated.selector, _rogue));
        spokeEscrowStore.release(_parent, _rogue, address(usdc), 30e6, 0, feeReceiver, 200_000);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
        spokeEscrowStore.release(_rogue, body, address(usdc), 30e6, 0, feeReceiver, 200_000);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 40e6, 41e6));
        spokeEscrowStore.release(_parent, body, address(usdc), 41e6, 0, feeReceiver, 200_000);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        spokeEscrowStore.refund(_parent, address(usdc), 200_000);
        assertEq(
            spokeEscrowStore.requestReturn(_parent, address(usdc)),
            _start + ESCROW_RETURN_DELAY,
            "an accessor can start a return, but only on the day's delay"
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, _start + ESCROW_RETURN_DELAY));
        spokeEscrowStore.refund(_parent, address(usdc), 200_000);
        spokeEscrowStore.release(_parent, body, address(usdc), 30e6, 3e6, feeReceiver, 200_000);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 30e6, 30e6));
        spokeEscrowStore.release(_parent, body, address(usdc), 30e6, 3e6, feeReceiver, 200_000);
        vm.warp(_start + ESCROW_RETURN_DELAY);
        assertEq(
            spokeEscrowStore.refund(_parent, address(usdc), 200_000), 10e6, "and its refund pays only the open escrow"
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(_parent), _before[0], "a refund never lands in the owner's account");
        assertEq(usdc.balanceOf(master) - _before[1], 10e6, "the store pays the owner's own wallet, whoever calls");
        assertEq(usdc.balanceOf(body) - _before[2], 27e6, "a release goes only to a fund the owner's account opened");
        assertEq(usdc.balanceOf(_rogue), 0, "so an accessor can never take escrow for itself");
        assertEq(
            usdc.balanceOf(feeReceiver) - _before[3], 3e6, "with at most a tenth to the store's fixed fee receiver"
        );
        assertEq(spokeEscrowStore.heldMap(address(usdc)), 0, "the ledger is settled");
        assertEq(usdc.balanceOf(address(spokeEscrowStore)), 0, "and so is the store");
    }

    function test_native_escrow_is_booked_as_weth_on_both_gates() public {
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
        vm.deal(_wallet, 1 ether);
        vm.startPrank(_wallet);
        vm.expectRevert(Error.Balance__InvalidDeposit.selector);
        _gate.depositEscrow{value: 1 ether}(NATIVE_TOKEN, 1 ether);
        vm.recordLogs();
        _gate.depositEscrow{value: 1 ether}(address(wnt), 1 ether);
        vm.stopPrank();
        (, bytes memory _record) = _lastRecordOf(vm.getRecordedLogs(), _acct);
        assertEq(
            _store.escrowedMap(_acct, address(wnt)),
            1 ether,
            "native sent with a WETH escrow is wrapped and booked as WETH"
        );
        assertEq(_store.escrowedMap(_acct, NATIVE_TOKEN), 0, "never as native");
        assertEq(wnt.balanceOf(address(_store)), 1 ether, "so the store holds WETH");
        assertEq(
            _record,
            abi.encode(LiquidityGate.depositEscrow.selector, address(wnt), uint(1 ether), uint(1 ether), uint(1 ether)),
            "the gate records the attached value beside the escrowed total"
        );

        _returnOpenEscrow(_gate, _wallet, address(wnt));
        assertEq(
            wnt.balanceOf(_wallet), 1 ether, "the escrow returns to the wallet as WETH, which any wallet can receive"
        );
        assertEq(_store.heldMap(address(wnt)), 0, "the store owes nothing more");
    }

    function test_a_native_retire_is_wrapped_and_booked_as_weth() public {
        _fundWallet(master, 100e6);
        address _acct = _account(master);
        vm.deal(master, 2 ether);
        vm.prank(master);
        hub.deposit{value: 2 ether}(NATIVE_TOKEN, 2 ether);
        assertEq(_acct.balance, 2 ether, "the account holds native");
        uint _escrowed = hubEscrowStore.escrowedMap(_acct, address(wnt));
        LiquidityGate.RetireEscrowIntent memory _i = LiquidityGate.RetireEscrowIntent({
            header: _header(_acct, master, _nonceOf(_acct)), token: NATIVE_TOKEN, amount: 1.5 ether
        });
        vm.recordLogs();
        hub.retireEscrow(
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
        (, bytes memory _record) = _lastRecordOf(vm.getRecordedLogs(), _acct);
        assertEq(_acct.balance, 0.5 ether, "the retire spends the account's native");
        assertEq(hubEscrowStore.escrowedMap(_acct, address(wnt)), _escrowed + 1.5 ether, "and books it as WETH");
        assertEq(hubEscrowStore.escrowedMap(_acct, NATIVE_TOKEN), 0, "never as native");
        assertEq(
            _record,
            abi.encode(
                LiquidityGate.retireEscrow.selector,
                address(wnt),
                uint(1.5 ether),
                _escrowed + 1.5 ether,
                _i.header.feeToken,
                _i.header.fee
            ),
            "the record names the booked token"
        );
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
        (, bytes memory _record) = _lastRecordOf(vm.getRecordedLogs(), _acct);
        assertEq(_store.escrowedMap(_acct, address(wnt)), 1 ether, "the fused ETH escrow books WETH");
        assertEq(wnt.balanceOf(address(_store)), 1 ether, "wrapping the attached 0.4 ETH beside 0.6 wallet WETH");
        assertEq(_wallet.balance, 0, "the attached ETH is spent");
        assertEq(wnt.balanceOf(_wallet), 0, "and so is the wallet WETH");
        assertEq(
            _record,
            abi.encode(
                LiquidityGate.depositEscrow.selector, address(wnt), uint(1 ether), uint(0.4 ether), uint(1 ether)
            ),
            "the record carries the amount, the attached value and the escrowed total"
        );

        _wethTo(_wallet, 0.5 ether);
        vm.startPrank(_wallet);
        IERC20(address(wnt)).approve(address(depositModule), 0.5 ether);
        vm.recordLogs();
        _gate.depositEscrow(address(wnt), 0.5 ether);
        vm.stopPrank();
        (, _record) = _lastRecordOf(vm.getRecordedLogs(), _acct);
        assertEq(
            _record,
            abi.encode(LiquidityGate.depositEscrow.selector, address(wnt), uint(0.5 ether), uint(0), uint(1.5 ether)),
            "a second escrow records the running total, never just its amount"
        );
        assertEq(_store.escrowedMap(_acct, address(wnt)), 1.5 ether);
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
                keccak256(
                    abi.encode(
                        RETIRE_ESCROW_INTENT_TYPEHASH, _hashHeader(intent_.header), intent_.token, intent_.amount
                    )
                )
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
        (LiquidityGate.RetireEscrowIntent memory _intent, bytes memory _sig) =
            _escrowFromAccount(_userKey, _acct, 100e6);
        uint _fees = usdc.balanceOf(feeReceiver);
        vm.recordLogs();
        vm.prank(makeAddr("matchmaker"));
        _gate.retireEscrow(_intent, _sig);
        (, bytes memory _record) = _lastRecordOf(vm.getRecordedLogs(), _acct);
        assertGt(
            _acct.code.length, 0, "a bridge that landed before the account existed escrows once the account is created"
        );
        assertEq(
            _store.escrowedMap(_acct, address(usdc)), 100e6, "under the account's own key, as a wallet escrow books it"
        );
        assertEq(usdc.balanceOf(_acct), 50e6 + FEE, "the escrowed funds leave the account");
        assertEq(usdc.balanceOf(address(_store)), 100e6, "into the store of the gate that relayed it");
        assertEq(usdc.balanceOf(feeReceiver), _fees + FEE, "paying the relay fee it signed");
        assertEq(
            _record,
            abi.encode(
                LiquidityGate.retireEscrow.selector, address(usdc), uint(100e6), uint(100e6), address(usdc), FEE
            ),
            "the record carries the amount and the account's escrowed total after it"
        );

        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, _acct, 1, 0));
        _gate.retireEscrow(_intent, _sig);

        (_intent, _sig) = _escrowFromAccount(_userKey, _acct, 50e6);
        vm.recordLogs();
        _gate.retireEscrow(_intent, _sig);
        (, _record) = _lastRecordOf(vm.getRecordedLogs(), _acct);
        assertEq(
            _record,
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
        (LiquidityGate.RetireEscrowIntent memory _intent, bytes memory _sig) =
            _escrowFromAccount(masterKey, _parent, 100e6);
        spoke.retireEscrow(_intent, _sig);
        uint _held = usdc.balanceOf(body);
        _fulfil(address(usdc), 100e6, FEE);
        assertEq(
            spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 100e6, "the owner's signed total draws on it"
        );
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "into the fund body, net of the round fee");
    }

    function test_a_copied_settlement_lands_once_and_the_matchmakers_resubmission_reverts() public {
        _openFund();
        address _parent = _account(master);
        _walletEscrow(spoke, master, 300e6);
        bytes memory _signed = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 100e6, FEE);
        uint _held = usdc.balanceOf(body);

        vm.chainId(FOREIGN_CHAIN_ID);
        vm.recordLogs();
        vm.prank(makeAddr("copier"));
        spoke.fulfil(body, address(usdc), 100e6, FEE, _signed, _noGenesis());
        (, bytes memory _record) = _lastRecordOf(vm.getRecordedLogs(), body);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 100e6, 100e6));
        spoke.fulfil(body, address(usdc), 100e6, FEE, _signed, _noGenesis());
        vm.chainId(HUB_CHAIN);

        assertEq(
            _record,
            abi.encode(SpokeGate.fulfil.selector, address(usdc), uint(100e6), FEE),
            "the record names no owner: the body's own parent is the owner"
        );
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 100e6, "the release counts once");
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "and pays once");
    }

    function test_each_gate_escrows_into_its_own_store_and_only_the_spoke_settles_a_signed_total() public {
        _openFund();
        address _owner = _account(master);
        _walletEscrow(spoke, master, 30e6);
        _walletEscrow(hub, master, 20e6);
        assertEq(address(hub.escrowStore()), address(hubEscrowStore), "the hub gate escrows into the hub store");
        assertEq(address(fundModule.escrowStore()), address(hubEscrowStore), "the one a hub round releases from");
        assertEq(address(spoke.escrowStore()), address(spokeEscrowStore), "and the spoke gate into its own");
        _assertLedger(hubEscrowStore, _owner, 520e6, 500e6, 0);
        _assertLedger(spokeEscrowStore, _owner, 30e6, 0, 0);

        (bool _ok,) =
            address(spoke).call(abi.encodeWithSignature("refund(address,address,uint256)", body, address(usdc), 1));
        assertFalse(_ok, "a spoke cannot see hub credits, so it offers no refund outside the delayed return");
        (_ok,) = address(hub).call(abi.encodeWithSignature("refund(address,address,uint256)", body, address(usdc), 1));
        assertFalse(_ok, "nor does the hub");
        bytes memory _call = abi.encodeCall(
            SpokeGate.fulfil,
            (body, address(usdc), 10e6, FEE, _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 10e6, FEE), _noGenesis())
        );
        vm.chainId(FOREIGN_CHAIN_ID);
        (_ok,) = address(hub).call(_call);
        assertFalse(_ok, "the hub has no fulfil: its escrow leaves only through a round the owner signs, or a return");
        (_ok,) = address(spoke).call(_call);
        assertTrue(_ok, "while the same call releases on the spoke");
        vm.chainId(HUB_CHAIN);
        assertEq(spokeEscrowStore.releasedMap(_owner, address(usdc)), 10e6);
        assertEq(hubEscrowStore.releasedMap(_owner, address(usdc)), 500e6, "and leaves the hub store alone");
    }

    function test_governance_wires_a_new_gate_to_an_escrow_store_and_removing_access_stops_it() public {
        _openFund();
        address _owner = _account(master);
        vm.startPrank(address(governorAccount));
        SpokeGate _next = SpokeGate(address(new RouterProxy(address(governorAccount))));
        RouterProxy(payable(address(_next)))
            .upgrade(address(new SpokeGate(accountModule, depositModule, spokeEscrowStore, spoke.getConfig())));
        accountModule.setAccess(address(_next), FULL_ACCESS);
        depositModule.setAccess(address(_next), FULL_ACCESS);
        vm.stopPrank();
        assertEq(address(_next.escrowStore()), address(spokeEscrowStore), "the new gate names the live store");
        usdc.mint(master, 150e6);
        vm.prank(master);
        IERC20(address(usdc)).approve(address(depositModule), 150e6);

        vm.prank(master);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _next.depositEscrow(address(usdc), 100e6);
        vm.prank(backer);
        vm.expectRevert(Error.Access__CallerNotAuthority.selector);
        spokeEscrowStore.setAccess(address(_next), FULL_ACCESS);
        vm.expectRevert(Error.Access__CallerNotAuthority.selector);
        spokeEscrowStore.setAccess(address(_next), FULL_ACCESS);

        vm.prank(address(governorAccount));
        spokeEscrowStore.setAccess(address(_next), FULL_ACCESS);
        vm.prank(master);
        _next.depositEscrow(address(usdc), 100e6);
        assertEq(
            spokeEscrowStore.escrowedMap(_owner, address(usdc)),
            100e6,
            "once wired, the new gate books into the live ledger"
        );

        bytes memory _signed = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 40e6, FEE);
        bytes memory _more = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 60e6, 2 * FEE);
        vm.chainId(FOREIGN_CHAIN_ID);
        _next.fulfil(body, address(usdc), 40e6, FEE, _signed, _noGenesis());
        uint _held = usdc.balanceOf(body);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 40e6, 40e6));
        spoke.fulfil(body, address(usdc), 40e6, FEE, _signed, _noGenesis());
        vm.chainId(HUB_CHAIN);
        assertEq(usdc.balanceOf(body), _held, "both gates read one settled total, so the release lands once");
        assertEq(spokeEscrowStore.releasedMap(_owner, address(usdc)), 40e6);

        vm.prank(address(governorAccount));
        spokeEscrowStore.setAccess(address(_next), bytes4(0));
        vm.prank(master);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _next.depositEscrow(address(usdc), 50e6);
        vm.prank(master);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _next.requestReturn(address(usdc));
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _next.fulfil(body, address(usdc), 60e6, 2 * FEE, _more, _noGenesis());
        spoke.fulfil(body, address(usdc), 60e6, 2 * FEE, _more, _noGenesis());
        vm.chainId(HUB_CHAIN);

        vm.prank(address(governorAccount));
        hubEscrowStore.setAccess(address(fundModule), bytes4(0));
        _walletEscrow(hub, master, 50e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _nav(), _credit(HUB_CHAIN, address(usdc), 50e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hub.allocate(_i, _sig, _ownerSig);
        _creditRound(FOREIGN_CHAIN_ID, 50e6);
        vm.prank(address(governorAccount));
        hubEscrowStore.setAccess(address(fundModule), EscrowStore.release.selector);
        _creditRound(HUB_CHAIN, 50e6);
        _assertLedger(hubEscrowStore, _owner, 550e6, 550e6, 0);

        _returnOpenEscrow(spoke, master, address(usdc));
        _assertLedger(spokeEscrowStore, _owner, 100e6, 60e6, 40e6);
        assertEq(usdc.balanceOf(master), 90e6, "the gate that keeps its access still settles and returns");
    }

    function test_a_router_proxy_keeps_its_address_across_upgrades_and_answers_only_to_its_authority() public {
        address[5] memory _wired =
            [address(depositModule), address(fundModule), address(redeemModule), address(hub), address(spoke)];
        for (uint _k; _k < _wired.length; ++_k) {
            assertTrue(vm.load(_wired[_k], IMPLEMENTATION_SLOT) != bytes32(0), "every wired router is a live proxy");
        }

        address _first = address(new MockTarget());
        address _second = address(new MockTarget());
        RouterProxy _proxy = new RouterProxy(address(governorAccount));
        assertEq(vm.load(address(_proxy), IMPLEMENTATION_SLOT), bytes32(0), "a fresh proxy runs nothing");

        address[3] memory _refused = [backer, owner, governor];
        for (uint _k; _k < _refused.length; ++_k) {
            vm.prank(_refused[_k]);
            vm.expectRevert(Error.Access__CallerNotAuthority.selector);
            _proxy.upgrade(_first);
        }

        vm.prank(address(governorAccount));
        _proxy.upgrade(_first);
        assertEq(address(uint160(uint(vm.load(address(_proxy), IMPLEMENTATION_SLOT)))), _first);

        vm.prank(address(governorAccount));
        _proxy.upgrade(_second);
        assertEq(
            address(uint160(uint(vm.load(address(_proxy), IMPLEMENTATION_SLOT)))), _second, "an upgrade keeps the address"
        );
        vm.expectCall(_second, abi.encodeCall(MockTarget.ping, ()), 1);
        vm.expectCall(_first, abi.encodeCall(MockTarget.ping, ()), 0);
        MockTarget(address(_proxy)).ping();
    }

    function test_canonical_list_lives_in_the_gate_implementation() public {
        address _impl = address(uint160(uint(vm.load(address(hub), IMPLEMENTATION_SLOT))));
        assertTrue(hub.isCanonical(address(usdc)), "the proxy answers from the implementation's list");
        assertTrue(hub.isCanonical(address(wnt)), "every listed token is canonical");
        assertFalse(hub.isCanonical(address(outToken)), "an unlisted token is not");
        assertTrue(
            HubGate(_impl).isCanonical(address(usdc)), "the implementation answers the same, from its own storage"
        );

        GateConfig memory _config = hub.getConfig();
        vm.expectRevert(abi.encodeWithSelector(Error.Gate__InvalidCanonicalToken.selector, NATIVE_TOKEN));
        new HubGate(
            accountModule,
            depositModule,
            hubEscrowStore,
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
        vm.prank(address(governorAccount));
        RouterProxy(payable(address(hub))).upgrade(_narrow);
        assertFalse(hub.isCanonical(address(wnt)), "the set changes only with the gate logic");
        vm.prank(address(governorAccount));
        RouterProxy(payable(address(hub))).upgrade(_impl);
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
            _allocateIntent(0, 0, _credit(HUB_CHAIN, address(usdc), 500e6), new Fund.Allocation[](0));
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
                    '<rect x="',
                    _last,
                    '" y="',
                    _last,
                    '" width="1" height="1" fill="#',
                    LibString.toHexStringNoPrefix(_rgb, 3),
                    '"/>'
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
                            keccak256(
                                "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                            ),
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
