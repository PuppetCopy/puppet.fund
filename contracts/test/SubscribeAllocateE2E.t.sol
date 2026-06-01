// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Test} from "forge-std/src/Test.sol";
import {grantGate} from "./util/grantGate.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AccountModule, CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH} from "src/core/module/AccountModule.sol";
import {AccountLib, ACCOUNT_TYPEHASH} from "src/core/AccountLib.sol";
import {Attest} from "src/core/Attest.sol";
import {TransientRoute} from "src/core/TransientRoute.sol";
import {IAccount} from "src/core/interface/IAccount.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {MasterAccount} from "src/core/MasterAccount.sol";

import {Dictate} from "src/core/Dictate.sol";
import {RegisterModule} from "src/core/module/RegisterModule.sol";

import {WalletDepositModule} from "src/core/module/WalletDepositModule.sol";
import {SpokeGate} from "src/spoke/SpokeGate.sol";
import {ACROSS_SPOKE_POOL_ARBITRUM} from "./shared/Across.t.sol";
import {AllocateModule, ALLOCATE_INTENT_TYPEHASH} from "src/hub/module/AllocateModule.sol";
import {AllocateStore} from "src/hub/AllocateStore.sol";
import {RedeemModule} from "src/hub/module/RedeemModule.sol";
import {RedeemStore} from "src/hub/RedeemStore.sol";
import {RuleLib} from "src/hub/RuleLib.sol";
import {ShareModule} from "src/hub/ShareModule.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {SubscribeModule, SUBSCRIBE_INTENT_TYPEHASH} from "src/hub/module/SubscribeModule.sol";

import {HubGate} from "src/hub/HubGate.sol";
import {Error} from "src/utils/Error.sol";

import {MockERC20} from "./mock/MockERC20.t.sol";

uint constant HUB_CHAIN_ID = 42_161;
uint constant TRANSFER_GAS_LIMIT = 200_000;
bytes32 constant USDC_ID = keccak256("USDC");

contract SubscribeModuleAllocateModuleE2ETest is Test {
    address owner = makeAddr("Owner");
    address feeReceiver = makeAddr("FeeReceiver");

    address attestor;
    uint attestorKey;
    address userM;
    uint keyM;
    address userA;
    uint keyA;
    address userB;
    uint keyB;
    address userC;
    uint keyC;

    MockERC20 usdc;
    Dictate dictate;
    AccountModule accountGate;
    ShareModule shareGate;
    RegisterModule register;
    SubscribeModule subscribe;
    AllocateModule allocate;
    AllocateStore allocateStore;
    RedeemModule redeem;
    RedeemStore redeemStore;
    HubGate router;
    SpokeGate walletGate;

    MasterAccount master;
    address masterAccount;
    address masterTR;
    PuppetAccount puppetA;
    PuppetAccount puppetB;
    PuppetAccount puppetC;

    bytes32 routerDomainSeparator;

    mapping(address puppet => mapping(address master => bytes)) internal _body;
    mapping(address puppet => mapping(address master => bytes)) internal _sig;
    mapping(address puppet => mapping(address master => uint)) internal _matched;

    uint _nonceCounter;

    function setUp() public {
        vm.chainId(HUB_CHAIN_ID);
        vm.warp(1_700_000_000);

        (attestor, attestorKey) = makeAddrAndKey("Attestor");
        (userM, keyM) = makeAddrAndKey("UserMaster");
        (userA, keyA) = makeAddrAndKey("UserA");
        (userB, keyB) = makeAddrAndKey("UserB");
        (userC, keyC) = makeAddrAndKey("UserC");

        usdc = new MockERC20("USDC", "USDC", 6);

        vm.startPrank(owner);
        dictate = new Dictate(owner);

        register = new RegisterModule(dictate, HUB_CHAIN_ID);

        PuppetAccount accountImpl = new PuppetAccount();
        TransientRoute depositPuppetAccount = new TransientRoute();
        MasterAccount masterPuppetAccount = new MasterAccount();
        Attest attest = new Attest(dictate);
        accountGate = new AccountModule(
            dictate, attest, address(accountImpl), address(depositPuppetAccount), address(masterPuppetAccount)
        );
        dictate.setAccess(attest, address(accountGate));

        ShareToken shareTokenImpl = new ShareToken();
        shareGate = new ShareModule(dictate, address(shareTokenImpl));

        allocate = new AllocateModule(dictate);
        allocateStore = new AllocateStore(dictate);
        subscribe = new SubscribeModule(dictate);
        redeem = new RedeemModule(dictate);
        redeemStore = new RedeemStore(dictate);

        router = new HubGate(
            dictate, accountGate, shareGate, allocate, allocateStore, subscribe, redeem, redeemStore, register,
            HubGate.Config({
                attestor: attestor,
                feeReceiver: feeReceiver,
                transferGasLimit: TRANSFER_GAS_LIMIT,
                maxBlockDelay: 5,
                acrossSpokePool: ACROSS_SPOKE_POOL_ARBITRUM,
                maxRelayFeeBps: 1000
            })
        );

        WalletDepositModule walletDeposit = new WalletDepositModule(dictate, register);
        walletGate = new SpokeGate(
            dictate, accountGate, register, HUB_CHAIN_ID,
            SpokeGate.Config({
                attestor: attestor,
                feeReceiver: feeReceiver,
                transferGasLimit: TRANSFER_GAS_LIMIT,
                maxBlockDelay: 5,
                acrossSpokePool: ACROSS_SPOKE_POOL_ARBITRUM,
                maxRelayFeeBps: 1000
            })
        );
        dictate.setAccess(walletDeposit, address(walletGate));
        dictate.setAccess(allocateStore, address(subscribe));
        dictate.setAccess(allocateStore, address(allocate));
        dictate.setAccess(redeemStore, address(redeem));
        dictate.setAccess(shareGate, address(allocate));
        dictate.setAccess(shareGate, address(redeem));
        dictate.setAccess(shareGate, address(router));
        dictate.setAccess(subscribe, address(router));
        dictate.setAccess(allocate, address(router));
        dictate.setAccess(redeem, address(router));

        grantGate(dictate, accountGate, address(subscribe));
        grantGate(dictate, accountGate, address(allocate));
        grantGate(dictate, accountGate, address(redeem));
        grantGate(dictate, accountGate, address(walletGate));
        grantGate(dictate, accountGate, address(router));
        grantGate(dictate, accountGate, address(this));

        dictate.setAccess(register, owner);
        register.registerToken(USDC_ID, IERC20(address(usdc)), 0, address(usdc));

        vm.stopPrank();

        routerDomainSeparator = _domainSep("HubGate", address(router));
        vm.mockCall(address(0x64), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(block.number));

        master = MasterAccount(payable(accountGate.predictMasterAccount(_masterParams())));
        masterAccount = address(master);
        masterTR = accountGate.predictTransientRoute(masterAccount);
        _createMaster(10e6);
        puppetA = _bootstrapPuppet(userA, keyA, "PuppetA");
        puppetB = _bootstrapPuppet(userB, keyB, "PuppetB");
        puppetC = _bootstrapPuppet(userC, keyC, "PuppetC");
    }

    function test_subscribe_writesBodyHashToAllocateStore() public {
        bytes memory _b = _encodeBody(0, 10_000);
        _subscribePuppet(puppetA, userA, keyA, _b);
        assertEq(
            allocateStore.mandateMap(address(puppetA), address(master)),
            keccak256(_b),
            "standing-auth bodyHash recorded"
        );
    }

    function test_subscribe_resubscribeOverwritesBodyHash() public {
        bytes memory _b1 = _encodeBody(0, 5000);
        _subscribePuppet(puppetA, userA, keyA, _b1);
        assertEq(allocateStore.mandateMap(address(puppetA), address(master)), keccak256(_b1));

        bytes memory _b2 = _encodeBody(0, 10_000);
        _subscribePuppet(puppetA, userA, keyA, _b2);
        assertEq(
            allocateStore.mandateMap(address(puppetA), address(master)),
            keccak256(_b2),
            "bodyHash overwritten with the new subscription"
        );
        assertTrue(keccak256(_b1) != keccak256(_b2), "bodies differ between subscriptions");
    }

    function test_subscribe_emptyBodyRevokesMandate() public {
        bytes memory _b = _encodeBody(0, 50e6);
        _subscribePuppet(puppetA, userA, keyA, _b);
        assertEq(allocateStore.mandateMap(address(puppetA), address(master)), keccak256(_b), "active mandate recorded");

        _subscribePuppet(puppetA, userA, keyA, "");
        assertEq(
            allocateStore.mandateMap(address(puppetA), address(master)),
            bytes32(0),
            "empty body zeros the mandate"
        );
    }

    function test_allocate_skipsRevokedPuppet() public {
        _fundPuppet(puppetA, 100e6);
        _subscribePuppet(puppetA, userA, keyA, _encodeBody(0, 50e6));
        _subscribePuppet(puppetA, userA, keyA, "");

        _matched[address(puppetA)][address(master)] = 100e6;
        usdc.mint(masterTR, 50e6);
        address[] memory _onlyA = new address[](1);
        _onlyA[0] = address(puppetA);
        _allocate(50e6, _onlyA);

        assertEq(puppetA.signedBalance(), 100e6, "revoked puppet not pulled despite attested amount");
        assertEq(usdc.balanceOf(address(puppetA)), 100e6, "actual untouched");
    }

    function test_allocate_pullsAttestedAmount() public {
        _fundPuppet(puppetA, 100e6);
        _subscribePuppet(puppetA, userA, keyA, _encodeBody(0, 0));
        _matched[address(puppetA)][address(master)] = 60e6;

        usdc.mint(masterTR, 50e6);
        address[] memory _onlyA = new address[](1);
        _onlyA[0] = address(puppetA);
        _allocate(50e6, _onlyA);

        assertEq(puppetA.signedBalance(), 40e6, "debited exactly the attested matched amount");
        assertEq(usdc.balanceOf(address(puppetA)), 40e6, "actual outflow matches attested amount");
    }

    function test_allocate_rateLimitClampsAttestedAmount() public {
        _fundPuppet(puppetA, 100e6);
        _subscribePuppet(puppetA, userA, keyA, _encodeBody(0, 30e6)); // rateLimit 30e6
        _matched[address(puppetA)][address(master)] = 100e6; // attested over the cap

        usdc.mint(masterTR, 100e6);
        address[] memory _onlyA = new address[](1);
        _onlyA[0] = address(puppetA);
        _allocate(100e6, _onlyA);

        assertEq(puppetA.signedBalance(), 70e6, "pull clamped to rateLimit, not the attested 100e6");
    }

    function test_allocate_throttleSkipsEarlyRound() public {
        _fundPuppet(puppetA, 200e6);
        _subscribePuppet(puppetA, userA, keyA, _encodeBody(1 hours, 0)); // throttle 1h
        _matched[address(puppetA)][address(master)] = 50e6;
        address[] memory _onlyA = new address[](1);
        _onlyA[0] = address(puppetA);

        usdc.mint(masterTR, 50e6);
        _allocate(50e6, _onlyA);
        assertEq(puppetA.signedBalance(), 150e6, "first round debits 50e6");

        vm.warp(block.timestamp + 1 minutes);
        usdc.mint(masterTR, 50e6);
        _allocate(50e6, _onlyA);
        assertEq(puppetA.signedBalance(), 150e6, "within throttle: round skipped");

        vm.warp(block.timestamp + 1 hours);
        usdc.mint(masterTR, 50e6);
        _allocate(50e6, _onlyA);
        assertEq(puppetA.signedBalance(), 100e6, "after throttle window: allocates again");
    }

    function test_allocate_skipsPuppetOnStaleSigHash() public {
        _fundPuppet(puppetA, 100e6);
        bytes memory _staleSig = _subscribePuppet(puppetA, userA, keyA, _encodeBody(0, 0));
        bytes memory _staleBody = _body[address(puppetA)][address(master)];
        _matched[address(puppetA)][address(master)] = 50e6;

        _subscribePuppet(puppetA, userA, keyA, _encodeBody(0, 5000));
        _body[address(puppetA)][address(master)] = _staleBody;
        _sig[address(puppetA)][address(master)] = _staleSig;

        usdc.mint(masterTR, 50e6);
        address[] memory _onlyA = new address[](1);
        _onlyA[0] = address(puppetA);
        _allocate(50e6, _onlyA);

        assertEq(puppetA.signedBalance(), 100e6, "stale sig skipped, no debit");
        assertEq(usdc.balanceOf(address(puppetA)), 100e6, "actual untouched");
    }

    function test_allocate_skipsPuppetOnInvalidMandateSig() public {
        _fundPuppet(puppetA, 100e6);
        _subscribePuppet(puppetA, userA, keyA, _encodeBody(0, 0));

        bytes32 _mandateDigest = _standingAuthDigest(
            address(puppetA), address(master), address(usdc), keccak256(_body[address(puppetA)][address(master)])
        );
        uint _foreignKey = 0xBADBADBAD;
        _sig[address(puppetA)][address(master)] = _sign(_foreignKey, _mandateDigest);

        _matched[address(puppetA)][address(master)] = 50e6;
        usdc.mint(masterTR, 50e6);
        address[] memory _onlyA = new address[](1);
        _onlyA[0] = address(puppetA);
        _allocate(50e6, _onlyA);

        assertEq(puppetA.signedBalance(), 100e6, "invalid sig skipped, no debit");
        assertEq(usdc.balanceOf(address(puppetA)), 100e6, "actual untouched");
    }

    function test_allocate_skipsPuppetOnDonationGrief() public {
        _fundPuppet(puppetA, 50e6);
        _subscribePuppet(puppetA, userA, keyA, _encodeBody(0, 0));

        usdc.mint(address(puppetA), 50e6);
        assertEq(puppetA.signedBalance(), 50e6, "signed unchanged by donation");
        assertEq(usdc.balanceOf(address(puppetA)), 100e6, "actual reflects donation");

        _matched[address(puppetA)][address(master)] = 75e6;
        usdc.mint(masterTR, 100e6);
        address[] memory _onlyA = new address[](1);
        _onlyA[0] = address(puppetA);
        _allocate(100e6, _onlyA);

        assertEq(puppetA.signedBalance(), 50e6, "donation-griefed puppet skipped, signed unchanged");
        assertEq(usdc.balanceOf(address(puppetA)), 100e6, "actual unchanged including donation");
    }

    function test_allocate_mixedSkipAndActiveBatchSucceeds() public {
        _fundPuppet(puppetA, 200e6);
        _fundPuppet(puppetB, 200e6);
        _fundPuppet(puppetC, 200e6);
        _subscribePuppet(puppetA, userA, keyA, _encodeBody(0, 0));
        _subscribePuppet(puppetC, userC, keyC, _encodeBody(0, 0));

        // puppetB never subscribed -> mandateMap mismatch -> skipped; A & C active
        _matched[address(puppetA)][address(master)] = 100e6;
        _matched[address(puppetB)][address(master)] = 100e6;
        _matched[address(puppetC)][address(master)] = 100e6;
        usdc.mint(masterTR, 100e6);
        address[] memory _sorted = _sortedTriple(address(puppetA), address(puppetB), address(puppetC));
        _allocate(100e6, _sorted);

        assertEq(puppetA.signedBalance(), 100e6, "A active, debited the attested amount");
        assertEq(puppetB.signedBalance(), 200e6, "B unsubscribed, skipped");
        assertEq(puppetC.signedBalance(), 100e6, "C active, debited the attested amount");
    }

    function _bootstrapPuppet(
        address _u,
        uint _k,
        bytes32 _name
    ) internal returns (PuppetAccount) {
        AccountLib.AccountInitParams memory _p = _puppetParams(_u, _name);
        accountGate.createPuppetAccount(_p, _bindSig(_k), "");
        return PuppetAccount(payable(accountGate.predictPuppetAccount(_p)));
    }

    function _fundPuppet(
        PuppetAccount _puppet,
        uint _amount
    ) internal {
        usdc.mint(address(_puppet), _amount);
        vm.store(address(_puppet), bytes32(uint(0)), bytes32(uint(_puppet.signedBalance() + _amount)));
    }

    function _subscribePuppet(
        PuppetAccount _puppet,
        address _u,
        uint _k,
        bytes memory _bodyBytes
    ) internal returns (bytes memory _standingSig) {
        AccountLib.AccountInitParams memory _masterP = _masterParams();
        address _masterAddr = accountGate.predictMasterAccount(_masterP);
        bytes32 _authDigest = _standingAuthDigest(address(_puppet), _masterAddr, address(usdc), keccak256(_bodyBytes));
        _standingSig = _sign(_k, _authDigest);

        RuleLib.Rule[] memory _rules = new RuleLib.Rule[](1);
        _rules[0] = RuleLib.Rule({masterParams: _masterP, body: _bodyBytes, mandate: _standingSig});
        SubscribeModule.SubscribeIntent memory _intent = SubscribeModule.SubscribeIntent({
            params: _puppetParams(_u, _puppet.getName()),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid,
            baseToken: IERC20(address(usdc)),
            rules: _rules
        });
        bytes32 _ruleHash = keccak256(
            abi.encodePacked(
                keccak256(
                    abi.encode(
                        RuleLib.SUBSCRIBE_RULE_TYPEHASH,
                        _hashAccount(_masterP),
                        keccak256(_bodyBytes),
                        keccak256(_standingSig)
                    )
                )
            )
        );
        bytes32 _digest = _routerDigest(
            keccak256(
                abi.encode(
                    SUBSCRIBE_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    _ruleHash
                )
            )
        );
        router.subscribe(_intent, _sign(_k, _digest), _sign(attestorKey, _digest), 0);

        _body[address(_puppet)][_masterAddr] = _bodyBytes;
        _sig[address(_puppet)][_masterAddr] = _standingSig;
    }

    function _allocate(
        uint _masterAmount,
        address[] memory _puppetList
    ) internal {
        (
            AllocateModule.AllocateIntent memory _intent,
            bytes memory _userSig,
            bytes memory _attSig,
            bytes[] memory _bodies,
            bytes[] memory _sigs
        ) = _attestAllocateModule(_masterAmount, _puppetList);
        router.allocate(_intent, _bodies, _sigs, _userSig, _attSig, 0);
    }

    function _attestAllocateModule(
        uint _masterAmount,
        address[] memory _puppetList
    )
        internal
        returns (
            AllocateModule.AllocateIntent memory _intent,
            bytes memory _userSig,
            bytes memory _attSig,
            bytes[] memory _bodyList,
            bytes[] memory _sigList
        )
    {
        ShareToken _st = ShareToken(router.predictShareToken(masterAccount));
        uint _supply = address(_st).code.length > 0 ? _st.totalSupply() : 0;
        uint _n = _puppetList.length;
        uint[] memory _matchedArr = new uint[](_n);
        _bodyList = new bytes[](_n);
        _sigList = new bytes[](_n);
        for (uint _i; _i < _n; ++_i) {
            address _p = _puppetList[_i];
            _matchedArr[_i] = _matched[_p][address(master)];
            _bodyList[_i] = _body[_p][address(master)];
            _sigList[_i] = _sig[_p][address(master)];
        }
        _intent = AllocateModule.AllocateIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _masterParams(),
            baseToken: IERC20(address(usdc)),
            acceptableNetAssetValue: _supply == 0 ? 1 : _supply,
            totalShareSupply: _supply,
            masterAmount: _masterAmount,
            puppetList: _puppetList,
            matchedAmountList: _matchedArr,
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _routerDigest(
            keccak256(
                abi.encode(
                    ALLOCATE_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.masterAmount,
                    keccak256(abi.encodePacked(_intent.puppetList)),
                    keccak256(abi.encodePacked(_intent.matchedAmountList))
                )
            )
        );
        _userSig = _sign(keyM, _digest);
        _attSig = _sign(attestorKey, _digest);
    }

    function _encodeBody(
        uint _throttle,
        uint _rateBps
    ) internal pure returns (bytes memory) {
        return abi.encode(_throttle, _rateBps);
    }

    function _masterParams() internal view returns (AccountLib.AccountInitParams memory) {
        return AccountLib.AccountInitParams({user: userM, name: bytes32("M"), baseTokenId: USDC_ID, signer: address(0)});
    }

    function _puppetParams(
        address _u,
        bytes32 _name
    ) internal pure returns (AccountLib.AccountInitParams memory) {
        return AccountLib.AccountInitParams({user: _u, name: _name, baseTokenId: USDC_ID, signer: address(0)});
    }

    function _createMaster(
        uint _genesisSeed
    ) internal {
        usdc.mint(masterTR, _genesisSeed);
        AllocateModule.AllocateIntent memory _intent = AllocateModule.AllocateIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _masterParams(),
            baseToken: IERC20(address(usdc)),
            acceptableNetAssetValue: 1,
            totalShareSupply: 0,
            masterAmount: _genesisSeed,
            puppetList: new address[](0),
            matchedAmountList: new uint[](0),
            acceptableRelayFee: 0,
            nonce: _nonce(),
            chainId: block.chainid
        });
        bytes32 _digest = _routerDigest(
            keccak256(
                abi.encode(
                    ALLOCATE_INTENT_TYPEHASH,
                    _hashAccount(_intent.params),
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.baseToken,
                    _intent.acceptableNetAssetValue,
                    _intent.totalShareSupply,
                    _intent.masterAmount,
                    keccak256(abi.encodePacked(_intent.puppetList)),
                    keccak256(abi.encodePacked(_intent.matchedAmountList))
                )
            )
        );
        router.createMaster(
            _intent,
            new bytes[](0),
            new bytes[](0),
            _bindSig(keyM),
            "",
            _sign(keyM, _digest),
            _sign(attestorKey, _digest),
            0
        );
    }

    function _hashAccount(
        AccountLib.AccountInitParams memory _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(ACCOUNT_TYPEHASH, _p.user, _p.name, _p.baseTokenId, _p.signer));
    }

    function _domainSep(
        string memory _name,
        address _verifying
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(_name)),
                keccak256(bytes("1")),
                block.chainid,
                _verifying
            )
        );
    }

    function _routerDigest(
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", routerDomainSeparator, _structHash));
    }

    function _standingAuthDigest(
        address _puppet,
        address _masterAddr,
        address _baseToken,
        bytes32 _bodyHash
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                routerDomainSeparator,
                keccak256(
                    abi.encode(
                        keccak256("Mandate(address puppet,address master,address baseToken,bytes32 bodyHash)"),
                        _puppet,
                        _masterAddr,
                        _baseToken,
                        _bodyHash
                    )
                )
            )
        );
    }

    function _bindSig(
        uint _k
    ) internal pure returns (bytes memory) {
        bytes memory _msg = bytes("Puppet: Authorize session key");
        bytes32 _digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", vm.toString(_msg.length), _msg));
        return _sign(_k, _digest);
    }

    function _sign(
        uint _k,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        (uint8 _v, bytes32 _r, bytes32 _s) = vm.sign(_k, _digest);
        return abi.encodePacked(_r, _s, _v);
    }

    function _nonce() internal returns (uint) {
        _nonceCounter++;
        return _nonceCounter;
    }

    function _sortedTriple(
        address _x,
        address _y,
        address _z
    ) internal pure returns (address[] memory _out) {
        _out = new address[](3);
        _out[0] = _x;
        _out[1] = _y;
        _out[2] = _z;
        for (uint _i; _i < 3; ++_i) {
            for (uint _j = _i + 1; _j < 3; ++_j) {
                if (uint160(_out[_j]) < uint160(_out[_i])) {
                    address _tmp = _out[_i];
                    _out[_i] = _out[_j];
                    _out[_j] = _tmp;
                }
            }
        }
    }
}
