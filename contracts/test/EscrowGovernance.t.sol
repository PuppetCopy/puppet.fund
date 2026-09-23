// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {LibString} from "solady/utils/LibString.sol";

import {HubGate, MANDATE_INTENT_TYPEHASH} from "src/HubGate.sol";
import {FULFIL_TYPEHASH, SpokeGate} from "src/SpokeGate.sol";
import {Dictate} from "src/core/Dictate.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {Fund} from "src/core/Fund.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {Register} from "src/core/Register.sol";
import {GRID_BYTES, PALETTE_BYTES, Share} from "src/core/Share.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {Error} from "src/utils/Error.sol";
import {LiquidityGate} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {RouterProxy} from "src/utils/RouterProxy.sol";

import {HotPathTest} from "./HotPath.t.sol";
import {MockTarget} from "./mock/MockTarget.t.sol";

contract EscrowGovernanceTest is HotPathTest {
    bytes32 constant ROUND = keccak256("escrow-governance-round");
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function _grid() internal pure returns (bytes memory pixels_) {
        pixels_ = new bytes(GRID_BYTES);
        for (uint _p; _p < GRID_BYTES; ++_p) {
            pixels_[_p] = bytes1(uint8(_p < PALETTE_BYTES ? 1 + (_p * 37) % 255 : (_p - PALETTE_BYTES) % 11));
        }
    }

    function _openFund(
        bytes memory _pixels
    ) internal {
        _fundWallet(master, 2000e6);
        bytes32 _symbol = bytes32("EG");
        share = Share(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(_symbol, _pixels, uint16(hub.performanceFee())),
                bytes32(uint(uint160(body))),
                address(hub)
            )
        );
        _escrow(LiquidityGate(address(hub)), address(usdc), 500e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);
    }

    function _walletEscrow(
        LiquidityGate _gate,
        address _user,
        address _master,
        uint _amount
    ) internal {
        usdc.mint(_user, _amount);
        vm.startPrank(_user);
        IERC20(address(usdc)).approve(address(depositModule), _amount);
        _gate.depositEscrow(_master, address(usdc), _amount);
        vm.stopPrank();
    }

    function _register(
        address _token,
        bytes32 _id
    ) internal {
        vm.startPrank(owner);
        dictate.setAccess(register, owner);
        register.setRegistered(_token, _id);
        dictate.removeAccess(register, owner);
        vm.stopPrank();
    }

    function _storeSignature(
        address _store,
        address _parent,
        uint _from,
        uint _total,
        uint _fee
    ) internal view returns (bytes memory) {
        return _coSig(
            attestorKey,
            AccountLib.typedDigest(
                block.chainid,
                body,
                keccak256(abi.encode(FULFIL_TYPEHASH, _store, _parent, address(usdc), ROUND, _from, _total, _fee))
            )
        );
    }

    function _armCall(
        address _user,
        uint _key,
        address _token,
        bool _arm
    ) internal view returns (HubGate.MandateIntent memory i_, bytes memory sig_) {
        address _acct = accountModule.predictUserAccount(_user);
        address[] memory _tokens = new address[](1);
        _tokens[0] = _token;
        i_ = HubGate.MandateIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            mandateList: new AccountLib.Mandate[](0),
            signatureList: new bytes[](0),
            tokenList: _tokens,
            arm: _arm
        });
        sig_ = _pair(
            _key,
            _typed(
                _acct,
                keccak256(
                    abi.encode(
                        MANDATE_INTENT_TYPEHASH,
                        _hashHeader(i_.header),
                        keccak256(abi.encode(i_.mandateList)),
                        keccak256(abi.encodePacked(_tokens)),
                        _arm
                    )
                )
            )
        );
    }

    function _assertShareMismatch(
        address _master,
        address _share
    ) internal {
        uint _before = gasleft();
        (bool _ok, bytes memory _ret) =
            address(hub).call{gas: 1_000_000}(abi.encodeCall(HubGate.verifyShare, (_master, Share(_share))));
        uint _spent = _before - gasleft();
        assertFalse(_ok, "a share that is not the master's clone is refused");
        assertEq(
            _ret,
            abi.encodeWithSelector(Error.Fund__ShareMismatch.selector, _master, _share),
            "with the mismatch selector, not an out-of-gas"
        );
        assertLt(_spent, 100_000, "and without burning the forwarded gas");
    }

    function test_fulfil_signature_is_bound_to_fromTotal() public {
        _openFund(_grid());
        address _parent = _account(master);
        _walletEscrow(LiquidityGate(address(spoke)), master, body, 300e6);
        bytes memory _first = _fulfilSignature(_parent, address(usdc), ROUND, 0, 100e6, FEE);
        bytes memory _overlap = _fulfilSignature(_parent, address(usdc), ROUND, 0, 250e6, FEE);
        uint _fees = usdc.balanceOf(feeReceiver);
        uint _held = usdc.balanceOf(body);

        spoke.fulfil(_parent, body, address(usdc), ROUND, 0, 100e6, FEE, _first);
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 100e6, "the first release advances the total");

        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 100e6, 250e6));
        spoke.fulfil(_parent, body, address(usdc), ROUND, 0, 250e6, FEE, _overlap);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_parent, body, address(usdc), ROUND, 100e6, 250e6, FEE, _overlap);

        assertEq(usdc.balanceOf(feeReceiver), _fees + FEE, "the stale overlapping signature bills nothing");
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "and releases nothing");

        spoke.fulfil(
            _parent,
            body,
            address(usdc),
            ROUND,
            100e6,
            250e6,
            FEE,
            _fulfilSignature(_parent, address(usdc), ROUND, 100e6, 250e6, FEE)
        );
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 250e6, "a re-signed delta releases");
        assertEq(usdc.balanceOf(feeReceiver), _fees + 2 * FEE, "one fee per priced delta");
        assertEq(usdc.balanceOf(body), _held + 250e6 - 2 * FEE, "the body holds the whole release net of both fees");

        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 250e6, 100e6));
        spoke.fulfil(_parent, body, address(usdc), ROUND, 0, 100e6, FEE, _first);
        assertEq(usdc.balanceOf(address(spokeEscrowStore)), 50e6, "the unreleased escrow stays in the store");
    }

    function test_fulfil_signature_is_bound_to_the_escrow_store() public {
        _openFund(_grid());
        address _parent = _account(master);
        _walletEscrow(LiquidityGate(address(spoke)), master, body, 100e6);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(
            _parent, body, address(usdc), ROUND, 0, 100e6, FEE, _storeSignature(address(escrowStore), _parent, 0, 100e6, FEE)
        );

        bytes memory _old = _storeSignature(address(spokeEscrowStore), _parent, 0, 100e6, FEE);
        spoke.fulfil(_parent, body, address(usdc), ROUND, 0, 100e6, FEE, _old);
        assertEq(spokeEscrowStore.fulfilledMap(_parent, body, address(usdc)), 100e6, "the store the signature names releases");

        EscrowStore _rekeyed = new EscrowStore(address(dictate));
        vm.startPrank(owner);
        address _proxy = dictate.setGate(
            bytes32("SpokeGate"),
            address(new SpokeGate(accountModule, register, depositModule, _rekeyed, spoke.getConfig()))
        );
        dictate.setAccess(_rekeyed, _proxy);
        vm.stopPrank();
        assertEq(_proxy, address(spoke), "the re-key keeps the gate address");
        assertEq(address(spoke.escrowStore()), address(_rekeyed), "and points it at the fresh ledger");

        _walletEscrow(LiquidityGate(address(spoke)), master, body, 100e6);
        assertEq(_rekeyed.escrowedMap(_parent, body, address(usdc)), 100e6);
        assertEq(_rekeyed.fulfilledMap(_parent, body, address(usdc)), 0, "the fresh ledger starts at zero");

        uint _held = usdc.balanceOf(body);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_parent, body, address(usdc), ROUND, 0, 100e6, FEE, _old);

        spoke.fulfil(
            _parent, body, address(usdc), ROUND, 0, 100e6, FEE, _storeSignature(address(_rekeyed), _parent, 0, 100e6, FEE)
        );
        assertEq(_rekeyed.fulfilledMap(_parent, body, address(usdc)), 100e6, "only a signature naming the new store releases");
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "exactly once");
        assertEq(usdc.balanceOf(address(_rekeyed)), 0);
    }

    function test_fulfil_fee_is_capped_by_max_relay_fee_bps() public {
        _openFund(_grid());
        address _parent = _account(master);
        _walletEscrow(LiquidityGate(address(spoke)), master, body, 100e6);
        assertEq(spoke.getConfig().maxRelayFeeBps, 1000);

        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 10e6 + 1, 100e6, 1000));
        spoke.fulfil(
            _parent,
            body,
            address(usdc),
            ROUND,
            0,
            100e6,
            10e6 + 1,
            _fulfilSignature(_parent, address(usdc), ROUND, 0, 100e6, 10e6 + 1)
        );

        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 100e6, 100e6, 1000));
        spoke.fulfil(
            _parent,
            body,
            address(usdc),
            ROUND,
            0,
            100e6,
            100e6,
            _fulfilSignature(_parent, address(usdc), ROUND, 0, 100e6, 100e6)
        );

        uint _fees = usdc.balanceOf(feeReceiver);
        uint _held = usdc.balanceOf(body);
        spoke.fulfil(
            _parent, body, address(usdc), ROUND, 0, 100e6, 10e6, _fulfilSignature(_parent, address(usdc), ROUND, 0, 100e6, 10e6)
        );
        assertEq(usdc.balanceOf(feeReceiver), _fees + 10e6, "a fee exactly at the cap is billed");
        assertEq(usdc.balanceOf(body), _held + 90e6, "and the rest of the release lands in the body");
    }

    function test_fulfil_refuses_a_parent_that_is_not_the_bodys_bound_parent() public {
        address _stranger = accountModule.predictUserAccount(backer);
        _walletEscrow(LiquidityGate(address(spoke)), backer, body, 100e6);
        _openFund(_grid());
        address _parent = _account(master);
        (address _module, address _bound) = FundAccount(payable(body)).bound();
        assertEq(_module, address(accountModule));
        assertEq(_bound, _parent);
        _walletEscrow(LiquidityGate(address(spoke)), master, body, 100e6);
        uint _held = usdc.balanceOf(body);

        bytes memory _signed = _fulfilSignature(_stranger, address(usdc), ROUND, 0, 100e6, FEE);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
        spoke.fulfil(_stranger, body, address(usdc), ROUND, 0, 100e6, FEE, _signed);
        assertEq(spokeEscrowStore.fulfilledMap(_stranger, body, address(usdc)), 0, "a stranger's escrow is never released");
        assertEq(spokeEscrowStore.escrowedMap(_stranger, body, address(usdc)), 100e6);
        assertEq(usdc.balanceOf(body), _held, "into the body, even with an attestor signature");

        spoke.fulfil(
            _parent, body, address(usdc), ROUND, 0, 100e6, FEE, _fulfilSignature(_parent, address(usdc), ROUND, 0, 100e6, FEE)
        );
        assertEq(usdc.balanceOf(body), _held + 100e6 - FEE, "the bound parent's escrow releases");
    }

    function test_hub_refund_is_open_for_a_master_not_bound_to_the_parent() public {
        address _typo = makeAddr("typo");
        address _stranger = accountModule.predictUserAccount(backer);
        _walletEscrow(LiquidityGate(address(hub)), backer, _typo, 50e6);
        _walletEscrow(LiquidityGate(address(hub)), backer, body, 80e6);

        vm.startPrank(backer);
        hub.refund(_typo, address(usdc), 50e6);
        hub.refund(body, address(usdc), 30e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(backer), 80e6, "a codeless and an unbound master both refund at once");
        assertEq(escrowStore.escrowedMap(_stranger, _typo, address(usdc)), 0);
        assertEq(escrowStore.escrowedMap(_stranger, body, address(usdc)), 50e6);

        _openFund(_grid());

        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 50e6, 50e6 + 1));
        hub.refund(body, address(usdc), 50e6 + 1);

        vm.prank(backer);
        hub.refund(body, address(usdc), 50e6);
        assertEq(usdc.balanceOf(backer), 130e6, "a body bound to another parent still refunds the stranger");
        assertEq(escrowStore.escrowedMap(_stranger, body, address(usdc)), 0);

        _walletEscrow(LiquidityGate(address(hub)), master, body, 30e6);
        vm.prank(master);
        vm.expectRevert(Error.Escrow__RefundClosed.selector);
        hub.refund(body, address(usdc), 30e6);
    }

    function test_hub_refund_is_open_for_a_deregistered_token() public {
        _openFund(_grid());
        address _parent = _account(master);
        _walletEscrow(LiquidityGate(address(hub)), master, body, 40e6);

        vm.prank(master);
        vm.expectRevert(Error.Escrow__RefundClosed.selector);
        hub.refund(body, address(usdc), 40e6);

        _register(address(usdc), bytes32(0));

        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 40e6, 40e6 + 1));
        hub.refund(body, address(usdc), 40e6 + 1);

        vm.prank(master);
        hub.refund(body, address(usdc), 40e6);
        assertEq(usdc.balanceOf(master), 40e6, "the uncredited hub escrow returns to the wallet");
        assertEq(escrowStore.escrowedMap(_parent, body, address(usdc)), 500e6, "down to what the opening round credited");
        assertEq(escrowStore.fulfilledMap(_parent, body, address(usdc)), 500e6);
        assertEq(usdc.balanceOf(address(escrowStore)), 0);

        _register(address(usdc), bytes32("USDC"));
        _walletEscrow(LiquidityGate(address(hub)), master, body, 10e6);
        vm.prank(master);
        vm.expectRevert(Error.Escrow__RefundClosed.selector);
        hub.refund(body, address(usdc), 10e6);
    }

    function test_hub_refund_is_closed_for_the_bound_master_and_the_spoke_has_no_refund() public {
        _openFund(_grid());
        address _parent = _account(master);
        _walletEscrow(LiquidityGate(address(hub)), master, body, 30e6);

        vm.prank(master);
        vm.expectRevert(Error.Escrow__RefundClosed.selector);
        hub.refund(body, address(usdc), 30e6);
        assertEq(escrowStore.escrowedMap(_parent, body, address(usdc)), 530e6, "the bound owner's escrow stays committed to the fund");

        (bool _ok,) = address(spoke).call(abi.encodeWithSignature("refund(address,address,uint256)", body, address(usdc), 1));
        assertFalse(_ok, "a spoke cannot see hub credits, so it offers no refund");
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

    function test_register_zero_id_deregisters_and_the_event_carries_the_stored_id() public {
        vm.prank(backer);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        register.setRegistered(address(usdc), bytes32(0));

        vm.prank(owner);
        dictate.setAccess(register, owner);

        vm.expectEmit(address(register));
        emit Register.Registered(address(usdc), bytes32(0));
        vm.prank(owner);
        register.setRegistered(address(usdc), bytes32(0));
        assertEq(register.tokenIdMap(address(usdc)), bytes32(0), "a zero id deregisters");

        usdc.mint(backer, 1e6);
        vm.startPrank(backer);
        IERC20(address(usdc)).approve(address(depositModule), 1e6);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__TokenNotValuable.selector, address(usdc)));
        hub.deposit(address(usdc), 1e6);
        vm.stopPrank();

        vm.expectEmit(address(register));
        emit Register.Registered(address(usdc), bytes32("USDC.e"));
        vm.prank(owner);
        register.setRegistered(address(usdc), bytes32("USDC.e"));
        assertEq(register.tokenIdMap(address(usdc)), bytes32("USDC.e"), "the event carries exactly the stored id");

        vm.prank(owner);
        vm.expectRevert(Error.Register__InvalidToken.selector);
        register.setRegistered(makeAddr("codeless"), bytes32("X"));

        vm.expectEmit(address(register));
        emit Register.Registered(NATIVE_TOKEN, bytes32(0));
        vm.prank(owner);
        register.setRegistered(NATIVE_TOKEN, bytes32(0));
        assertEq(register.tokenIdMap(NATIVE_TOKEN), bytes32(0));

        uint _whale = 1e30;
        usdc.mint(backer, _whale);
        vm.startPrank(backer);
        IERC20(address(usdc)).approve(address(depositModule), _whale);
        hub.deposit(address(usdc), _whale);
        vm.stopPrank();
        assertEq(usdc.balanceOf(_account(backer)), _whale, "registration is a set, with no per-call cap");
    }

    function test_mandate_disarm_works_for_a_deregistered_token() public {
        _fundWallet(backer, 100e6);
        address _acct = _account(backer);

        (HubGate.MandateIntent memory _i, bytes memory _sig) = _armCall(backer, backerKey, address(outToken), true);
        hub.mandate(_i, _sig);
        assertEq(outToken.allowance(_acct, address(fundModule)), type(uint).max, "arming grants the fund its allowance");

        _register(address(outToken), bytes32(0));

        (_i, _sig) = _armCall(backer, backerKey, address(outToken), true);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__TokenNotValuable.selector, address(outToken)));
        hub.mandate(_i, _sig);

        uint _fees = usdc.balanceOf(feeReceiver);
        uint _nonce = _nonceOf(_acct);
        (_i, _sig) = _armCall(backer, backerKey, address(outToken), false);
        hub.mandate(_i, _sig);
        assertEq(outToken.allowance(_acct, address(fundModule)), 0, "a delisted token can still be disarmed");
        assertEq(_nonceOf(_acct), _nonce + 1);
        assertEq(usdc.balanceOf(feeReceiver), _fees + FEE);
    }

    function test_createFund_refuses_a_pixel_index_of_eleven_or_more() public {
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes memory _bad = _grid();
        _bad[PALETTE_BYTES + 57] = bytes1(uint8(11));
        vm.expectRevert(abi.encodeWithSelector(Error.Share__InvalidPixel.selector, 57, 11));
        hub.createFund(bytes32("EG"), _bad, "", "", _i, _sig);

        _bad[PALETTE_BYTES + 5] = bytes1(uint8(255));
        vm.expectRevert(abi.encodeWithSelector(Error.Share__InvalidPixel.selector, 5, 255));
        hub.createFund(bytes32("EG"), _bad, "", "", _i, _sig);

        bytes memory _pixels = _grid();
        assertEq(uint8(_pixels[GRID_BYTES - 1]), 10);
        _openFund(_pixels);
        assertEq(share.pixels(), _pixels, "a grid using index 10 opens a fund");

        string memory _json = string(Base64.decode(LibString.slice(share.tokenURI(), 29)));
        string memory _marker = '"image":"data:image/svg+xml;base64,';
        uint _at = LibString.indexOf(_json, _marker) + bytes(_marker).length;
        string memory _svg = string(Base64.decode(LibString.slice(_json, _at, bytes(_json).length - 2)));
        uint _rgb = (uint(uint8(_pixels[30])) << 16) | (uint(uint8(_pixels[31])) << 8) | uint(uint8(_pixels[32]));
        assertTrue(
            LibString.contains(
                _svg,
                string.concat(
                    '<rect x="10" y="10" width="1" height="1" fill="#', LibString.toHexStringNoPrefix(_rgb, 3), '"/>'
                )
            ),
            "index 10 renders the last palette colour"
        );
    }

    function test_verifyShare_reverts_for_short_code_without_burning_gas() public {
        _openFund(_grid());
        hub.verifyShare(body, share);
        assertEq(address(share).code.length, 0x2d + 32 + GRID_BYTES + 2);

        assertEq(body.code.length, 23, "a 7702 body carries 23 bytes of code");
        _assertShareMismatch(body, body);

        address _oneByte = makeAddr("one-byte");
        vm.etch(_oneByte, hex"00");
        _assertShareMismatch(body, _oneByte);

        address _short = makeAddr("short");
        vm.etch(_short, new bytes(44));
        _assertShareMismatch(body, _short);

        _assertShareMismatch(body, makeAddr("codeless"));
        _assertShareMismatch(backer, address(share));

        address _foreign = LibClone.cloneDeterministic(
            fundModule.shareImpl(),
            abi.encodePacked(bytes32("EG"), _grid(), uint16(hub.performanceFee())),
            bytes32(uint(uint160(body)))
        );
        assertEq(_foreign.code, address(share).code, "a clone with identical code");
        _assertShareMismatch(body, _foreign);

        (bool _ok, bytes memory _ret) =
            address(hub).call{gas: 1_000_000}(abi.encodeCall(HubGate.claim, (body, Share(body), _account(backer))));
        assertFalse(_ok);
        assertEq(_ret, abi.encodeWithSelector(Error.Fund__ShareMismatch.selector, body, body), "claim shares the guard");
    }

    function test_share_refuses_approve_permit_and_transfer_and_reports_no_permit2_allowance() public {
        _openFund(_grid());
        uint _held = share.balanceOf(body);
        assertGt(_held, 0);
        assertEq(share.issuer(), address(fundModule));
        assertEq(share.allowance(body, PERMIT2), 0, "Permit2 holds no implicit allowance");

        vm.prank(body);
        vm.expectRevert(Error.Share__NotIssuer.selector);
        share.approve(backer, 1);

        vm.prank(body);
        vm.expectRevert(Error.Share__NotIssuer.selector);
        share.transfer(backer, 1);

        vm.prank(address(fundModule));
        vm.expectRevert(Error.Share__NotIssuer.selector);
        share.transfer(backer, 1);

        uint _deadline = vm.getBlockTimestamp() + 1 hours;
        (uint8 _v, bytes32 _r, bytes32 _s) = vm.sign(
            bodyKey,
            keccak256(
                abi.encodePacked(
                    hex"1901",
                    share.DOMAIN_SEPARATOR(),
                    keccak256(
                        abi.encode(
                            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                            body,
                            backer,
                            1,
                            share.nonces(body),
                            _deadline
                        )
                    )
                )
            )
        );
        vm.expectRevert(Error.Share__NotIssuer.selector);
        share.permit(body, backer, 1, _deadline, _v, _r, _s);

        vm.prank(PERMIT2);
        vm.expectRevert(Error.Share__NotIssuer.selector);
        share.transferFrom(body, PERMIT2, 1);

        assertEq(share.allowance(body, backer), 0);
        assertEq(share.nonces(body), 0);
        assertEq(share.balanceOf(body), _held, "no unit moved");
        assertEq(share.balanceOf(backer), 0);
        assertEq(share.balanceOf(PERMIT2), 0);
    }
}
