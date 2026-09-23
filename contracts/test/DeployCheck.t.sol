// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {stdToml} from "forge-std/src/StdToml.sol";

import {Deploy} from "script/deploy/Deploy.s.sol";
import {HubGate} from "src/HubGate.sol";
import {SpokeGate} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Chain as ChainProxy} from "src/core/Chain.sol";
import {Deposit} from "src/core/Deposit.sol";
import {Dictate} from "src/core/Dictate.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {Fund} from "src/core/Fund.sol";
import {FundStore} from "src/core/FundStore.sol";
import {MandateStore} from "src/core/MandateStore.sol";
import {Register} from "src/core/Register.sol";
import {Share} from "src/core/Share.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {Error} from "src/utils/Error.sol";
import {GateConfig} from "src/utils/GateConfig.sol";
import {LiquidityGate} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {IChain} from "src/utils/interfaces/IChain.sol";
import {IWNT} from "src/utils/interfaces/IWNT.sol";

import {HotPathTest} from "./HotPath.t.sol";
import {MockERC20} from "./mock/MockERC20.t.sol";

contract DeployCheckTestScript is Deploy {
    function useConst(
        string calldata _toml
    ) external {
        _const = _toml;
    }

    function plan(
        bool _isHub
    ) external {
        _planAndGate(_isHub);
    }

    function gate(
        bool _isHub
    ) external {
        _universe = _isUniverseMigration(_getVersion());
        _planAndGate(_isHub);
    }

    function planned(
        string calldata _name
    ) external view returns (address) {
        return _plannedAddr[keccak256(bytes(_name))];
    }

    function proxyOf(
        bytes32 _key
    ) external view returns (address) {
        return _proxyAddr(_key);
    }

    function factory() external pure returns (address) {
        return address(FACTORY);
    }

    function records() external pure returns (string memory) {
        return DEPLOYMENTS_PATH;
    }
}

contract DeployCheckTestFactory {
    function safeCreate2(
        bytes32 _salt,
        bytes calldata _initCode
    ) external payable returns (address deployed_) {
        bytes memory _code = _initCode;
        assembly ("memory-safe") {
            deployed_ := create2(callvalue(), add(_code, 0x20), mload(_code), _salt)
        }
        require(deployed_ != address(0), "DeployCheckTestFactory: create2 failed");
    }
}

contract DeployCheckTestArbSys {
    function arbBlockNumber() external pure returns (uint) {
        return 424_242;
    }
}

contract DeployCheckTestAttestor {
    address internal immutable signer;

    constructor(
        address _signer
    ) {
        signer = _signer;
    }

    function isValidSignature(
        bytes32 _digest,
        bytes calldata _signature
    ) external view returns (bytes4) {
        return ECDSA.tryRecoverCalldata(_digest, _signature) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract DeployCheckTestWorld {
    using stdToml for string;

    struct Upgrade {
        address proxy;
        address impl;
    }

    Vm internal constant vm = Vm(address(uint160(uint(keccak256("hevm cheat code")))));
    address internal constant TAMPERED = 0x000000000000000000000000000000000000dEaD;

    DeployCheckTestScript public hubScript;
    DeployCheckTestScript public universePlan;
    DeployCheckTestScript public hubPlan;
    DeployCheckTestScript public spokeScript;
    string public hubRecords;
    string public hubRecordForSpoke;
    string public spokeRecords;
    bytes32 public recordsBeforeRerun;
    bytes32 public recordsAfterRerun;
    bytes32 public recordsAfterWire;
    uint public rerunLogCount;
    bytes public universeRefusal;
    bytes public rootRefusal;
    bytes public storeRefusal;
    mapping(uint run => Upgrade[]) internal upgradeMap;

    function upgrades(
        uint _run
    ) external view returns (Upgrade[] memory) {
        return upgradeMap[_run];
    }

    function build(
        address _governor,
        DeployCheckTestScript[8] calldata _scripts
    ) external {
        string memory _records = _scripts[0].records();
        address _factory = _scripts[0].factory();
        string memory _const = vm.readFile("./const.toml");
        uint _version = _const.readUint(".PROTOCOL.version");
        bytes memory _token = address(new MockERC20("DeployCheck", "DC", 18)).code;
        string[2] memory _chains = ["optimism", "arbitrum"];
        for (uint _c; _c < _chains.length; ++_c) {
            string memory _table = string.concat(".TOKEN_ADDRESS.", _chains[_c]);
            string[] memory _symbols = vm.parseTomlKeys(_const, _table);
            for (uint _i; _i < _symbols.length; ++_i) {
                address _at = _const.readAddress(string.concat(_table, ".", _symbols[_i], ".address"));
                if (_at != NATIVE_TOKEN) vm.etch(_at, _token);
            }
        }
        vm.etch(_factory, address(new DeployCheckTestFactory()).code);
        vm.etch(address(100), address(new DeployCheckTestArbSys()).code);

        vm.chainId(_const.readUint(".CHAIN_META.optimism.id"));
        address _dictate = address(
            uint160(
                uint(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            _factory,
                            bytes32(_version),
                            keccak256(
                                bytes.concat(
                                    vm.getCode("forge-artifacts-prod/Dictate.sol/Dictate.json"), abi.encode(_governor)
                                )
                            )
                        )
                    )
                )
            )
        );
        vm.writeFile(_records, string.concat("[chain.optimism]\n", _line("Dictate", _dictate)));
        vm.recordLogs();
        hubScript = _scripts[0];
        hubScript.deploy();
        _keep(0);
        hubRecords = vm.readFile(_records);
        recordsBeforeRerun = keccak256(bytes(hubRecords));
        _scripts[1].deploy();
        rerunLogCount = vm.getRecordedLogs().length;
        recordsAfterRerun = keccak256(bytes(vm.readFile(_records)));
        _scripts[2].wire();
        _keep(1);
        recordsAfterWire = keccak256(bytes(vm.readFile(_records)));
        universePlan = _scripts[3];
        universePlan.useConst(_variant(_const, "version", _version, _version + 2));
        try universePlan.gate(true) {}
        catch (bytes memory _refusal) {
            universeRefusal = _refusal;
        }
        vm.setEnv("ALLOW_UNIVERSE_MIGRATION", "true");
        universePlan.gate(true);
        vm.setEnv("ALLOW_UNIVERSE_MIGRATION", "false");

        string memory _next = _variant(_const, "version", _version, _version + 1);
        vm.writeFile(_records, "");
        hubPlan = _scripts[4];
        hubPlan.useConst(_next);
        hubPlan.plan(true);
        hubRecordForSpoke = string.concat(
            "[chain.arbitrum]\n",
            _line("Dictate", hubPlan.planned("Dictate")),
            "\n[chain.optimism]\n",
            _line("AccountModule", hubPlan.planned("AccountModule")),
            _line("Chain", hubPlan.planned("Chain")),
            _line("Deposit", hubPlan.proxyOf(bytes32("Deposit"))),
            _line("Dictate", hubPlan.planned("Dictate")),
            _line("EscrowStore", hubPlan.planned("EscrowStore")),
            _line("FundAccount", hubPlan.planned("FundAccount")),
            _line("Register", hubPlan.planned("Register")),
            _line("UserAccount", hubPlan.planned("UserAccount"))
        );

        vm.chainId(_const.readUint(".CHAIN_META.arbitrum.id"));
        vm.writeFile(_records, hubRecordForSpoke);
        uint _delay = _const.readUint(".PROTOCOL.withdrawDelay");
        _scripts[5].useConst(
            _variant(_next, "withdrawDelay", _delay, _delay + _const.readUint(".PROTOCOL.maxIntentTtlSec"))
        );
        try _scripts[5].gate(false) {}
        catch (bytes memory _refusal) {
            rootRefusal = _refusal;
        }
        vm.writeFile(
            _records,
            vm.replace(hubRecordForSpoke, vm.toString(hubPlan.planned("EscrowStore")), vm.toString(TAMPERED))
        );
        _scripts[6].useConst(_next);
        try _scripts[6].gate(false) {}
        catch (bytes memory _refusal) {
            storeRefusal = _refusal;
        }
        vm.writeFile(_records, hubRecordForSpoke);
        vm.getRecordedLogs();
        spokeScript = _scripts[7];
        spokeScript.useConst(_next);
        spokeScript.deploy();
        _keep(2);
        spokeRecords = vm.readFile(_records);
        vm.chainId(_const.readUint(".PROTOCOL.hubChainId"));
    }

    function _keep(
        uint _run
    ) internal {
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        Upgrade[] storage _list = upgradeMap[_run];
        for (uint _i; _i < _logs.length; ++_i) {
            Vm.Log memory _log = _logs[_i];
            if (_log.topics.length != 2 || _log.topics[0] != keccak256("Upgraded(address)")) continue;
            _list.push(Upgrade({proxy: _log.emitter, impl: address(uint160(uint(_log.topics[1])))}));
        }
    }

    function _line(
        string memory _name,
        address _addr
    ) internal pure returns (string memory) {
        return string.concat(_name, " = \"", vm.toString(_addr), "\"\n");
    }

    function _variant(
        string memory _toml,
        string memory _key,
        uint _from,
        uint _to
    ) internal pure returns (string memory variant_) {
        variant_ = vm.replace(
            _toml, string.concat(_key, " = ", vm.toString(_from)), string.concat(_key, " = ", vm.toString(_to))
        );
        require(
            variant_.readUint(string.concat(".PROTOCOL.", _key)) == _to,
            string.concat("DeployCheckTestWorld: const variant missed ", _key)
        );
    }
}

contract DeployCheckTest is HotPathTest {
    using stdToml for string;

    struct Probe {
        string name;
        address target;
        bytes call;
        uint allowed;
        bytes downstream;
        bytes denial;
    }

    uint internal constant DEPLOYER_KEY = 0xDE9107;
    string internal constant CONST = "./const.toml";
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    string internal constant PLAN_REFUSED = "Deploy: plan refused";
    string internal constant UNIVERSE_REFUSED =
        "Deploy: this re-keys every root and store and orphans the live universe; set ALLOW_UNIVERSE_MIGRATION=true";

    DeployCheckTestWorld internal world;
    bytes32 internal originalRecords;

    constructor() {
        vm.setEnv("FOUNDRY_PROFILE", "prod");
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(DEPLOYER_KEY));
        vm.setEnv("GOVERNOR_ADDRESS", vm.toString(vm.addr(DEPLOYER_KEY)));
        vm.setEnv("RELAYER_ADDRESS", vm.toString(feeReceiver));
        vm.setEnv("ALLOW_UNIVERSE_MIGRATION", "false");
        DeployCheckTestScript[8] memory _scripts;
        for (uint _i; _i < _scripts.length; ++_i) {
            _scripts[_i] = new DeployCheckTestScript();
        }
        world = new DeployCheckTestWorld();
        string memory _records = _scripts[0].records();
        string memory _original = vm.readFile(_records);
        originalRecords = keccak256(bytes(_original));
        try world.build(vm.addr(DEPLOYER_KEY), _scripts) {}
        catch (bytes memory _error) {
            vm.writeFile(_records, _original);
            assembly ("memory-safe") {
                revert(add(_error, 0x20), mload(_error))
            }
        }
        vm.writeFile(_records, _original);
    }

    function test_deployments_toml_is_left_as_found() public view {
        assertEq(
            keccak256(bytes(vm.readFile(world.hubScript().records()))),
            originalRecords,
            "every script run writes the records file, and the suite restores it byte for byte"
        );
    }

    function test_hub_constructor_encodings_match_the_const() public view {
        string memory _c = vm.readFile(CONST);
        uint _v = _c.readUint(".PROTOCOL.version");
        DeployCheckTestScript _s = world.hubScript();
        address _dictate = _at(_s, _v, "Dictate", abi.encode(_deployer()));
        address _register = _at(_s, _v, "Register", abi.encode(_dictate));
        address _chain = _at(_s, _v, "Chain", abi.encode(_dictate));
        address _am = _at(
            _s,
            _v,
            "AccountModule",
            abi.encode(
                _dictate,
                IChain(_chain),
                _at(_s, _v, "UserAccount", ""),
                _at(_s, _v, "FundAccount", ""),
                _c.readUint(".PROTOCOL.withdrawDelay")
            )
        );
        address _mandate = _at(_s, _v, "MandateStore", abi.encode(_dictate));
        address _fundStore = _at(_s, _v, "FundStore", abi.encode(_dictate));
        address _escrow = _at(_s, _v, "EscrowStore", abi.encode(_dictate));
        address _fundProxy = Dictate(_dictate).gateOf(bytes32("Fund"));
        address _depositProxy = Dictate(_dictate).gateOf(bytes32("Deposit"));
        address _gateProxy = Dictate(_dictate).gateOf(bytes32("HubGate"));
        address _share = _at(_s, _v, "Share", abi.encode(_fundProxy));
        address _deposit = _at(
            _s,
            _v,
            "Deposit",
            abi.encode(_dictate, AccountModule(_am), Register(_register), IWNT(_token(_c, "optimism", "WETH")))
        );
        address _fund = _at(
            _s,
            _v,
            "Fund",
            abi.encode(
                _dictate,
                AccountModule(_am),
                MandateStore(_mandate),
                FundStore(payable(_fundStore)),
                EscrowStore(payable(_escrow)),
                Register(_register),
                _share
            )
        );
        address _gate = _at(
            _s,
            _v,
            "HubGate",
            abi.encode(
                AccountModule(_am),
                Register(_register),
                Deposit(payable(_depositProxy)),
                MandateStore(_mandate),
                Fund(_fundProxy),
                EscrowStore(payable(_escrow)),
                _config(_c),
                _c.readUint(".PROTOCOL.maxCohortSize"),
                _c.readUint(".PROTOCOL.performanceFee")
            )
        );

        assertEq(_s.proxyOf(bytes32("Deposit")), _depositProxy, "the script's RouterProxy artifact is Dictate's own");
        assertEq(_s.proxyOf(bytes32("Fund")), _fundProxy, "the script's RouterProxy artifact is Dictate's own");
        assertEq(ChainProxy(_chain).implementation(), _create2(_v, "EvmChain", ""), "the hub chain reads EVM blocks");
        assertEq(IChain(_chain).blockNumber(), block.number, "the hub chain resolves through its impl");
        assertEq(_implOf(_depositProxy), _deposit, "the Deposit proxy runs the planned impl");
        assertEq(_implOf(_fundProxy), _fund, "the Fund proxy runs the planned impl");
        assertEq(_implOf(_gateProxy), _gate, "the HubGate proxy runs the planned impl");

        assertEq(Dictate(_dictate).owner(), _deployer(), "Dictate is owned by GOVERNOR_ADDRESS");
        assertEq(Register(_register).authority(), _dictate, "Register answers to Dictate");
        assertEq(ChainProxy(_chain).authority(), _dictate, "Chain answers to Dictate");
        assertEq(AccountModule(_am).authority(), _dictate, "AccountModule answers to Dictate");
        assertEq(MandateStore(_mandate).authority(), _dictate, "MandateStore answers to Dictate");
        assertEq(FundStore(payable(_fundStore)).authority(), _dictate, "FundStore answers to Dictate");
        assertEq(EscrowStore(payable(_escrow)).authority(), _dictate, "EscrowStore answers to Dictate");
        assertEq(Deposit(payable(_depositProxy)).authority(), _dictate, "Deposit answers to Dictate");
        assertEq(Fund(_fundProxy).authority(), _dictate, "Fund answers to Dictate");

        assertEq(address(AccountModule(_am).chain()), _chain, "AccountModule reads blocks through the Chain proxy");
        assertEq(AccountModule(_am).userImpl(), _s.planned("UserAccount"), "AccountModule clones UserAccount");
        assertEq(AccountModule(_am).bodyImpl(), _s.planned("FundAccount"), "bodies delegate to FundAccount");
        assertEq(AccountModule(_am).withdrawDelay(), _c.readUint(".PROTOCOL.withdrawDelay"), "withdrawDelay");
        assertEq(address(Deposit(payable(_depositProxy)).accountModule()), _am, "Deposit records through AccountModule");
        assertEq(address(Fund(_fundProxy).accountModule()), _am, "Fund.accountModule");
        assertEq(address(Fund(_fundProxy).mandateStore()), _mandate, "Fund.mandateStore");
        assertEq(address(Fund(_fundProxy).fundStore()), _fundStore, "Fund.fundStore");
        assertEq(address(Fund(_fundProxy).escrowStore()), _escrow, "Fund.escrowStore");
        assertEq(address(Fund(_fundProxy).registerModule()), _register, "Fund.registerModule");
        assertEq(Fund(_fundProxy).shareImpl(), _share, "Fund clones the planned Share");
        assertEq(Share(_share).issuer(), _fundProxy, "the Share issuer is the Fund proxy, never its impl");

        HubGate _hub = HubGate(_gateProxy);
        assertEq(address(_hub.mandateStore()), _mandate, "HubGate.mandateStore");
        assertEq(address(_hub.fundModule()), _fundProxy, "HubGate calls the Fund proxy");
        assertEq(address(_hub.depositModule()), _depositProxy, "HubGate calls the Deposit proxy");
        assertEq(address(_hub.escrowStore()), _escrow, "HubGate.escrowStore");
        assertEq(_hub.maxCohortSize(), _c.readUint(".PROTOCOL.maxCohortSize"), "maxCohortSize");
        assertEq(_hub.performanceFee(), _c.readUint(".PROTOCOL.performanceFee"), "performanceFee");
        assertEq(abi.encode(_hub.getConfig()), abi.encode(_config(_c)), "the gate config is the const plus RELAYER_ADDRESS");
    }

    function test_spoke_constructor_encodings_match_the_const() public view {
        string memory _c = vm.readFile(CONST);
        uint _v = _c.readUint(".PROTOCOL.version") + 1;
        DeployCheckTestScript _s = world.spokeScript();
        address _dictate = _at(_s, _v, "Dictate", abi.encode(_deployer()));
        address _register = _at(_s, _v, "Register", abi.encode(_dictate));
        address _chain = _at(_s, _v, "Chain", abi.encode(_dictate));
        address _am = _at(
            _s,
            _v,
            "AccountModule",
            abi.encode(
                _dictate,
                IChain(_chain),
                _at(_s, _v, "UserAccount", ""),
                _at(_s, _v, "FundAccount", ""),
                _c.readUint(".PROTOCOL.withdrawDelay")
            )
        );
        address _escrow = _at(_s, _v, "EscrowStore", abi.encode(_dictate));
        address _depositProxy = Dictate(_dictate).gateOf(bytes32("Deposit"));
        address _gateProxy = Dictate(_dictate).gateOf(bytes32("SpokeGate"));
        address _deposit = _at(
            _s,
            _v,
            "Deposit",
            abi.encode(_dictate, AccountModule(_am), Register(_register), IWNT(_token(_c, "arbitrum", "WETH")))
        );
        address _gate = _at(
            _s,
            _v,
            "SpokeGate",
            abi.encode(
                AccountModule(_am),
                Register(_register),
                Deposit(payable(_depositProxy)),
                EscrowStore(payable(_escrow)),
                _config(_c)
            )
        );

        assertEq(ChainProxy(_chain).implementation(), _create2(_v, "ArbitrumChain", ""), "the spoke chain is ArbitrumChain");
        assertEq(
            IChain(_chain).blockNumber(),
            DeployCheckTestArbSys(address(100)).arbBlockNumber(),
            "the spoke chain reads L2 blocks from ArbSys"
        );
        assertTrue(IChain(_chain).blockNumber() != block.number, "and not the L1-derived block.number");
        assertEq(_implOf(_depositProxy), _deposit, "the Deposit proxy runs the planned impl");
        assertEq(_implOf(_gateProxy), _gate, "the SpokeGate proxy runs the planned impl");
        assertEq(Dictate(_dictate).owner(), _deployer(), "Dictate is owned by GOVERNOR_ADDRESS");
        assertEq(address(Deposit(payable(_depositProxy)).accountModule()), _am, "Deposit records through AccountModule");
        assertEq(AccountModule(_am).withdrawDelay(), _c.readUint(".PROTOCOL.withdrawDelay"), "withdrawDelay");
        assertEq(address(SpokeGate(_gateProxy).depositModule()), _depositProxy, "SpokeGate calls the Deposit proxy");
        assertEq(address(SpokeGate(_gateProxy).escrowStore()), _escrow, "SpokeGate.escrowStore");
        assertEq(
            abi.encode(SpokeGate(_gateProxy).getConfig()),
            abi.encode(_config(_c)),
            "the gate config is the const plus RELAYER_ADDRESS"
        );
    }

    function test_spoke_roots_and_stores_sit_at_the_hub_record() public view {
        DeployCheckTestScript _s = world.spokeScript();
        DeployCheckTestScript _h = world.hubPlan();
        string memory _record = world.hubRecordForSpoke();
        string[7] memory _shared =
            ["Dictate", "Register", "Chain", "UserAccount", "FundAccount", "AccountModule", "EscrowStore"];
        for (uint _i; _i < _shared.length; ++_i) {
            address _spokeAt = _s.planned(_shared[_i]);
            assertEq(_spokeAt, _h.planned(_shared[_i]), string.concat(_shared[_i], ": the hub-side plan agrees"));
            assertEq(
                _spokeAt,
                _record.readAddress(string.concat(".chain.optimism.", _shared[_i])),
                string.concat(_shared[_i], ": the spoke sits at the hub record")
            );
            assertGt(_spokeAt.code.length, 0, string.concat(_shared[_i], ": deployed on the spoke"));
        }
        Dictate _dictate = Dictate(_s.planned("Dictate"));
        assertEq(
            _dictate.gateOf(bytes32("Deposit")),
            _record.readAddress(".chain.optimism.Deposit"),
            "the Deposit proxy is one address across chains"
        );
        assertTrue(
            _record.readAddress(".chain.optimism.Deposit") != _s.planned("Deposit"),
            "the record's Deposit is the proxy while the spoke plans an impl, and a logic entry is not compared"
        );
        assertEq(_h.planned("MandateStore").code.length, 0, "a spoke deploys no MandateStore");
        assertEq(_h.planned("FundStore").code.length, 0, "a spoke deploys no FundStore");
        assertEq(_h.planned("Share").code.length, 0, "a spoke deploys no Share");
        assertEq(_dictate.gateOf(bytes32("Fund")).code.length, 0, "a spoke opens no Fund proxy");
        assertEq(_dictate.gateOf(bytes32("HubGate")).code.length, 0, "a spoke opens no HubGate proxy");
    }

    function test_spoke_refuses_a_root_or_store_off_the_hub_record() public view {
        assertEq(
            world.rootRefusal(),
            abi.encodeWithSignature("Error(string)", PLAN_REFUSED),
            "a spoke whose AccountModule (withdrawDelay) leaves the hub record is refused"
        );
        assertEq(
            world.storeRefusal(),
            abi.encodeWithSignature("Error(string)", PLAN_REFUSED),
            "a spoke whose EscrowStore leaves the hub record is refused"
        );
        assertGt(world.spokeScript().planned("SpokeGate").code.length, 0, "the same spoke on the true record deploys");
    }

    function test_universe_rekey_is_refused_without_the_ack() public view {
        assertEq(
            world.universeRefusal(),
            abi.encodeWithSignature("Error(string)", UNIVERSE_REFUSED),
            "a version bump re-keys every root, and plans only with ALLOW_UNIVERSE_MIGRATION"
        );
        assertEq(
            world.universePlan().planned("Dictate"),
            _create2(vm.readFile(CONST).readUint(".PROTOCOL.version") + 2, "Dictate", abi.encode(_deployer())),
            "with the ack the same plan passes and re-keys Dictate at the bumped version"
        );
    }

    function test_hub_wires_exactly_its_auth_edges() public {
        DeployCheckTestScript _s = world.hubScript();
        Dictate _dictate = Dictate(_s.planned("Dictate"));
        GateConfig memory _cfg = _config(vm.readFile(CONST));
        address _usdc = _token(vm.readFile(CONST), "optimism", "USDC");
        address[] memory _callers = new address[](8);
        _callers[0] = _dictate.gateOf(bytes32("HubGate"));
        _callers[1] = _dictate.gateOf(bytes32("Deposit"));
        _callers[2] = _dictate.gateOf(bytes32("Fund"));
        _callers[3] = _s.planned("HubGate");
        _callers[4] = _s.planned("Deposit");
        _callers[5] = _s.planned("Fund");
        _callers[6] = _deployer();
        _callers[7] = makeAddr("stranger");
        bytes memory _denied = abi.encodeWithSelector(Error.Access__Unauthorized.selector);

        _probe(
            _callers,
            Probe({
                name: "AccountModule",
                target: _s.planned("AccountModule"),
                call: abi.encodeCall(AccountModule.record, (address(0xBEEF), bytes32(0), "", new address[](0))),
                allowed: 7,
                downstream: "",
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "Deposit",
                target: _callers[1],
                call: abi.encodeCall(Deposit.deposit, (address(0xBEEF), address(0xBEEF), _usdc, 0, _cfg)),
                allowed: 1,
                downstream: abi.encodeWithSelector(Error.Balance__ZeroAmount.selector),
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "EscrowStore",
                target: _s.planned("EscrowStore"),
                call: abi.encodeCall(EscrowStore.setFulfilled, (address(1), address(2), address(3), 0)),
                allowed: 5,
                downstream: "",
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "MandateStore",
                target: _s.planned("MandateStore"),
                call: abi.encodeCall(MandateStore.setMandate, (address(1), address(2), bytes32(0))),
                allowed: 1,
                downstream: "",
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "FundStore",
                target: _s.planned("FundStore"),
                call: abi.encodeCall(FundStore.setSkin, (address(1), 0)),
                allowed: 5,
                downstream: "",
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "Fund",
                target: _callers[2],
                call: abi.encodeCall(Fund.claim, (address(0xBEEF), Share(address(0xBEEF)), address(0xBEEF), _cfg)),
                allowed: 1,
                downstream: abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, address(0xBEEF)),
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "Share",
                target: _s.planned("Share"),
                call: abi.encodeCall(Share.mint, (address(0xBEEF), 1)),
                allowed: 4,
                downstream: "",
                denial: abi.encodeWithSelector(Error.Share__NotIssuer.selector)
            })
        );
        _probe(
            _callers,
            Probe({
                name: "Register",
                target: _s.planned("Register"),
                call: abi.encodeCall(Register.setRegistered, (_usdc, bytes32("X"))),
                allowed: 0,
                downstream: "",
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "Chain",
                target: _s.planned("Chain"),
                call: abi.encodeCall(ChainProxy.setImplementation, (address(1))),
                allowed: 0,
                downstream: "",
                denial: _denied
            })
        );
    }

    function test_spoke_wires_exactly_its_auth_edges() public {
        DeployCheckTestScript _s = world.spokeScript();
        Dictate _dictate = Dictate(_s.planned("Dictate"));
        address _usdc = _token(vm.readFile(CONST), "arbitrum", "USDC");
        address[] memory _callers = new address[](6);
        _callers[0] = _dictate.gateOf(bytes32("SpokeGate"));
        _callers[1] = _dictate.gateOf(bytes32("Deposit"));
        _callers[2] = _s.planned("SpokeGate");
        _callers[3] = _s.planned("Deposit");
        _callers[4] = _deployer();
        _callers[5] = makeAddr("stranger");
        bytes memory _denied = abi.encodeWithSelector(Error.Access__Unauthorized.selector);

        _probe(
            _callers,
            Probe({
                name: "AccountModule",
                target: _s.planned("AccountModule"),
                call: abi.encodeCall(AccountModule.record, (address(0xBEEF), bytes32(0), "", new address[](0))),
                allowed: 3,
                downstream: "",
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "Deposit",
                target: _callers[1],
                call: abi.encodeCall(
                    Deposit.deposit, (address(0xBEEF), address(0xBEEF), _usdc, 0, _config(vm.readFile(CONST)))
                ),
                allowed: 1,
                downstream: abi.encodeWithSelector(Error.Balance__ZeroAmount.selector),
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "EscrowStore",
                target: _s.planned("EscrowStore"),
                call: abi.encodeCall(EscrowStore.setFulfilled, (address(1), address(2), address(3), 0)),
                allowed: 1,
                downstream: "",
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "Register",
                target: _s.planned("Register"),
                call: abi.encodeCall(Register.setRegistered, (_usdc, bytes32("X"))),
                allowed: 0,
                downstream: "",
                denial: _denied
            })
        );
        _probe(
            _callers,
            Probe({
                name: "Chain",
                target: _s.planned("Chain"),
                call: abi.encodeCall(ChainProxy.setImplementation, (address(1))),
                allowed: 0,
                downstream: "",
                denial: _denied
            })
        );
    }

    function test_pay_owed_reaches_the_fund_store_through_the_hub_proxy() public {
        _bindScriptHub();
        address _holder = _account(backer);
        vm.prank(address(fundModule));
        fundStore.setOwed(_holder, address(usdc), 7e6);
        usdc.mint(address(fundStore), 7e6);

        hub.payOwed(_holder, address(usdc));
        assertEq(usdc.balanceOf(_holder), 7e6, "the debt is paid to its account");
        assertEq(usdc.balanceOf(address(fundStore)), 0, "out of the FundStore");
        assertEq(fundStore.owedMap(_holder, address(usdc)), 0, "and cleared");

        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _holder));
        hub.payOwed(_holder, address(usdc));
    }

    function test_set_gate_runs_once_per_proxy_per_run() public view {
        uint _v = vm.readFile(CONST).readUint(".PROTOCOL.version");
        DeployCheckTestScript _h = world.hubScript();
        Dictate _hd = Dictate(_h.planned("Dictate"));
        DeployCheckTestWorld.Upgrade[] memory _deploy = world.upgrades(0);
        assertEq(_deploy.length, 4, "a fresh hub run upgrades four proxies");
        _upgrade(_deploy[0], _h.planned("Chain"), _create2(_v, "EvmChain", ""));
        _upgrade(_deploy[1], _hd.gateOf(bytes32("Deposit")), _h.planned("Deposit"));
        _upgrade(_deploy[2], _hd.gateOf(bytes32("HubGate")), _h.planned("HubGate"));
        _upgrade(_deploy[3], _hd.gateOf(bytes32("Fund")), _h.planned("Fund"));

        assertEq(world.rerunLogCount(), 0, "an all-keep deploy() emits nothing and upgrades nothing");

        DeployCheckTestWorld.Upgrade[] memory _wire = world.upgrades(1);
        assertEq(_wire.length, 3, "wire() upgrades each router once and leaves the locked Chain alone");
        _upgrade(_wire[0], _hd.gateOf(bytes32("Deposit")), _h.planned("Deposit"));
        _upgrade(_wire[1], _hd.gateOf(bytes32("HubGate")), _h.planned("HubGate"));
        _upgrade(_wire[2], _hd.gateOf(bytes32("Fund")), _h.planned("Fund"));

        DeployCheckTestScript _s = world.spokeScript();
        Dictate _sd = Dictate(_s.planned("Dictate"));
        DeployCheckTestWorld.Upgrade[] memory _spoke = world.upgrades(2);
        assertEq(_spoke.length, 3, "a fresh spoke run upgrades three proxies");
        _upgrade(_spoke[0], _s.planned("Chain"), _create2(_v + 1, "ArbitrumChain", ""));
        _upgrade(_spoke[1], _sd.gateOf(bytes32("Deposit")), _s.planned("Deposit"));
        _upgrade(_spoke[2], _sd.gateOf(bytes32("SpokeGate")), _s.planned("SpokeGate"));
    }

    function test_rerun_and_wire_leave_the_records_as_written() public view {
        assertEq(world.recordsAfterRerun(), world.recordsBeforeRerun(), "an all-keep deploy() writes no record");
        assertEq(world.recordsAfterWire(), world.recordsBeforeRerun(), "wire() re-asserts the records it finds");
    }

    function test_hub_records_name_each_proxy_and_its_impl() public view {
        DeployCheckTestScript _h = world.hubScript();
        Dictate _hd = Dictate(_h.planned("Dictate"));
        string memory _hub = world.hubRecords();
        assertEq(vm.parseTomlKeys(_hub, ".chain.optimism").length, 17, "the hub records seventeen names");
        string[10] memory _plain = [
            "Dictate",
            "Register",
            "Chain",
            "UserAccount",
            "FundAccount",
            "AccountModule",
            "MandateStore",
            "FundStore",
            "EscrowStore",
            "Share"
        ];
        for (uint _i; _i < _plain.length; ++_i) {
            assertEq(_hub.readAddress(string.concat(".chain.optimism.", _plain[_i])), _h.planned(_plain[_i]), _plain[_i]);
        }
        assertEq(
            _hub.readAddress(".chain.optimism.ChainImpl"),
            _create2(vm.readFile(CONST).readUint(".PROTOCOL.version"), "EvmChain", ""),
            "ChainImpl"
        );
        string[3] memory _routers = ["Deposit", "Fund", "HubGate"];
        for (uint _i; _i < _routers.length; ++_i) {
            assertEq(
                _hub.readAddress(string.concat(".chain.optimism.", _routers[_i])),
                _hd.gateOf(bytes32(bytes(_routers[_i]))),
                string.concat(_routers[_i], " records the proxy")
            );
            assertEq(
                _hub.readAddress(string.concat(".chain.optimism.", _routers[_i], "Impl")),
                _h.planned(_routers[_i]),
                string.concat(_routers[_i], "Impl records the impl")
            );
        }
    }

    function test_spoke_records_name_each_proxy_and_its_impl() public view {
        DeployCheckTestScript _s = world.spokeScript();
        Dictate _sd = Dictate(_s.planned("Dictate"));
        string memory _spoke = world.spokeRecords();
        assertEq(vm.parseTomlKeys(_spoke, ".chain.arbitrum").length, 12, "the spoke records twelve names");
        string memory _hubRecord = world.hubRecordForSpoke();
        string[] memory _hubKeys = vm.parseTomlKeys(_hubRecord, ".chain.optimism");
        assertEq(
            keccak256(abi.encode(vm.parseTomlKeys(_spoke, ".chain.optimism"))),
            keccak256(abi.encode(_hubKeys)),
            "a spoke run adds no name to the hub's record"
        );
        for (uint _i; _i < _hubKeys.length; ++_i) {
            string memory _key = string.concat(".chain.optimism.", _hubKeys[_i]);
            assertEq(
                _spoke.readAddress(_key),
                _hubRecord.readAddress(_key),
                string.concat(_hubKeys[_i], ": a spoke run never rewrites the hub's record")
            );
        }
        string[7] memory _plain =
            ["Dictate", "Register", "Chain", "UserAccount", "FundAccount", "AccountModule", "EscrowStore"];
        for (uint _i; _i < _plain.length; ++_i) {
            assertEq(_spoke.readAddress(string.concat(".chain.arbitrum.", _plain[_i])), _s.planned(_plain[_i]), _plain[_i]);
        }
        assertEq(
            _spoke.readAddress(".chain.arbitrum.ChainImpl"),
            _create2(vm.readFile(CONST).readUint(".PROTOCOL.version") + 1, "ArbitrumChain", ""),
            "ChainImpl"
        );
        string[2] memory _routers = ["Deposit", "SpokeGate"];
        for (uint _i; _i < _routers.length; ++_i) {
            assertEq(
                _spoke.readAddress(string.concat(".chain.arbitrum.", _routers[_i])),
                _sd.gateOf(bytes32(bytes(_routers[_i]))),
                string.concat(_routers[_i], " records the proxy")
            );
            assertEq(
                _spoke.readAddress(string.concat(".chain.arbitrum.", _routers[_i], "Impl")),
                _s.planned(_routers[_i]),
                string.concat(_routers[_i], "Impl records the impl")
            );
        }
    }

    function test_every_toml_token_is_registered_under_its_symbol() public view {
        string memory _c = vm.readFile(CONST);
        string[2] memory _chains = ["optimism", "arbitrum"];
        Register[2] memory _registers =
            [Register(world.hubScript().planned("Register")), Register(world.spokeScript().planned("Register"))];
        for (uint _k; _k < _chains.length; ++_k) {
            string memory _table = string.concat(".TOKEN_ADDRESS.", _chains[_k]);
            string[] memory _symbols = vm.parseTomlKeys(_c, _table);
            assertGt(_symbols.length, 0, "the toml lists tokens");
            for (uint _i; _i < _symbols.length; ++_i) {
                string memory _key = string.concat(_table, ".", _symbols[_i]);
                assertEq(
                    _registers[_k].tokenIdMap(_c.readAddress(string.concat(_key, ".address"))),
                    _c.readUint(string.concat(_key, ".cap")) == 0 ? bytes32(0) : bytes32(bytes(_symbols[_i])),
                    string.concat(_chains[_k], " ", _symbols[_i])
                );
            }
        }
    }

    function test_a_toml_cap_of_zero_deregisters_and_a_nonzero_cap_restores() public {
        string memory _c = vm.readFile(CONST);
        DeployCheckTestScript _s = world.hubScript();
        Register _register = Register(_s.planned("Register"));

        _s.useConst(_tokenConst(_c, "USDT"));
        _s.registerTokens();
        _registry(_register, _c, "USDT", "a toml cap of 0 deregisters a live token and leaves the others registered");

        _s.useConst(_tokenConst(_c, ""));
        _s.registerTokens();
        _registry(_register, _c, "", "a nonzero cap registers it again under its symbol");

        _s.useConst(_tokenConst(_c, "WETH"));
        _s.setRegistered("WETH");
        _registry(_register, _c, "WETH", "setRegistered with a cap of 0 deregisters it and touches no other token");

        vm.prank(_deployer());
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _register.setRegistered(_token(_c, "optimism", "USDT"), bytes32("X"));
    }

    function _registry(
        Register _register,
        string memory _c,
        string memory _zeroed,
        string memory _label
    ) internal view {
        string[] memory _symbols = vm.parseTomlKeys(_c, ".TOKEN_ADDRESS.optimism");
        for (uint _i; _i < _symbols.length; ++_i) {
            assertEq(
                _register.tokenIdMap(_token(_c, "optimism", _symbols[_i])),
                keccak256(bytes(_symbols[_i])) == keccak256(bytes(_zeroed)) ? bytes32(0) : bytes32(bytes(_symbols[_i])),
                string.concat(_symbols[_i], ": ", _label)
            );
        }
    }

    function test_full_fund_lifecycle_on_the_script_built_hub() public {
        _bindScriptHub();
        _fundWallet(master, 2000e6);
        address _masterAcct = _account(master);
        assertEq(usdc.balanceOf(_masterAcct), 2000e6, "the deposit lands in the master's account");

        bytes32 _symbol = bytes32("DEPLOYED");
        bytes memory _pixels = new bytes(154);
        share = Share(
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
                                        fundModule.shareImpl(),
                                        abi.encodePacked(_symbol, _pixels, uint16(hub.performanceFee()))
                                    )
                                )
                            )
                        )
                    )
                )
            )
        );

        _escrow(LiquidityGate(address(hub)), address(usdc), 500e6);
        assertEq(escrowStore.escrowedMap(_masterAcct, body, address(usdc)), 500e6, "the escrow ledger holds the stake");
        assertEq(usdc.balanceOf(address(escrowStore)), 500e6, "and the store holds the tokens");
        assertEq(usdc.balanceOf(feeReceiver), FEE, "the relay fee reaches RELAYER_ADDRESS");

        _openFund(_symbol, _pixels, _masterAcct);
        assertEq(share.symbol(), "DEPLOYED", "the share carries the fund symbol");
        assertEq(share.balanceOf(body), 499e18, "the opening round mints (500 - 1 fee) USD of units at par");
        assertEq(usdc.balanceOf(body), 500e6 - FEE, "the escrow lands in the body net of the fee");
        assertEq(usdc.balanceOf(feeReceiver), 2 * FEE, "the opening fee reaches RELAYER_ADDRESS");
        assertEq(escrowStore.fulfilledMap(_masterAcct, body, address(usdc)), 500e6, "the credit is fulfilled");

        uint _units = _backRound();
        assertEq(usdc.balanceOf(body), 500e6 - FEE + 400e6 - FEE, "the stake lands in the body net of the round fee");
        assertEq(usdc.balanceOf(_account(backer)), 1000e6 - FEE - 400e6, "the stake leaves the backer");
        assertEq(usdc.balanceOf(feeReceiver), 4 * FEE, "mandate and round fees reach RELAYER_ADDRESS");

        _sell(backer, backerKey, _units);
        assertEq(share.balanceOf(address(fundStore)), _units, "sold units wait in the queue");
        assertEq(usdc.balanceOf(feeReceiver), 5 * FEE, "the sell fee reaches RELAYER_ADDRESS");

        _drainAndClaim(_units, _masterAcct);
    }

    function _openFund(
        bytes32 _symbol,
        bytes memory _pixels,
        address _masterAcct
    ) internal {
        (Fund.AllocateIntent memory _open, bytes memory _openSig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _masterAcct);
        bytes32 _openDigest = _allocateDigest(_open);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.createFund(
            _symbol,
            _pixels,
            _coSig(bodyKey, _genesis),
            _coSig(masterKey, _genesis),
            _open,
            bytes.concat(_coSig(masterKey, _openDigest), _coSig(masterKey, _openDigest))
        );
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _open, _openSig);
    }

    function _backRound() internal returns (uint units_) {
        _fundWallet(backer, 1000e6);
        address _backerAcct = _account(backer);
        AccountLib.Mandate memory _m = AccountLib.Mandate({
            master: body, skin: 0, allocationRate: 5000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
        AccountLib.Mandate[] memory _one = new AccountLib.Mandate[](1);
        _one[0] = _m;
        _mandate(backer, backerKey, _one);
        assertEq(mandateStore.mandateMap(_backerAcct, body), this.digestOf(_backerAcct, _m), "the mandate is stored");
        assertEq(
            IERC20(address(usdc)).allowance(_backerAcct, address(fundModule)),
            type(uint).max,
            "arming approves the Fund proxy"
        );

        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = Fund.Allocation({puppet: _backerAcct, mandate: _m, amount: 400e6});
        uint _supply = share.totalSupply() + 1e12;
        uint _nav = usdc.balanceOf(body) * USD + 1e24;
        (Fund.AllocateIntent memory _round, bytes memory _roundSig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        hub.allocate(_round, _roundSig);
        units_ = Math.mulDiv(400e6 * USD - FEE * USD, _supply, _nav);
        assertEq(share.balanceOf(_backerAcct), units_, "the backer is minted (value - slice) at the signed NAV");
    }

    function _drainAndClaim(
        uint _units,
        address _masterAcct
    ) internal {
        address _backerAcct = _account(backer);
        uint _bodyBefore = usdc.balanceOf(body);
        uint _cashValue = Math.mulDiv(_units, _bodyBefore * USD + 1e24, share.totalSupply() + 1e12);
        uint _feeValue = Math.min(FEE * USD, _cashValue * hub.getConfig().maxRelayFeeBps / 10_000);
        uint _billed = Math.mulDiv(_feeValue, 1e6, 1e6 * USD, Math.Rounding.Ceil);
        uint _net = Math.mulDiv(_cashValue, 1e6, 1e6 * USD) - _billed;
        _redeem(0, _units);
        assertEq(usdc.balanceOf(address(fundStore)), _net, "the drain parks the net cash in the FundStore");
        assertEq(usdc.balanceOf(body), _bodyBefore - _net - _billed, "and takes exactly net plus fee from the body");
        assertEq(usdc.balanceOf(feeReceiver), 5 * FEE + _billed, "the drain fee reaches RELAYER_ADDRESS");
        assertEq(share.totalSupply(), 499e18, "the drained units are burned");

        uint _paid = Math.mulDiv(_units, Math.mulDiv(_net, 1e48, _units), 1e48);
        uint _backerBefore = usdc.balanceOf(_backerAcct);
        hub.claim(body, share, _backerAcct);
        assertEq(usdc.balanceOf(_backerAcct), _backerBefore + _paid, "the backer collects its accrued cash");
        assertEq(usdc.balanceOf(address(fundStore)), _net - _paid, "out of the FundStore");
        assertEq(usdc.balanceOf(_masterAcct), 2000e6 - 500e6 - FEE, "a losing exit pays the owner no performance fee");

        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _backerAcct));
        hub.claim(body, share, _backerAcct);
    }

    function _bindScriptHub() internal {
        DeployCheckTestScript _s = world.hubScript();
        dictate = Dictate(_s.planned("Dictate"));
        register = Register(_s.planned("Register"));
        accountModule = AccountModule(_s.planned("AccountModule"));
        mandateStore = MandateStore(_s.planned("MandateStore"));
        fundStore = FundStore(payable(_s.planned("FundStore")));
        escrowStore = EscrowStore(payable(_s.planned("EscrowStore")));
        depositModule = Deposit(payable(dictate.gateOf(bytes32("Deposit"))));
        fundModule = Fund(dictate.gateOf(bytes32("Fund")));
        hub = HubGate(dictate.gateOf(bytes32("HubGate")));
        string memory _c = vm.readFile(CONST);
        usdc = MockERC20(_token(_c, "optimism", "USDC"));
        vm.etch(_c.readAddress(".PROTOCOL.attestor"), address(new DeployCheckTestAttestor(attestor)).code);
        vm.signAndAttachDelegation(accountModule.bodyImpl(), bodyKey);
        bytes32 _bodyHash = accountModule.bodyHash();
        assertEq(body.codehash, _bodyHash, "the body delegates to the script's FundAccount");
    }

    function _probe(
        address[] memory _callers,
        Probe memory _p
    ) internal {
        for (uint _i; _i < _callers.length; ++_i) {
            vm.prank(_callers[_i]);
            (bool _ok, bytes memory _ret) = _p.target.call(_p.call);
            string memory _label = string.concat(_p.name, " <- caller ", vm.toString(_i));
            if ((_p.allowed >> _i) & 1 == 0) {
                assertFalse(_ok, _label);
                assertEq(_ret, _p.denial, _label);
            } else if (_p.downstream.length == 0) {
                assertTrue(_ok, _label);
            } else {
                assertFalse(_ok, _label);
                assertEq(_ret, _p.downstream, _label);
            }
        }
    }

    function _tokenConst(
        string memory _c,
        string memory _zeroed
    ) internal pure returns (string memory toml_) {
        toml_ = string.concat(
            "[PROTOCOL]\nattestor = \"",
            vm.toString(_c.readAddress(".PROTOCOL.attestor")),
            "\"\n\n[CHAIN_META.optimism]\nid = ",
            vm.toString(_c.readUint(".CHAIN_META.optimism.id")),
            "\n\n[TOKEN_ADDRESS.optimism]\n"
        );
        string[] memory _symbols = vm.parseTomlKeys(_c, ".TOKEN_ADDRESS.optimism");
        for (uint _i; _i < _symbols.length; ++_i) {
            string memory _key = string.concat(".TOKEN_ADDRESS.optimism.", _symbols[_i]);
            uint _cap = keccak256(bytes(_symbols[_i])) == keccak256(bytes(_zeroed))
                ? 0
                : _c.readUint(string.concat(_key, ".cap"));
            toml_ = string.concat(
                toml_,
                _symbols[_i],
                " = { address = \"",
                vm.toString(_c.readAddress(string.concat(_key, ".address"))),
                "\", cap = \"",
                vm.toString(_cap),
                "\" }\n"
            );
        }
    }

    function _upgrade(
        DeployCheckTestWorld.Upgrade memory _u,
        address _proxy,
        address _impl
    ) internal pure {
        assertEq(_u.proxy, _proxy, "the upgraded proxy");
        assertEq(_u.impl, _impl, "the impl it was pointed at");
    }

    function _config(
        string memory _c
    ) internal view returns (GateConfig memory) {
        return GateConfig({
            attestor: _c.readAddress(".PROTOCOL.attestor"),
            feeReceiver: feeReceiver,
            transferGasLimit: _c.readUint(".PROTOCOL.transferGasLimit"),
            maxIntentTtl: _c.readUint(".PROTOCOL.maxIntentTtlSec"),
            maxRelayFeeBps: _c.readUint(".PROTOCOL.maxRelayFeeBps")
        });
    }

    function _at(
        DeployCheckTestScript _s,
        uint _version,
        string memory _name,
        bytes memory _args
    ) internal view returns (address at_) {
        at_ = _create2(_version, _name, _args);
        assertEq(_s.planned(_name), at_, string.concat(_name, ": the script encodes its constructor"));
        assertGt(at_.code.length, 0, string.concat(_name, ": deployed"));
    }

    function _create2(
        uint _version,
        string memory _artifact,
        bytes memory _args
    ) internal view returns (address) {
        return address(
            uint160(
                uint(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            world.hubScript().factory(),
                            bytes32(_version),
                            keccak256(
                                bytes.concat(
                                    vm.getCode(string.concat("forge-artifacts-prod/", _artifact, ".sol/", _artifact, ".json")),
                                    _args
                                )
                            )
                        )
                    )
                )
            )
        );
    }

    function _implOf(
        address _proxy
    ) internal view returns (address) {
        return address(uint160(uint(vm.load(_proxy, IMPL_SLOT))));
    }

    function _token(
        string memory _c,
        string memory _chain,
        string memory _symbol
    ) internal pure returns (address) {
        return _c.readAddress(string.concat(".TOKEN_ADDRESS.", _chain, ".", _symbol, ".address"));
    }

    function _deployer() internal pure returns (address) {
        return vm.addr(DEPLOYER_KEY);
    }
}
