// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

import {HubGate} from "src/HubGate.sol";
import {SpokeGate} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {GovernorAccount} from "src/core/GovernorAccount.sol";
import {Error} from "src/utils/Error.sol";
import {RouterProxy} from "src/utils/RouterProxy.sol";
import {Access, FULL_ACCESS} from "src/utils/auth/Access.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

import {HotPathTest} from "./HotPath.t.sol";
import {MockTarget} from "./mock/MockTarget.t.sol";

bytes constant FX_CHILD_CODE = hex"608060405234801561001057600080fd5b50600436106100415760003560e01c806326c53bea146100465780634c8ff99e146100"
    hex"c9578063de9b771f1461010d575b600080fd5b6100c76004803603604081101561005c57600080fd5b8101908080359060200190"
    hex"9291908035906020019064010000000081111561008357600080fd5b82018360208201111561009557600080fd5b803590602001"
    hex"918460018302840111640100000000831117156100b757600080fd5b9091929391929390505050610141565b005b61010b600480"
    hex"360360208110156100df57600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff169060200190929190"
    hex"5050506104b3565b005b61011561054f565b604051808273ffffffffffffffffffffffffffffffffffffffff1681526020019150"
    hex"5060405180910390f35b61100173ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffff"
    hex"ffffffffff16146101e4576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401"
    hex"80806020018281038252600e8152602001807f496e76616c69642073656e64657200000000000000000000000000000000000081"
    hex"525060200191505060405180910390fd5b6000806060848460608110156101f957600080fd5b81019080803573ffffffffffffff"
    hex"ffffffffffffffffffffffffff169060200190929190803573ffffffffffffffffffffffffffffffffffffffff16906020019092"
    hex"91908035906020019064010000000081111561025657600080fd5b82018360208201111561026857600080fd5b80359060200191"
    hex"84600183028401116401000000008311171561028a57600080fd5b91908080601f01602080910402602001604051908101604052"
    hex"8093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290505050"
    hex"9250925092507ff091cd9cbbaff01426d8183042dff452ef18e6690f19816d5dd114e00761e0e8838383604051808473ffffffff"
    hex"ffffffffffffffffffffffffffffffff1681526020018373ffffffffffffffffffffffffffffffffffffffff1681526020018060"
    hex"2001828103825283818151815260200191508051906020019080838360005b838110156103795780820151818401526020810190"
    hex"5061035e565b50505050905090810190601f1680156103a65780820380516001836020036101000a031916815260200191505b50"
    hex"94505050505060405180910390a18173ffffffffffffffffffffffffffffffffffffffff16639a7c4b718785846040518463ffff"
    hex"ffff1660e01b8152600401808481526020018373ffffffffffffffffffffffffffffffffffffffff168152602001806020018281"
    hex"03825283818151815260200191508051906020019080838360005b8381101561044557808201518184015260208101905061042a"
    hex"565b50505050905090810190601f1680156104725780820380516001836020036101000a031916815260200191505b5094505050"
    hex"5050600060405180830381600087803b15801561049357600080fd5b505af11580156104a7573d6000803e3d6000fd5b50505050"
    hex"505050505050565b600073ffffffffffffffffffffffffffffffffffffffff1660008054906101000a900473ffffffffffffffff"
    hex"ffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff161461050c57600080fd5b80600080610100"
    hex"0a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16"
    hex"021790555050565b60008054906101000a900473ffffffffffffffffffffffffffffffffffffffff168156fea264697066735822"
    hex"12200bdcfd65315e64d5f0ec860741e1cc6695c5e01920326ec06cadc7f8a48e45ff64736f6c63430007030033";

interface IStateReceiver {
    function onStateReceive(
        uint _stateId,
        bytes calldata _data
    ) external;
}

contract MockGuarded is Access {
    constructor(
        address _authority
    ) Access(_authority) {}

    fallback() external auth {}
}

contract MockMessenger {
    address internal sender;

    function xDomainMessageSender() external view returns (address) {
        require(sender != address(0), "CrossDomainMessenger: xDomainMessageSender is not set");
        return sender;
    }

    function relayMessage(
        address _sender,
        address _target,
        bytes calldata _message
    ) external payable {
        sender = _sender;
        (bool _ok, bytes memory _result) = _target.call{value: msg.value}(_message);
        delete sender;
        if (!_ok) {
            assembly ("memory-safe") {
                revert(add(_result, 32), mload(_result))
            }
        }
    }
}

contract MockReplayingMessenger {
    address public xDomainMessageSender;
    mapping(bytes32 => bool) public failedMessages;
    mapping(bytes32 => bool) public successfulMessages;

    function relayMessage(
        uint _nonce,
        address _sender,
        address _target,
        bytes calldata _message
    ) external {
        bytes32 _hash = keccak256(abi.encode(_nonce, _sender, _target, _message));
        require(!successfulMessages[_hash], "CrossDomainMessenger: message has already been relayed");
        xDomainMessageSender = _sender;
        (bool _ok,) = _target.call(_message);
        xDomainMessageSender = address(0);
        if (_ok) successfulMessages[_hash] = true;
        else failedMessages[_hash] = true;
    }
}

contract MockRetryable {
    mapping(bytes32 ticket => bool) public redeemedMap;

    function redeem(
        uint _ticket,
        address _target,
        bytes calldata _data,
        uint _gasLimit
    ) external returns (bool ok_) {
        bytes32 _id = keccak256(abi.encode(_ticket, _target, _data));
        require(!redeemedMap[_id], "ArbRetryableTx: ticket already redeemed");
        (ok_,) = _target.call{gas: _gasLimit}(_data);
        redeemedMap[_id] = ok_;
    }
}

contract GovernanceMatrixTest is HotPathTest {
    enum Path {
        Alias,
        FxChild
    }

    address constant OP_MESSENGER = 0x4200000000000000000000000000000000000007;
    address constant FX_CHILD = 0x8397259c983751DAf40400790063935a11afa28a;
    address constant STATE_RECEIVER = 0x0000000000000000000000000000000000001001;
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address stranger = makeAddr("stranger");

    function _relay(
        Path _path,
        address _sender,
        uint _attached,
        uint _deadline,
        IAccount.Call[] memory _callList
    ) internal {
        if (_path == Path.Alias) {
            vm.deal(_aliased(_sender), _attached);
            vm.prank(_aliased(_sender));
            governorAccount.execute{value: _attached}(_deadline, _callList);
        } else {
            require(_attached == 0, "a state sync carries no value");
            vm.prank(STATE_RECEIVER);
            IStateReceiver(FX_CHILD)
                .onStateReceive(1, abi.encode(_sender, address(governorAccount), abi.encode(_deadline, _callList)));
        }
    }

    function _vote(
        Path _path,
        address _target,
        bytes memory _call
    ) internal {
        _relay(_path, governor, 0, vm.getBlockTimestamp(), _batch(_target, 0, _call));
    }

    function _batch(
        address _target,
        uint _value,
        bytes memory _callData
    ) internal pure returns (IAccount.Call[] memory batch_) {
        batch_ = new IAccount.Call[](1);
        batch_[0] = IAccount.Call({target: _target, value: _value, gasLimit: 0, callData: _callData});
    }

    function _hubWithRelease(
        bytes32 _release
    ) internal returns (address) {
        return address(
            new HubGate(
                accountModule,
                depositModule,
                hubEscrowStore,
                fundModule,
                redeemModule,
                hub.getConfig(),
                _endpoints(ATTESTOR_ENDPOINT),
                _list(address(usdc), address(wnt)),
                100,
                PERFORMANCE_FEE,
                _release
            )
        );
    }

    function _aliased(
        address _l1
    ) internal pure returns (address) {
        unchecked {
            return address(uint160(_l1) + uint160(0x1111000000000000000000000000000000001111));
        }
    }

    function _implementationOf(
        address _proxy
    ) internal view returns (address) {
        return address(uint160(uint(vm.load(_proxy, IMPLEMENTATION_SLOT))));
    }

    function _forbidden(
        address _caller
    ) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Error.GovernorAccount__Forbidden.selector, _caller);
    }

    function _callFailed(
        bytes memory _inner
    ) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Error.GovernorAccount__CallFailed.selector, _inner);
    }

    function test_the_governor_account_is_every_modules_authority_and_answers_to_the_governor_alone() public {
        assertEq(governorAccount.governor(), governor, "the account answers to the governor alone");
        assertEq(_implementationOf(address(governorAccount)), address(0), "and is no proxy: nothing upgrades it");
        address[8] memory _modules = [
            address(accountModule),
            address(fundStore),
            address(mandateStore),
            address(hubEscrowStore),
            address(spokeEscrowStore),
            address(depositModule),
            address(fundModule),
            address(redeemModule)
        ];
        for (uint _k; _k < _modules.length; ++_k) {
            assertEq(Access(_modules[_k]).authority(), address(governorAccount), "every module names the account");
        }

        address _next = address(new MockTarget());
        address[5] memory _routers =
            [address(depositModule), address(fundModule), address(redeemModule), address(hub), address(spoke)];
        address[3] memory _refused = [owner, governor, _aliased(governor)];
        for (uint _r; _r < _routers.length; ++_r) {
            for (uint _k; _k < _refused.length; ++_k) {
                vm.prank(_refused[_k]);
                vm.expectRevert(Error.Access__CallerNotAuthority.selector);
                RouterProxy(payable(_routers[_r])).upgrade(_next);
            }
        }
        assertTrue(_implementationOf(address(spoke)) != _next, "no key repoints a router, the deployer's included");
    }

    function test_only_the_governor_account_upgrades_a_router_or_writes_a_grant() public {
        address _spokeImpl = _implementationOf(address(spoke));
        address _next = address(new MockTarget());
        address[4] memory _targets = [address(spoke), address(hubEscrowStore), address(accountModule), address(hubEscrowStore)];
        bytes[4] memory _calls = [
            abi.encodeCall(RouterProxy.upgrade, (_next)),
            abi.encodeCall(Access.setAccess, (stranger, FULL_ACCESS)),
            abi.encodeCall(Access.setAccess, (stranger, AccountModule.dispatch.selector)),
            abi.encodeCall(Access.setAccess, (address(hub), bytes4(0)))
        ];
        bytes memory _refusal = abi.encodeWithSelector(Error.Access__CallerNotAuthority.selector);
        address[10] memory _callers = [
            stranger,
            owner,
            governor,
            _aliased(governor),
            address(accountModule),
            address(depositModule),
            address(fundModule),
            address(redeemModule),
            address(hub),
            address(spoke)
        ];
        for (uint _c; _c < _callers.length; ++_c) {
            vm.startPrank(_callers[_c]);
            for (uint _k; _k < _calls.length; ++_k) {
                (bool _ok, bytes memory _ret) = _targets[_k].call(_calls[_k]);
                assertFalse(_ok, "no caller but the account upgrades a router or writes a grant");
                assertEq(_ret, _refusal, "each is refused as not the authority");
            }
            vm.stopPrank();
        }
        assertEq(_implementationOf(address(spoke)), _spokeImpl, "no router moved");
        assertEq(hubEscrowStore.authMap(stranger), bytes4(0), "no access was granted");
        assertEq(accountModule.authMap(stranger), bytes4(0), "nor a method");
        assertEq(hubEscrowStore.authMap(address(hub)), FULL_ACCESS, "and none revoked");

        vm.startPrank(address(governorAccount));
        for (uint _k; _k < _calls.length; ++_k) {
            (bool _ok,) = _targets[_k].call(_calls[_k]);
            assertTrue(_ok, "the account makes each call directly");
        }
        vm.stopPrank();
        assertEq(_implementationOf(address(spoke)), _next, "swapping a router");
        assertEq(hubEscrowStore.authMap(stranger), FULL_ACCESS, "granting full access");
        assertEq(accountModule.authMap(stranger), AccountModule.dispatch.selector, "granting one method");
        assertEq(hubEscrowStore.authMap(address(hub)), bytes4(0), "and revoking a grant");
    }

    function test_set_access_grants_full_access_one_method_or_revokes() public {
        address _module = makeAddr("module");
        vm.prank(address(governorAccount));
        hubEscrowStore.setAccess(_module, FULL_ACCESS);
        assertEq(hubEscrowStore.authMap(_module), FULL_ACCESS, "FULL_ACCESS grants every method");

        vm.prank(address(governorAccount));
        hubEscrowStore.setAccess(_module, EscrowStore.requestReturn.selector);
        assertEq(
            hubEscrowStore.authMap(_module),
            EscrowStore.requestReturn.selector,
            "a selector sets that one method in its place"
        );

        vm.prank(address(governorAccount));
        hubEscrowStore.setAccess(_module, bytes4(0));
        assertEq(hubEscrowStore.authMap(_module), bytes4(0), "and the zero selector revokes");

        address[2] memory _writers = [stranger, address(hub)];
        for (uint _k; _k < _writers.length; ++_k) {
            vm.prank(_writers[_k]);
            vm.expectRevert(Error.Access__CallerNotAuthority.selector);
            hubEscrowStore.setAccess(_module, FULL_ACCESS);
        }
        assertEq(hubEscrowStore.authMap(_module), bytes4(0), "only the account writes a module's grant");
    }

    function test_a_method_grant_passes_that_method_only() public {
        address _module = makeAddr("module");
        vm.prank(address(governorAccount));
        hubEscrowStore.setAccess(_module, EscrowStore.requestReturn.selector);
        vm.startPrank(_module);
        hubEscrowStore.requestReturn(_module, address(usdc));
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hubEscrowStore.escrow(_module, address(usdc), 0);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hubEscrowStore.refund(_module, address(usdc), 200_000);
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hubEscrowStore.requestReturn(stranger, address(usdc));
    }

    function test_full_access_passes_every_method() public {
        address _module = makeAddr("module");
        MockGuarded _guarded = new MockGuarded(address(governorAccount));
        vm.startPrank(address(governorAccount));
        hubEscrowStore.setAccess(_module, FULL_ACCESS);
        _guarded.setAccess(_module, FULL_ACCESS);
        vm.stopPrank();
        vm.startPrank(_module);
        hubEscrowStore.requestReturn(_module, address(usdc));
        assertEq(hubEscrowStore.escrow(_module, address(usdc), 0), 0, "full access books escrow");
        (bool _ok,) = address(_guarded).call("");
        assertTrue(_ok, "and passes even a call whose selector is zero");
        vm.stopPrank();
    }

    function test_setting_the_zero_selector_revokes_a_grant() public {
        address _module = makeAddr("module");
        address _full = makeAddr("full-module");
        vm.startPrank(address(governorAccount));
        hubEscrowStore.setAccess(_module, EscrowStore.requestReturn.selector);
        hubEscrowStore.setAccess(_full, FULL_ACCESS);
        hubEscrowStore.setAccess(_module, bytes4(0));
        hubEscrowStore.setAccess(_full, bytes4(0));
        vm.stopPrank();
        vm.prank(_module);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hubEscrowStore.requestReturn(_module, address(usdc));
        vm.prank(_full);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hubEscrowStore.requestReturn(_full, address(usdc));
        vm.prank(_full);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hubEscrowStore.escrow(_full, address(usdc), 0);
    }

    function test_regranting_a_different_selector_replaces_the_old_one() public {
        address _module = makeAddr("module");
        vm.prank(address(governorAccount));
        hubEscrowStore.setAccess(_module, EscrowStore.requestReturn.selector);
        vm.prank(_module);
        hubEscrowStore.requestReturn(_module, address(usdc));

        vm.prank(address(governorAccount));
        hubEscrowStore.setAccess(_module, EscrowStore.escrow.selector);
        vm.startPrank(_module);
        assertEq(hubEscrowStore.escrow(_module, address(usdc), 0), 0, "the new method passes");
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hubEscrowStore.requestReturn(_module, address(usdc));
        vm.stopPrank();
    }

    function test_an_empty_grant_cannot_pass_even_a_zero_selector() public {
        MockGuarded _guarded = new MockGuarded(address(governorAccount));
        address _module = makeAddr("module");
        bytes memory _unauthorized = abi.encodeWithSelector(Error.Access__Unauthorized.selector);
        assertEq(_guarded.authMap(_module), bytes4(0), "the module holds no grant");
        vm.prank(_module);
        (bool _ok, bytes memory _ret) = address(_guarded).call("");
        assertFalse(_ok, "a call whose selector is zero does not match an empty grant");
        assertEq(_ret, _unauthorized, "it is refused as unauthorized");

        vm.prank(address(governorAccount));
        _guarded.setAccess(_module, EscrowStore.escrow.selector);
        vm.prank(_module);
        (_ok, _ret) = address(_guarded).call("");
        assertFalse(_ok, "a method grant passes no other selector, zero included");
        assertEq(_ret, _unauthorized);

        vm.prank(address(governorAccount));
        _guarded.setAccess(_module, FULL_ACCESS);
        vm.prank(_module);
        (_ok,) = address(_guarded).call("");
        assertTrue(_ok, "while full access passes it");

        vm.prank(address(governorAccount));
        _guarded.setAccess(_module, bytes4(0));
        vm.prank(_module);
        (_ok, _ret) = address(_guarded).call("");
        assertFalse(_ok, "and revoking makes the grant empty again");
        assertEq(_ret, _unauthorized);
    }

    function test_create_user_account_honors_its_method_grant_or_full_access() public {
        address _creator = makeAddr("account-creator");
        address[2] memory _wallets = [makeAddr("wallet-a"), makeAddr("wallet-b")];

        vm.prank(address(governorAccount));
        accountModule.setAccess(_creator, AccountModule.dispatch.selector);
        vm.prank(_creator);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        accountModule.createUserAccount(_wallets[0]);

        vm.prank(address(governorAccount));
        accountModule.setAccess(_creator, AccountModule.createUserAccount.selector);
        vm.prank(_creator);
        assertEq(
            accountModule.createUserAccount(_wallets[0]),
            accountModule.predictUserAccount(_wallets[0]),
            "its own method grant opens an account for any wallet"
        );

        vm.prank(address(governorAccount));
        accountModule.setAccess(_creator, bytes4(0));
        vm.prank(_creator);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        accountModule.createUserAccount(_wallets[1]);

        vm.prank(address(governorAccount));
        accountModule.setAccess(_creator, FULL_ACCESS);
        vm.prank(_creator);
        assertEq(
            accountModule.createUserAccount(_wallets[1]),
            accountModule.predictUserAccount(_wallets[1]),
            "and so does full access"
        );
    }

    function test_a_release_changes_only_when_the_account_swaps_the_hub_implementation() public {
        vm.etch(FX_CHILD, FX_CHILD_CODE);
        bytes32 _approved = keccak256("the release a vote approves");
        address _approvedHub = _hubWithRelease(_approved);
        address _revokedHub = _hubWithRelease(bytes32(0));
        address[5] memory _refused = [stranger, owner, governor, _aliased(governor), address(hub)];
        for (uint _k; _k < _refused.length; ++_k) {
            vm.prank(_refused[_k]);
            vm.expectRevert(Error.Access__CallerNotAuthority.selector);
            RouterProxy(payable(address(hub))).upgrade(_approvedHub);
        }
        assertEq(
            hub.websiteRelease(), WEBSITE_RELEASE, "no caller but the account swaps the hub, so none moves the release"
        );

        _vote(Path.Alias, address(hub), abi.encodeCall(RouterProxy.upgrade, (_approvedHub)));
        assertEq(hub.websiteRelease(), _approved, "a vote names a release by swapping in the hub that carries it");
        _vote(Path.FxChild, address(hub), abi.encodeCall(RouterProxy.upgrade, (_revokedHub)));
        assertEq(
            hub.websiteRelease(), bytes32(0), "and revokes every release with one naming the zero hash, on either path"
        );
    }

    function test_the_governor_wires_a_new_gate_through_the_alias_path() public {
        _wiresANewGate(Path.Alias);
    }

    function test_the_governor_wires_a_new_gate_through_fx_child() public {
        _wiresANewGate(Path.FxChild);
    }

    function _wiresANewGate(
        Path _path
    ) internal {
        vm.etch(FX_CHILD, FX_CHILD_CODE);
        address _nextImpl = address(new SpokeGate(accountModule, depositModule, spokeEscrowStore, spoke.getConfig()));
        address _next = address(new RouterProxy(address(governorAccount)));
        IAccount.Call[] memory _wire = new IAccount.Call[](4);
        _wire[0] = IAccount.Call({
            target: _next, value: 0, gasLimit: 0, callData: abi.encodeCall(RouterProxy.upgrade, (_nextImpl))
        });
        _wire[1] = IAccount.Call({
            target: address(accountModule),
            value: 0,
            gasLimit: 0,
            callData: abi.encodeCall(Access.setAccess, (_next, FULL_ACCESS))
        });
        _wire[2] = IAccount.Call({
            target: address(depositModule),
            value: 0,
            gasLimit: 0,
            callData: abi.encodeCall(Access.setAccess, (_next, FULL_ACCESS))
        });
        _wire[3] = IAccount.Call({
            target: address(spokeEscrowStore),
            value: 0,
            gasLimit: 0,
            callData: abi.encodeCall(Access.setAccess, (_next, FULL_ACCESS))
        });
        _relay(_path, governor, 0, vm.getBlockTimestamp(), _wire);

        usdc.mint(master, 100e6);
        vm.startPrank(master);
        IERC20(address(usdc)).approve(address(depositModule), 100e6);
        SpokeGate(_next).depositEscrow(address(usdc), 60e6);
        vm.stopPrank();
        assertEq(
            spokeEscrowStore.escrowedMap(_account(master), address(usdc)),
            60e6,
            "one vote wires a new gate with the spoke's grants, and it books"
        );

        _vote(
            _path,
            address(spokeEscrowStore),
            abi.encodeCall(Access.setAccess, (_next, EscrowStore.requestReturn.selector))
        );
        vm.prank(master);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        SpokeGate(_next).depositEscrow(address(usdc), 40e6);
        vm.prank(master);
        SpokeGate(_next).requestReturn(address(usdc));

        _vote(_path, address(spokeEscrowStore), abi.encodeCall(Access.setAccess, (_next, bytes4(0))));
        vm.prank(master);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        SpokeGate(_next).requestReturn(address(usdc));

        bytes32 _approved = keccak256(abi.encode("the release voted through", _path));
        _vote(_path, address(hub), abi.encodeCall(RouterProxy.upgrade, (_hubWithRelease(_approved))));
        assertEq(hub.websiteRelease(), _approved, "and a vote names a release by swapping the hub");
    }

    function test_the_alias_path_runs_a_batch_only_for_the_governors_alias() public {
        uint _now = vm.getBlockTimestamp();
        address _probe = address(new RouterProxy(address(governorAccount)));
        address _forgedImpl = address(new MockTarget());
        IAccount.Call[] memory _forge = _batch(_probe, 0, abi.encodeCall(RouterProxy.upgrade, (_forgedImpl)));
        address[5] memory _refused = [stranger, owner, governor, _aliased(stranger), FX_CHILD];
        for (uint _k; _k < _refused.length; ++_k) {
            vm.prank(_refused[_k]);
            vm.expectRevert(_forbidden(_refused[_k]));
            governorAccount.execute(_now, _forge);
        }
        vm.expectRevert(_callFailed(_forbidden(address(governorAccount))));
        _relay(
            Path.Alias,
            governor,
            0,
            _now,
            _batch(address(governorAccount), 0, abi.encodeCall(GovernorAccount.execute, (_now, _forge)))
        );
        assertEq(_implementationOf(_probe), address(0), "no refused caller moves anything, the account itself included");

        vm.prank(_aliased(governor));
        governorAccount.execute(_now, _forge);
        assertEq(
            _implementationOf(_probe),
            _forgedImpl,
            "the governor's alias does, as an OptimismPortal deposit or a retryable arrives"
        );

        address _top = address(type(uint160).max);
        GovernorAccount _wrapping = new GovernorAccount(_top);
        address _wrappedProbe = address(new RouterProxy(address(_wrapping)));
        address _wrappedImpl = address(new MockTarget());
        vm.prank(_aliased(_top));
        _wrapping.execute(_now, _batch(_wrappedProbe, 0, abi.encodeCall(RouterProxy.upgrade, (_wrappedImpl))));
        assertEq(
            _implementationOf(_wrappedProbe),
            _wrappedImpl,
            "a governor whose alias wraps past the top of the address space still speaks"
        );
    }

    function test_the_op_messenger_is_refused_even_when_it_relays_for_the_governor() public {
        vm.etch(OP_MESSENGER, address(new MockMessenger()).code);
        address _probe = address(new RouterProxy(address(governorAccount)));
        bytes memory _message = abi.encodeCall(
            GovernorAccount.execute,
            (vm.getBlockTimestamp(), _batch(_probe, 0, abi.encodeCall(RouterProxy.upgrade, (address(new MockTarget())))))
        );
        vm.expectRevert(_forbidden(OP_MESSENGER));
        MockMessenger(OP_MESSENGER).relayMessage(governor, address(governorAccount), _message);
        assertEq(
            _implementationOf(_probe), address(0), "OP reaches the account only through OptimismPortal deposits from the alias"
        );
    }

    function test_the_fx_child_path_runs_a_batch_only_from_the_pinned_fx_child_for_the_governor() public {
        vm.etch(FX_CHILD, FX_CHILD_CODE);
        uint _now = vm.getBlockTimestamp();
        address _probe = address(new RouterProxy(address(governorAccount)));
        address _syncedImpl = address(new MockTarget());
        bytes memory _message = abi.encode(_now, _batch(_probe, 0, abi.encodeCall(RouterProxy.upgrade, (_syncedImpl))));

        address[4] memory _refused = [stranger, governor, _aliased(governor), STATE_RECEIVER];
        for (uint _k; _k < _refused.length; ++_k) {
            vm.prank(_refused[_k]);
            vm.expectRevert(_forbidden(_refused[_k]));
            governorAccount.processMessageFromRoot(1, governor, _message);
        }
        vm.prank(STATE_RECEIVER);
        vm.expectRevert(_forbidden(FX_CHILD));
        IStateReceiver(FX_CHILD).onStateReceive(1, abi.encode(stranger, address(governorAccount), _message));

        bytes memory _lookalike = FX_CHILD_CODE;
        _lookalike[_lookalike.length - 1] ^= bytes1(0x01);
        vm.etch(FX_CHILD, _lookalike);
        vm.prank(STATE_RECEIVER);
        vm.expectRevert(_forbidden(FX_CHILD));
        IStateReceiver(FX_CHILD).onStateReceive(1, abi.encode(governor, address(governorAccount), _message));

        vm.etch(FX_CHILD, FX_CHILD_CODE);
        vm.expectRevert(_callFailed(_forbidden(address(governorAccount))));
        _relay(
            Path.FxChild,
            governor,
            0,
            _now,
            _batch(
                address(governorAccount),
                0,
                abi.encodeCall(GovernorAccount.processMessageFromRoot, (1, governor, _message))
            )
        );
        assertEq(_implementationOf(_probe), address(0), "no refused message moves anything, the account's own included");

        vm.prank(STATE_RECEIVER);
        IStateReceiver(FX_CHILD).onStateReceive(1, abi.encode(governor, address(governorAccount), _message));
        assertEq(_implementationOf(_probe), _syncedImpl, "the pinned FxChild syncing the governor's message lands it");
    }

    function test_the_alias_path_lands_a_batch_at_its_deadline_and_refuses_it_a_second_later() public {
        _landsUntilItsDeadline(Path.Alias);
    }

    function test_the_fx_child_path_lands_a_batch_at_its_deadline_and_refuses_it_a_second_later() public {
        _landsUntilItsDeadline(Path.FxChild);
    }

    function _landsUntilItsDeadline(
        Path _path
    ) internal {
        vm.etch(FX_CHILD, FX_CHILD_CODE);
        address _payee = makeAddr("payee");
        vm.deal(address(governorAccount), 2 ether);
        uint _deadline = vm.getBlockTimestamp() + 1 days;
        IAccount.Call[] memory _pay = _batch(_payee, 1 ether, "");

        vm.warp(_deadline);
        _relay(_path, governor, 0, _deadline, _pay);
        assertEq(_payee.balance, 1 ether, "a batch relayed at its deadline lands");

        vm.warp(_deadline + 1);
        vm.expectCall(_payee, 1 ether, "", 0);
        vm.expectRevert(
            abi.encodeWithSelector(Error.GovernorAccount__ExpiredDeadline.selector, _deadline, _deadline + 1)
        );
        _relay(_path, governor, 0, _deadline, _pay);
        assertEq(_payee.balance, 1 ether, "the same batch a second after its deadline is refused before it pays again");
        assertEq(address(governorAccount).balance, 1 ether, "so the account keeps what it would have paid");
    }

    function test_a_batch_lands_whole_or_not_at_all_on_either_path() public {
        vm.etch(FX_CHILD, FX_CHILD_CODE);
        Path[2] memory _paths = [Path.Alias, Path.FxChild];
        address _codeless = makeAddr("codeless");
        for (uint _p; _p < _paths.length; ++_p) {
            bytes32 _before = hub.websiteRelease();
            bytes32 _release = keccak256(abi.encode("a release voted beside a broken gate", _p));
            IAccount.Call[] memory _pair = new IAccount.Call[](2);
            _pair[0] = IAccount.Call({
                target: address(hub),
                value: 0,
                gasLimit: 0,
                callData: abi.encodeCall(RouterProxy.upgrade, (_hubWithRelease(_release)))
            });
            _pair[1] = IAccount.Call({
                target: address(spoke), value: 0, gasLimit: 0, callData: abi.encodeCall(RouterProxy.upgrade, (_codeless))
            });
            vm.expectRevert(
                _callFailed(abi.encodeWithSelector(ERC1967Utils.ERC1967InvalidImplementation.selector, _codeless))
            );
            _relay(_paths[_p], governor, 0, vm.getBlockTimestamp(), _pair);
            assertEq(hub.websiteRelease(), _before, "a failing second call leaves the first unapplied");

            _pair[1].callData = abi.encodeCall(RouterProxy.upgrade, (address(new MockTarget())));
            _relay(_paths[_p], governor, 0, vm.getBlockTimestamp(), _pair);
            assertEq(hub.websiteRelease(), _release, "while a batch whose every call succeeds lands whole");
        }
    }

    function test_a_batch_pays_ether_from_the_accounts_balance_or_the_value_it_carries() public {
        vm.etch(FX_CHILD, FX_CHILD_CODE);
        uint _now = vm.getBlockTimestamp();
        address _payee = makeAddr("payee");
        address _other = makeAddr("other-payee");
        vm.deal(address(this), 2 ether);
        (bool _ok,) = address(governorAccount).call{value: 2 ether}("");
        assertTrue(_ok, "the account takes plain ETH");

        _relay(Path.Alias, governor, 0, _now, _batch(_payee, 1 ether, ""));
        assertEq(_payee.balance, 1 ether, "a call pays its value from the account's own balance");
        _relay(Path.FxChild, governor, 0, _now, _batch(_payee, 1 ether, ""));
        assertEq(_payee.balance, 2 ether, "on either path");
        assertEq(address(governorAccount).balance, 0, "spending exactly what the calls carried");

        vm.expectRevert(_callFailed(""));
        _relay(Path.FxChild, governor, 0, _now, _batch(_payee, 1 ether, ""));

        IAccount.Call[] memory _split = new IAccount.Call[](2);
        _split[0] = IAccount.Call({target: _payee, value: 2 ether, gasLimit: 0, callData: ""});
        _split[1] = IAccount.Call({target: _other, value: 1 ether, gasLimit: 0, callData: ""});
        _relay(Path.Alias, governor, 3 ether, _now, _split);
        assertEq(_payee.balance, 4 ether, "or from the value the message carries, call by call");
        assertEq(_other.balance, 1 ether, "to each payee");
        assertEq(address(governorAccount).balance, 0, "keeping none of it");

        _wethTo(address(governorAccount), 5 ether);
        _relay(
            Path.FxChild, governor, 0, _now, _batch(address(wnt), 0, abi.encodeCall(IERC20.transfer, (_payee, 5 ether)))
        );
        assertEq(wnt.balanceOf(_payee), 5 ether, "and spends the protocol fees it holds in WNT");
    }

    function test_a_call_runs_on_its_gas_limit_when_set_and_on_the_remaining_gas_when_zero() public {
        vm.etch(FX_CHILD, FX_CHILD_CODE);
        _wethTo(address(governorAccount), 4 ether);
        uint _now = vm.getBlockTimestamp();
        Path[2] memory _paths = [Path.Alias, Path.FxChild];
        for (uint _p; _p < _paths.length; ++_p) {
            address _payee = makeAddr(string.concat("payee-", vm.toString(_p)));
            IAccount.Call[] memory _pay = _batch(address(wnt), 0, abi.encodeCall(IERC20.transfer, (_payee, 1 ether)));
            _pay[0].gasLimit = 5000;
            vm.expectRevert(_callFailed(""));
            _relay(_paths[_p], governor, 0, _now, _pay);
            assertEq(wnt.balanceOf(_payee), 0, "a call capped below what it needs fails the batch");
            _pay[0].gasLimit = 100_000;
            _relay(_paths[_p], governor, 0, _now, _pay);
            assertEq(wnt.balanceOf(_payee), 1 ether, "and lands under a cap it fits");
            _pay[0].gasLimit = 0;
            _relay(_paths[_p], governor, 0, _now, _pay);
            assertEq(wnt.balanceOf(_payee), 2 ether, "while an uncapped call runs on the remaining gas");
        }
    }

    function test_a_failed_retryable_cannot_replay_a_stale_release_after_its_deadline_and_no_messenger_replay_applies()
        public
    {
        vm.etch(_aliased(governor), address(new MockRetryable()).code);
        MockRetryable _retryable = MockRetryable(_aliased(governor));
        uint _start = vm.getBlockTimestamp();
        uint _deadline = _start + 1 days;
        address _oldHub = _hubWithRelease(keccak256("the release voted first"));
        bytes32 _new = keccak256("the release voted next");
        address _newHub = _hubWithRelease(_new);
        bytes memory _voteOld = abi.encodeCall(
            GovernorAccount.execute, (_deadline, _batch(address(hub), 0, abi.encodeCall(RouterProxy.upgrade, (_oldHub))))
        );
        bytes memory _voteNew = abi.encodeCall(
            GovernorAccount.execute, (_deadline, _batch(address(hub), 0, abi.encodeCall(RouterProxy.upgrade, (_newHub))))
        );
        assertFalse(
            _retryable.redeem(1, address(governorAccount), _voteOld, 5_000),
            "the first vote's ticket runs out of gas on its auto-redeem and stays redeemable"
        );
        assertEq(hub.websiteRelease(), WEBSITE_RELEASE, "so its release is not named");

        vm.warp(_start + 6 hours);
        assertTrue(_retryable.redeem(2, address(governorAccount), _voteNew, 5_000_000), "the next vote's ticket lands");
        assertEq(hub.websiteRelease(), _new, "governance moved on to the next release");

        vm.warp(_start + 3 days);
        vm.expectCall(address(hub), abi.encodeCall(RouterProxy.upgrade, (_oldHub)), 0);
        assertFalse(
            _retryable.redeem(1, address(governorAccount), _voteOld, 5_000_000),
            "anyone's redeem of the failed ticket after its deadline fails, gas to spare"
        );
        assertEq(
            hub.websiteRelease(), _new, "refused before reaching the hub, so the release stays where the vote moved it"
        );

        vm.etch(OP_MESSENGER, address(new MockReplayingMessenger()).code);
        MockReplayingMessenger _messenger = MockReplayingMessenger(OP_MESSENGER);
        bytes memory _relayed = abi.encodeCall(
            GovernorAccount.execute,
            (_start + 4 days, _batch(address(hub), 0, abi.encodeCall(RouterProxy.upgrade, (_oldHub))))
        );
        bytes32 _stored = keccak256(abi.encode(uint(4), governor, address(governorAccount), _relayed));
        _messenger.relayMessage(4, governor, address(governorAccount), _relayed);
        assertTrue(_messenger.failedMessages(_stored), "the L2 messenger's relay fails at the account inside its deadline");
        _messenger.relayMessage(4, governor, address(governorAccount), _relayed);
        assertFalse(
            _messenger.successfulMessages(_stored), "and so does each replay, the account never answering the messenger"
        );
        assertEq(hub.websiteRelease(), _new, "so the stored-message replay names nothing");
    }

    function test_the_account_is_immutable_so_a_new_governor_needs_a_new_account() public {
        vm.etch(FX_CHILD, FX_CHILD_CODE);
        address _nextGovernor = makeAddr("next-governor");
        uint _now = vm.getBlockTimestamp();
        address _probe = address(new RouterProxy(address(governorAccount)));
        address _impl = address(new MockTarget());
        IAccount.Call[] memory _upgrade = _batch(_probe, 0, abi.encodeCall(RouterProxy.upgrade, (_impl)));

        vm.expectRevert(_forbidden(_aliased(_nextGovernor)));
        _relay(Path.Alias, _nextGovernor, 0, _now, _upgrade);
        vm.expectRevert(_forbidden(FX_CHILD));
        _relay(Path.FxChild, _nextGovernor, 0, _now, _upgrade);
        assertEq(_implementationOf(_probe), address(0), "another governor never speaks through this account");

        GovernorAccount _nextAccount = new GovernorAccount(_nextGovernor);
        vm.prank(_aliased(_nextGovernor));
        vm.expectRevert(_callFailed(abi.encodeWithSelector(Error.Access__CallerNotAuthority.selector)));
        _nextAccount.execute(_now, _upgrade);
        assertEq(
            _implementationOf(_probe), address(0), "and a new account is no authority over the old one's modules"
        );

        _relay(Path.Alias, governor, 0, _now, _upgrade);
        assertEq(_implementationOf(_probe), _impl, "only the governor this account names moves them");
    }

    function test_plain_eth_reaches_the_governor_account_and_every_router_refuses_it() public {
        vm.deal(address(this), 2 ether);
        (bool _ok,) = address(governorAccount).call{value: 1 ether}("");
        assertTrue(_ok, "the GovernorAccount takes plain ETH");
        assertEq(address(governorAccount).balance, 1 ether, "and holds it");

        address[5] memory _routers =
            [address(depositModule), address(fundModule), address(redeemModule), address(hub), address(spoke)];
        for (uint _k; _k < _routers.length; ++_k) {
            bytes memory _ret;
            (_ok, _ret) = _routers[_k].call{value: 1 ether}("");
            assertFalse(_ok, "every router refuses plain ETH");
            assertEq(_ret.length, 0, "in its implementation, which has no receive");
        }
        assertEq(address(this).balance, 1 ether, "so the ETH stays with its sender");
    }
}
