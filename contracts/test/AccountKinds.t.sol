// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC1155Errors, IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";

import {HubGate, MANDATE_INTENT_TYPEHASH, MAX_SKIN, SELL_INTENT_TYPEHASH} from "src/HubGate.sol";
import {OPERATE_INTENT_TYPEHASH, SpokeGate} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Deposit} from "src/core/Deposit.sol";
import {MockSwapProvider} from "./mock/MockSwapProvider.t.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {Fund, PRICE_PRECISION, VIRTUAL_SHARES, VIRTUAL_VALUE} from "src/core/Fund.sol";
import {Redeem} from "src/core/Redeem.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {isOpen} from "src/core/FundStore.sol";
import {GRID_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {
    AccountLib,
    ESCROW_RETURN_DELAY,
    MAX_SESSION_BYTES,
    MAX_SESSION_TTL,
    SESSION_REVOKE_DELAY,
    WALLET_SIGNATURE_TAG
} from "src/utils/AccountLib.sol";
import {MandateLib} from "src/utils/MandateLib.sol";
import {BalanceLib} from "src/utils/BalanceLib.sol";
import {CallLib} from "src/utils/CallLib.sol";
import {Error} from "src/utils/Error.sol";
import {GateConfig} from "src/utils/GateConfig.sol";
import {
    DEPOSIT_ACROSS_INTENT_TYPEHASH,
    FUND_SWAP_INTENT_TYPEHASH,
    RETIRE_ESCROW_INTENT_TYPEHASH,
    WITHDRAW_INTENT_TYPEHASH,
    LiquidityGate
} from "src/utils/LiquidityGate.sol";
import {SwapLib} from "src/utils/SwapLib.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

import {HotPathTest} from "./HotPath.t.sol";

contract AccountKindsTestFakeBody is IAccount {
    address internal immutable module;
    address internal immutable parent;

    constructor(
        address _module,
        address _parent
    ) {
        module = _module;
        parent = _parent;
    }

    function bound() external view returns (address, address) {
        return (module, parent);
    }

    function user() external view returns (address) {
        return IAccount(parent).user();
    }

    function nonce() external pure returns (uint) {
        return 0;
    }

    function execute(
        address,
        bytes32,
        uint,
        bytes calldata,
        IAccount.Call[] calldata
    ) external pure returns (bytes32, bytes[] memory) {
        return (bytes32(0), new bytes[](0));
    }
}

contract AccountKindsTestAuthToken is ERC20 {
    error InvalidAuthorization();

    constructor() ERC20("Authorized", "AUTH") {}

    function mint(
        address _to,
        uint _amount
    ) external {
        _mint(_to, _amount);
    }

    function authorizationDigest(
        address _from,
        address _to,
        uint _value
    ) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), _from, _to, _value));
    }

    function transferWithAuthorization(
        address _from,
        address _to,
        uint _value,
        bytes calldata _signature
    ) external {
        if (!SignatureChecker.isValidSignatureNow(_from, authorizationDigest(_from, _to, _value), _signature)) {
            revert InvalidAuthorization();
        }
        _transfer(_from, _to, _value);
    }
}

contract AccountKindsTestSmartWallet is IERC1271 {
    address public immutable owner;

    constructor(
        address _owner
    ) {
        owner = _owner;
    }

    function isValidSignature(
        bytes32 _digest,
        bytes calldata _signature
    ) external view returns (bytes4) {
        return ECDSA.tryRecoverCalldata(_digest, _signature) == owner
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }
}

contract AccountKindsTestCouncilWallet is IERC1271 {
    address[] internal memberList;

    constructor(
        address[] memory _memberList
    ) {
        memberList = _memberList;
    }

    function isValidSignature(
        bytes32 _digest,
        bytes calldata _signature
    ) external view returns (bytes4) {
        uint _count = memberList.length;
        if (_signature.length != _count * 65) return bytes4(0xffffffff);
        for (uint _i; _i < _count; ++_i) {
            if (ECDSA.tryRecoverCalldata(_digest, _signature[_i * 65:(_i + 1) * 65]) != memberList[_i]) {
                return bytes4(0xffffffff);
            }
        }
        return IERC1271.isValidSignature.selector;
    }
}

contract AccountKindsTestCollectible is ERC721 {
    constructor() ERC721("Venue Position", "VPOS") {}

    function mint(
        address _to,
        uint _id
    ) external {
        _mint(_to, _id);
    }
}

contract AccountKindsTestEdition is ERC1155 {
    constructor() ERC1155("") {}

    function mint(
        address _to,
        uint _id,
        uint _amount
    ) external {
        _mint(_to, _id, _amount, "");
    }
}

contract AccountKindsTest is HotPathTest {
    function _openFund() internal {
        _fundWallet(master, 1500e6);
        _escrowOnHub(address(usdc), 500e6);
        bytes32 _symbol = bytes32("KND");
        bytes memory _pixels = new bytes(GRID_BYTES);
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
                                    _cloneCode(fundModule.shareImpl(), abi.encodePacked(body, _symbol, _pixels, uint16(1000)))
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
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i));
    }

    function _swapIntent(
        address _acct,
        uint _nonce,
        address _recipient,
        uint _amount,
        uint _destinationChainId
    ) internal view returns (Deposit.SwapIntent memory) {
        return Deposit.SwapIntent({
            header: _header(_acct, master, _nonce),
            destinationChainId: _destinationChainId,
            swap: _swapParams(_recipient, _amount)
        });
    }

    function _swapWithFee(
        address _acct,
        address _recipient,
        uint _fee
    ) internal view returns (Deposit.SwapIntent memory intent_) {
        intent_ = _swapIntent(_acct, _nonceOf(_acct), _recipient, 30e6, block.chainid);
        intent_.header.fee = _fee;
        intent_.swap.providerCallData =
            abi.encodeCall(MockSwapProvider.swap, (address(usdc), 30e6 - _fee, address(outToken), 1e18, _recipient));
    }

    function _operateIntent(
        address _acct,
        address _user,
        uint _key,
        uint _nonce,
        IAccount.Call[] memory _callList
    ) internal view returns (SpokeGate.OperateIntent memory intent_, bytes memory coSig_) {
        intent_ = SpokeGate.OperateIntent({
            header: _header(_acct, _user, _nonce), callList: _callList, tokenList: new address[](0)
        });
        coSig_ = _pair(
            _key,
            _typed(
                _acct,
                intent_.header.deadline,
                keccak256(
                    abi.encode(
                        OPERATE_INTENT_TYPEHASH,
                        _hashHeader(intent_.header),
                        _callListHash(_callList),
                        keccak256(abi.encodePacked(intent_.tokenList))
                    )
                )
            )
        );
    }

    function _retireIntent(
        address _acct,
        address _user,
        uint _key,
        uint _amount
    ) internal view returns (LiquidityGate.RetireEscrowIntent memory intent_, bytes memory coSig_) {
        intent_ = LiquidityGate.RetireEscrowIntent({
            header: _header(_acct, _user, _nonceOf(_acct)), token: address(usdc), amount: _amount
        });
        coSig_ = _pair(
            _key,
            _typed(
                _acct,
                intent_.header.deadline,
                keccak256(abi.encode(RETIRE_ESCROW_INTENT_TYPEHASH, _hashHeader(intent_.header), intent_.token, intent_.amount))
            )
        );
    }

    function _allocateFor(
        address _acct,
        Fund.Credit memory _c
    ) internal returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        address _body = body;
        body = _acct;
        (intent_, coSig_) = _allocateIntent(_nonceOf(_acct), 0, _c, new Fund.Allocation[](0));
        body = _body;
    }

    function _redeemFor(
        address _acct,
        uint _join
    ) internal returns (Redeem.RedeemIntent memory intent_, bytes memory coSig_) {
        Fund.Valuation memory _v = _valuation(_nav());
        address _body = body;
        body = _acct;
        intent_ = _redeemIntent(0, _join, _v);
        coSig_ = _redeemSig(intent_);
        body = _body;
    }

    function _record(
        address _acct,
        address _source
    )
        internal
        returns (bytes32 digest_, bytes memory signature_, bytes memory executionData_, BalanceLib.Balance[] memory balanceList_)
    {
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        uint _records;
        for (uint _j; _j < _logs.length; ++_j) {
            if (
                _logs[_j].emitter != address(accountModule) || _logs[_j].topics[0] != AccountModule.AccountCall.selector
                    || _logs[_j].topics[1] != bytes32(uint(uint160(_acct)))
            ) continue;
            assertEq(_logs[_j].topics[2], bytes32(uint(uint160(_source))), "written by the entry itself");
            (,,, digest_, signature_, executionData_,,, balanceList_) = abi.decode(
                _logs[_j].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
            );
            ++_records;
        }
        assertEq(_records, 1, "one call writes one record on the account");
    }

    function _sessionBlob(
        uint _walletKey,
        uint _signerKey,
        uint _issuedAt,
        uint _expiry,
        uint _epoch,
        bytes32 _digest
    ) internal view returns (bytes memory) {
        address _signer = vm.addr(_signerKey);
        return abi.encode(
            _signer,
            _issuedAt,
            _expiry,
            _epoch,
            address(0),
            _coSig(
                _walletKey,
                AccountLib.sessionDigest(address(accountModule), master, _signer, _issuedAt, _expiry, _epoch, address(0))
            ),
            _coSig(_signerKey, _digest)
        );
    }

    function test_every_record_carries_the_clean_account_topic_from_creation_on() public {
        address _user = makeAddr("clean-topic");
        address _account = accountModule.predictUserAccount(_user);
        vm.recordLogs();
        _fundWallet(_user, 1e6);
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        uint _records;
        for (uint _i; _i < _logs.length; ++_i) {
            if (_logs[_i].emitter != address(accountModule) || _logs[_i].topics[0] != AccountModule.AccountCall.selector) continue;
            assertEq(_logs[_i].topics[1], bytes32(uint(uint160(_account))), "the account topic is the bare address");
            assertEq(_logs[_i].topics[2], bytes32(uint(uint160(address(hub)))), "the gate entry writes each record itself");
            (,,,,, bytes memory _executionData,,, BalanceLib.Balance[] memory _balanceList) = abi.decode(
                _logs[_i].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
            );
            if (_records == 0) {
                assertEq(_executionData, abi.encode(AccountModule.createUserAccount.selector, _user), "creation comes first");
                assertEq(_balanceList.length, 0);
            } else {
                assertEq(
                    _executionData,
                    abi.encode(LiquidityGate.deposit.selector, address(usdc), uint(1e6), uint(0)),
                    "then the deposit, named by its gate entry with the token, amount and value attached"
                );
                assertEq(_balanceList.length, 1);
                assertEq(_balanceList[0].token, address(usdc));
                assertEq(_balanceList[0].amount, 1e6, "beside the balance it left in the account");
            }
            ++_records;
        }
        assertEq(_records, 2, "the first deposit records the account creation and the deposit");
    }

    function test_withdraw_admits_only_a_user_account_on_hub_and_spoke() public {
        _openFund();
        address _parent = _account(master);
        uint _nonce = _nonceOf(body);
        Deposit.SwapIntent memory _plain = Deposit.SwapIntent({
            header: _header(body, master, _nonce),
            destinationChainId: block.chainid,
            swap: SwapLib.SwapParams({
                inputToken: address(usdc),
                inputAmount: 499e6,
                outputToken: address(usdc),
                outputAmount: 499e6 - FEE,
                provider: address(0),
                providerCallData: ""
            })
        });
        bytes memory _plainSig = _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, body, _plain);
        Deposit.SwapIntent memory _routed = _swapIntent(body, _nonce, master, 499e6, block.chainid);
        bytes memory _routedSig = _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, body, _routed);
        bytes memory _mismatch = abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body);
        LiquidityGate[2] memory _gates = [LiquidityGate(address(hub)), LiquidityGate(address(spoke))];
        for (uint _g; _g < 2; ++_g) {
            vm.expectRevert(_mismatch);
            _gates[_g].withdraw(_plain, _plainSig);
            vm.expectRevert(_mismatch);
            _gates[_g].withdraw(_routed, _routedSig);
        }
        assertEq(usdc.balanceOf(body), 499e6, "the pooled capital stays in the body");
        assertEq(usdc.balanceOf(master), 0, "nothing reached the master wallet");
        assertEq(outToken.balanceOf(master), 0, "nor through a provider");
        assertEq(_nonceOf(body), _nonce, "the refused body intent consumed no nonce");

        uint _relayed = usdc.balanceOf(feeReceiver);
        _withdrawPlain(LiquidityGate(address(hub)), master, masterKey, _parent, 100e6);
        _withdrawPlain(LiquidityGate(address(spoke)), master, masterKey, _parent, 100e6);
        assertEq(usdc.balanceOf(master), 2 * (100e6 - FEE), "the user account withdraws on hub and spoke");
        assertEq(usdc.balanceOf(_parent), 1500e6 - 200e6);
        assertEq(usdc.balanceOf(feeReceiver), _relayed + 2 * FEE);
        assertEq(_nonceOf(_parent), 2);
    }

    function test_depositAcross_admits_only_a_user_account_on_hub_and_spoke() public {
        _openFund();
        address _parent = _account(master);
        uint _nonce = _nonceOf(body);
        Deposit.SwapIntent memory _i = _swapIntent(body, _nonce, master, 499e6, FOREIGN_CHAIN_ID);
        bytes memory _sig = _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, masterKey, body, _i);
        bytes memory _mismatch = abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body);
        vm.expectRevert(_mismatch);
        hub.depositAcross(_i, _sig);
        vm.expectRevert(_mismatch);
        spoke.depositAcross(_i, _sig);
        assertEq(usdc.balanceOf(body), 499e6, "a body cannot bridge its capital out");
        assertEq(usdc.balanceOf(address(swapProvider)), 0);
        assertEq(_nonceOf(body), _nonce);

        _depositAcross(LiquidityGate(address(hub)), master, masterKey, _parent, 400e6);
        _depositAcross(LiquidityGate(address(spoke)), master, masterKey, _parent, 400e6);
        assertEq(outToken.balanceOf(_parent), 2e18, "the user account deposits across on hub and spoke");
        assertEq(usdc.balanceOf(_parent), 1500e6 - 800e6);
        assertEq(usdc.balanceOf(address(swapProvider)), 2 * (400e6 - FEE));
        assertEq(_nonceOf(_parent), 2);
    }

    function test_a_swap_entry_takes_a_relay_fee_up_to_a_third_of_its_input_and_a_plain_withdraw_a_tenth() public {
        _openFund();
        address _parent = _account(master);
        uint _cap = 30e6 * 3333 / 10_000;
        bytes memory _over = abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, _cap + 1, 30e6, 3333);
        LiquidityGate[2] memory _gates = [LiquidityGate(address(hub)), LiquidityGate(address(spoke))];
        for (uint _g; _g < 2; ++_g) {
            LiquidityGate _gate = _gates[_g];
            assertEq(_gate.getConfig().maxSwapRelayFeeBps, 3333, "each gate carries a swap cap beside its plain one");
            uint _fees = usdc.balanceOf(feeReceiver);

            Deposit.SwapIntent memory _i = _swapWithFee(_parent, _parent, _cap + 1);
            bytes memory _sig = _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(_over);
            _gate.depositAcross(_i, _sig);
            _i = _swapWithFee(_parent, _parent, _cap);
            _gate.depositAcross(_i, _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, masterKey, _parent, _i));

            _i = _swapWithFee(body, body, _cap + 1);
            _sig = _swapSig(FUND_SWAP_INTENT_TYPEHASH, masterKey, body, _i);
            vm.expectRevert(_over);
            _gate.fundSwap(_i, _sig, _noGenesis());
            _i = _swapWithFee(body, body, _cap);
            _gate.fundSwap(_i, _swapSig(FUND_SWAP_INTENT_TYPEHASH, masterKey, body, _i), _noGenesis());

            _i = _swapWithFee(_parent, master, _cap + 1);
            _sig = _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(_over);
            _gate.withdraw(_i, _sig);
            _i = _swapWithFee(_parent, master, _cap);
            _gate.withdraw(_i, _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, _parent, _i));
            assertEq(
                usdc.balanceOf(feeReceiver) - _fees,
                3 * _cap,
                "depositAcross, fundSwap and a provider withdraw each paid a third of their input, and not a unit more"
            );

            _i = _swapIntent(_parent, _nonceOf(_parent), master, 30e6, block.chainid);
            _i.swap = SwapLib.SwapParams({
                inputToken: address(usdc),
                inputAmount: 30e6,
                outputToken: address(usdc),
                outputAmount: 30e6 - _cap,
                provider: address(0),
                providerCallData: ""
            });
            _i.header.fee = _cap;
            _sig = _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, _cap, 30e6, 1000));
            _gate.withdraw(_i, _sig);
            _i.header.fee = 3e6 + 1;
            _i.swap.outputAmount = 30e6 - 3e6 - 1;
            _sig = _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 3e6 + 1, 30e6, 1000));
            _gate.withdraw(_i, _sig);
            _i.header.fee = 3e6;
            _i.swap.outputAmount = 27e6;
            uint _held = usdc.balanceOf(master);
            _gate.withdraw(_i, _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, _parent, _i));
            assertEq(usdc.balanceOf(master) - _held, 27e6, "while a plain withdraw still pays at most a tenth in fees");
        }

        GateConfig memory _config = spoke.getConfig();
        _config.maxSwapRelayFeeBps = 10_000;
        vm.expectRevert(abi.encodeWithSelector(Error.Gate__InvalidRelayFeeBps.selector, 10_000));
        new SpokeGate(accountModule, depositModule, spokeEscrowStore, _config);
        _config.maxSwapRelayFeeBps = 9999;
        assertEq(
            new SpokeGate(accountModule, depositModule, spokeEscrowStore, _config).getConfig().maxSwapRelayFeeBps,
            9999,
            "a gate takes any swap cap short of the whole input"
        );
    }

    function test_depositEscrow_locks_under_the_callers_own_account_on_hub_and_spoke() public {
        _openFund();
        address _parent = _account(master);
        address _puppet = accountModule.predictUserAccount(backer);
        uint _held = usdc.balanceOf(_parent);
        LiquidityGate[2] memory _gates = [LiquidityGate(address(hub)), LiquidityGate(address(spoke))];
        EscrowStore[2] memory _stores = [hubEscrowStore, spokeEscrowStore];
        for (uint _g; _g < 2; ++_g) {
            uint _escrowed = _stores[_g].escrowedMap(_parent, address(usdc));
            uint _stored = usdc.balanceOf(address(_stores[_g]));
            usdc.mint(master, 100e6);
            vm.startPrank(master);
            IERC20(address(usdc)).approve(address(depositModule), 100e6);
            _gates[_g].depositEscrow(address(usdc), 100e6);
            vm.stopPrank();
            assertEq(_stores[_g].escrowedMap(_parent, address(usdc)), _escrowed + 100e6, "the wallet locks under its own account");
            assertEq(usdc.balanceOf(address(_stores[_g])), _stored + 100e6, "and the gate's own store holds the tokens");

            usdc.mint(backer, 30e6);
            vm.startPrank(backer);
            IERC20(address(usdc)).approve(address(depositModule), 30e6);
            _gates[_g].depositEscrow(address(usdc), 30e6);
            vm.stopPrank();
            assertEq(_stores[_g].escrowedMap(_puppet, address(usdc)), 30e6, "another wallet locks under its own");
            assertEq(_stores[_g].escrowedMap(_parent, address(usdc)), _escrowed + 100e6, "and never adds to someone else's");
        }
        assertEq(usdc.balanceOf(_parent), _held, "without touching the account balance");
        assertEq(hubEscrowStore.escrowedMap(_parent, address(usdc)), 600e6, "the hub ledger keeps the opening escrow beside this one");
        assertEq(spokeEscrowStore.escrowedMap(_parent, address(usdc)), 100e6, "while the spoke ledger is its own");
    }

    function test_a_body_never_escrows_and_pays_its_owner_only_through_a_hub_redemption() public {
        _openFund();
        address _parent = _account(master);
        uint _nonce = _nonceOf(body);
        (LiquidityGate.RetireEscrowIntent memory _i, bytes memory _sig) = _retireIntent(body, master, masterKey, 400e6);
        LiquidityGate[2] memory _gates = [LiquidityGate(address(hub)), LiquidityGate(address(spoke))];
        EscrowStore[2] memory _stores = [hubEscrowStore, spokeEscrowStore];
        for (uint _g; _g < 2; ++_g) {
            vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
            _gates[_g].retireEscrow(_i, _sig);
            vm.expectRevert(Error.Account__InvalidUser.selector);
            vm.prank(body);
            _gates[_g].requestReturn(address(usdc));
            vm.expectRevert(Error.Account__InvalidUser.selector);
            vm.prank(body);
            _gates[_g].returnEscrow(address(usdc));
            assertEq(_stores[_g].escrowedMap(body, address(usdc)), 0, "a body holds no escrow on either gate, nor any return to ask for");
        }
        assertEq(usdc.balanceOf(body), 499e6, "its capital stays in it");
        assertEq(_nonceOf(body), _nonce, "and the refused intent spent no nonce");

        _retireEscrow(LiquidityGate(address(hub)), hubEscrowStore, address(usdc), 100e6);
        _retireEscrow(LiquidityGate(address(spoke)), spokeEscrowStore, address(usdc), 100e6);
        assertEq(usdc.balanceOf(_parent), 1500e6 - 2 * (100e6 + FEE), "while its owner's user account escrows on both gates");

        IAccount.Call[] memory _trade = new IAccount.Call[](1);
        _trade[0] = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: 200_000,
            callData: abi.encodeCall(IERC20.transfer, (makeAddr("weth-venue"), 498e6))
        });
        _operate(_trade);
        _wethTo(body, 3000 ether);
        assertEq(usdc.balanceOf(body), 0, "the body trades its capital into WETH through a venue");

        (Redeem.RedeemIntent memory _close, bytes memory _closeSig) = _redeemFor(body, 499e18);
        uint _ownerHeld = wnt.balanceOf(_ownerAccount());
        uint _walletHeld = wnt.balanceOf(master);
        uint _relayed = wnt.balanceOf(feeReceiver);
        (bool _ok, bytes memory _ret) =
            address(spoke).call(abi.encodeCall(HubGate.redeem, (_close, _closeSig, new address[](0))));
        assertFalse(_ok, "a spoke has no redemption to settle");
        assertEq(_ret.length, 0);
        hub.redeem(_close, _closeSig, new address[](0));
        assertEq(
            wnt.balanceOf(_ownerAccount()) - _ownerHeld,
            3000 ether - FEE * USD,
            "the hub redemption pays the owner's account the body's whole cash, net of its relay fee"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _relayed, FEE * USD);
        assertEq(wnt.balanceOf(body), 0, "and leaves the body empty");
        assertEq(wnt.balanceOf(master), _walletHeld, "and nothing reaches the owner's wallet");
        assertEq(shareToken.totalSupply(), 0, "the full close burns every share");
        assertFalse(isOpen(fundStore.getRedemption(body)));
    }

    function test_an_eoa_and_a_1271_wallet_escrow_retire_and_are_returned_on_the_hub() public {
        (address _eoa, uint _eoaKey) = makeAddrAndKey("escrow-eoa");
        (address _signer, uint _signerKey) = makeAddrAndKey("escrow-wallet-owner");
        (, uint _strangerKey) = makeAddrAndKey("escrow-stranger");
        address[2] memory _wallets = [_eoa, address(new AccountKindsTestSmartWallet(_signer))];
        uint[2] memory _keys = [_eoaKey, _signerKey];
        uint _stored = usdc.balanceOf(address(hubEscrowStore));
        uint _returnAt = vm.getBlockTimestamp() + ESCROW_RETURN_DELAY;
        for (uint _k; _k < 2; ++_k) {
            address _wallet = _wallets[_k];
            _fundWallet(_wallet, 300e6);
            address _acct = _account(_wallet);
            assertEq(UserAccount(payable(_acct)).user(), _wallet, "the account belongs to the wallet, contract or not");

            usdc.mint(_wallet, 200e6);
            vm.startPrank(_wallet);
            IERC20(address(usdc)).approve(address(depositModule), 200e6);
            vm.recordLogs();
            hub.depositEscrow(address(usdc), 200e6);
            vm.stopPrank();
            (bytes32 _digest, bytes memory _signature, bytes memory _executionData, BalanceLib.Balance[] memory _balanceList) =
                _record(_acct, address(hub));
            assertEq(
                _executionData,
                abi.encode(LiquidityGate.depositEscrow.selector, address(usdc), uint(200e6), uint(0), uint(200e6)),
                "the hub records the escrow with the owner's new total"
            );
            assertEq(_balanceList.length, 0, "and no account balance, since none moved");
            assertEq(hubEscrowStore.escrowedMap(_acct, address(usdc)), 200e6, "the wallet escrows on the hub under its account");
            assertEq(usdc.balanceOf(_acct), 300e6, "without touching the account balance");

            (LiquidityGate.RetireEscrowIntent memory _i, bytes memory _sig) = _retireIntent(_acct, _wallet, _keys[_k], 100e6);
            (, bytes memory _forged) = _retireIntent(_acct, _wallet, _strangerKey, 100e6);
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.retireEscrow(_i, _forged);
            vm.recordLogs();
            hub.retireEscrow(_i, _sig);
            (, _signature, _executionData, _balanceList) = _record(_acct, address(hub));
            assertEq(_signature, _sig, "the wallet's own co-signature retires the account balance into the hub escrow");
            assertEq(
                _executionData,
                abi.encode(LiquidityGate.retireEscrow.selector, address(usdc), uint(100e6), uint(300e6), address(usdc), FEE),
                "recording the escrowed total"
            );
            assertEq(_balanceList.length, 1);
            assertEq(_balanceList[0].amount, 300e6 - 100e6 - FEE, "and the account balance it left");
            assertEq(usdc.balanceOf(_acct), 300e6 - 100e6 - FEE);
            assertEq(hubEscrowStore.escrowedMap(_acct, address(usdc)), 300e6);
            assertEq(_nonceOf(_acct), 1);

            vm.recordLogs();
            vm.prank(_wallet);
            hub.requestReturn(address(usdc));
            (_digest, _signature, _executionData, _balanceList) = _record(_acct, address(hub));
            assertEq(_digest, bytes32(0), "the wallet asks for its escrow back in its own call, signing nothing");
            assertEq(_signature.length, 0);
            assertEq(
                _executionData,
                abi.encode(LiquidityGate.requestReturn.selector, address(usdc), _returnAt),
                "the request records when the return opens"
            );
            vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, _returnAt));
            vm.prank(_wallet);
            hub.returnEscrow(address(usdc));
        }

        vm.warp(_returnAt);
        for (uint _k; _k < 2; ++_k) {
            address _wallet = _wallets[_k];
            address _acct = accountModule.predictUserAccount(_wallet);
            uint _paid = usdc.balanceOf(_wallet);
            uint _kept = usdc.balanceOf(_acct);
            vm.recordLogs();
            vm.prank(_wallet);
            hub.returnEscrow(address(usdc));
            (,, bytes memory _executionData, BalanceLib.Balance[] memory _balanceList) = _record(_acct, address(hub));
            assertEq(
                _executionData,
                abi.encode(LiquidityGate.returnEscrow.selector, address(usdc), uint(300e6)),
                "the return records the returned total"
            );
            assertEq(_balanceList.length, 0);
            assertEq(usdc.balanceOf(_wallet) - _paid, 300e6, "the whole escrow returns to the wallet, whichever source funded it");
            assertEq(usdc.balanceOf(_acct), _kept, "never to the account");
            assertEq(hubEscrowStore.returnedMap(_acct, address(usdc)), 300e6);
            vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
            vm.prank(_wallet);
            hub.returnEscrow(address(usdc));
        }
        assertEq(usdc.balanceOf(address(hubEscrowStore)), _stored, "and the store keeps nothing for either owner");
    }

    function test_a_pull_is_one_value_free_transfer_wherever_fund_sends_it_and_the_hub_ends_the_mandate_at_expiry() public {
        _openFund();
        _fundWallet(backer, 100e6);
        address _puppet = _account(backer);
        MandateLib.Mandate[] memory _one = new MandateLib.Mandate[](1);
        _one[0] = MandateLib.Mandate({
            master: body, skin: MAX_SKIN, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: 0, expiry: block.timestamp + 1 days
        });
        _mandate(backer, backerKey, _one);
        uint _deadline = block.timestamp + 2 days;
        uint _nonce = _nonceOf(_puppet);
        address _elsewhere = makeAddr("elsewhere");

        IAccount.Call[] memory _pay = new IAccount.Call[](1);
        _pay[0] = CallLib.pay(address(usdc), _elsewhere, 1e6, 200_000);
        vm.prank(address(fundModule));
        accountModule.dispatch(IAccount(_puppet), address(0), bytes32(0), _deadline, "", "", _pay, new address[](0));
        assertEq(usdc.balanceOf(_elsewhere), 1e6, "the account bounds a pull's shape only; Fund names where it goes");

        IAccount.Call[][3] memory _forbidden;
        _forbidden[0] = new IAccount.Call[](2);
        _forbidden[0][0] = CallLib.pay(address(usdc), body, 1e6, 200_000);
        _forbidden[0][1] = CallLib.pay(address(usdc), body, 1e6, 200_000);
        _forbidden[1] = new IAccount.Call[](1);
        _forbidden[1][0] = IAccount.Call({
            target: address(usdc), value: 1, gasLimit: 200_000, callData: abi.encodeCall(IERC20.transfer, (body, 1e6))
        });
        _forbidden[2] = new IAccount.Call[](1);
        _forbidden[2][0] = IAccount.Call({
            target: address(usdc), value: 0, gasLimit: 200_000, callData: abi.encodeCall(IERC20.approve, (body, 1e6))
        });
        for (uint _k; _k < _forbidden.length; ++_k) {
            vm.prank(address(fundModule));
            vm.expectRevert(Error.Account__ForbiddenPull.selector);
            accountModule.dispatch(IAccount(_puppet), address(0), bytes32(0), _deadline, "", "", _forbidden[_k], new address[](0));
        }

        _pay[0] = CallLib.pay(address(usdc), body, 1e6, 200_000);
        uint _bodyBefore = usdc.balanceOf(body);
        vm.prank(address(fundModule));
        accountModule.dispatch(IAccount(_puppet), address(0), bytes32(0), _deadline, "", "", _pay, new address[](0));
        assertEq(usdc.balanceOf(body) - _bodyBefore, 1e6, "one plain transfer lands");
        assertEq(_nonceOf(_puppet), _nonce, "a pull spends no intent nonce");

        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = _row(_puppet, 20e6);
        vm.warp(_one[0].expiry - 1);
        (Fund.AllocateIntent memory _i,) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        _i.header.deadline = vm.getBlockTimestamp() + 300;
        hub.allocate(_i, _pair(masterKey, _allocateDigest(_i)), "");
        uint _shares = shareToken.balanceOf(_puppet);
        assertGt(_shares, 0, "a round lands the row until the mandate's last second");

        vm.warp(_one[0].expiry);
        _bodyBefore = usdc.balanceOf(body);
        vm.prank(address(fundModule));
        accountModule.dispatch(IAccount(_puppet), address(0), bytes32(0), _deadline, "", "", _pay, new address[](0));
        assertEq(usdc.balanceOf(body) - _bodyBefore, 1e6, "the account checks no expiry: the terms are Fund's");

        (_i,) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        _i.header.deadline = vm.getBlockTimestamp() + 300;
        bytes memory _sig = _pair(masterKey, _allocateDigest(_i));
        uint _cash = usdc.balanceOf(_puppet);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, "");
        assertEq(usdc.balanceOf(_puppet), _cash, "while the hub ends the mandate at its expiry: the round skips the row and pulls nothing");
        assertEq(shareToken.balanceOf(_puppet), _shares, "and mints nothing");
    }

    function test_mandate_admits_only_a_user_account() public {
        _openFund();
        MandateLib.Mandate[] memory _one = new MandateLib.Mandate[](1);
        _one[0] = MandateLib.Mandate({
            master: makeAddr("other-master"),
            skin: MAX_SKIN,
            allocationRate: 5000,
            exitCap: 10_000,
            cooldownPeriod: 0,
            expiry: block.timestamp + 365 days
        });
        uint _nonce = _nonceOf(body);
        HubGate.MandateIntent memory _i = HubGate.MandateIntent({header: _header(body, master, _nonce), epoch: 0, mandateList: _one});
        bytes memory _sig = _pair(
            masterKey,
            _typed(
                body,
                _i.header.deadline,
                keccak256(abi.encode(MANDATE_INTENT_TYPEHASH, _hashHeader(_i.header), _i.epoch, keccak256(abi.encode(_one))))
            )
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
        hub.mandate(_i, _sig);
        assertEq(_nonceOf(body), _nonce, "a body cannot become a puppet");
        assertEq(mandateStore.mandateMap(body, _one[0].master), bytes32(0), "the hub keeps no mandate for it");

        _fundWallet(backer, 10e6);
        address _puppet = _account(backer);
        _one[0].master = body;
        _mandate(backer, backerKey, _one);
        assertEq(
            mandateStore.mandateMap(_puppet, body),
            keccak256(abi.encode(_one[0], UserAccount(payable(_puppet)).epoch())),
            "the user account mandates, and the hub keeps the terms under its epoch"
        );
        assertEq(_nonceOf(_puppet), 1);
    }

    function test_sell_admits_only_a_user_account() public {
        _openFund();
        _fundWallet(backer, 1000e6);
        MandateLib.Mandate[] memory _one = new MandateLib.Mandate[](1);
        _one[0] = MandateLib.Mandate({
            master: body, skin: MAX_SKIN, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
        _mandate(backer, backerKey, _one);
        address _puppet = _account(backer);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = _row(_puppet, 400e6);
        (Fund.AllocateIntent memory _round, bytes memory _roundSig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        hub.allocate(_round, _roundSig, _ownerCoSig(_round));
        assertEq(shareToken.balanceOf(body), 499e18);
        assertEq(shareToken.balanceOf(_puppet), 399e18);

        Redeem.SellIntent memory _i = Redeem.SellIntent({
            header: _header(body, master, _nonceOf(body)), shareToken: shareToken, shares: 499e18
        });
        bytes memory _sig = _pair(
            masterKey,
            _typed(
                body,
                _i.header.deadline,
                keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(_i.header), shareToken, uint(499e18)))
            )
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
        hub.sell(_i, _sig);
        assertEq(shareToken.balanceOf(body), 499e18, "the master exits only through redeem");
        assertEq(fundStore.getRedemption(body).queued, 0);

        _sell(backer, backerKey, 399e18);
        assertEq(shareToken.balanceOf(_puppet), 399e18, "the user account sells, its shares locked in place");
        assertEq(fundStore.getRedemption(body).queued, 399e18);
        assertEq(_queuedOf(_puppet), 399e18, "the sold shares are queued for the user account");
    }

    function test_fundSwap_admits_only_a_body_on_hub_and_spoke() public {
        _openFund();
        address _parent = _account(master);
        uint _nonce = _nonceOf(_parent);
        Deposit.SwapIntent memory _i = _swapIntent(_parent, _nonce, _parent, 400e6, block.chainid);
        bytes memory _sig = _swapSig(FUND_SWAP_INTENT_TYPEHASH, masterKey, _parent, _i);
        AccountLib.Genesis memory _none = AccountLib.Genesis({parent: address(0), key: "", approval: ""});
        bytes memory _refused = abi.encodeWithSelector(Error.Account__NotDelegated.selector, _parent);
        vm.expectRevert(_refused);
        hub.fundSwap(_i, _sig, _none);
        vm.expectRevert(_refused);
        spoke.fundSwap(_i, _sig, _none);
        assertEq(usdc.balanceOf(_parent), 1500e6);
        assertEq(outToken.balanceOf(_parent), 0);
        assertEq(_nonceOf(_parent), _nonce);

        _fundSwapCall(LiquidityGate(address(hub)), master, masterKey, body, 200e6);
        _fundSwapCall(LiquidityGate(address(spoke)), master, masterKey, body, 200e6);
        assertEq(outToken.balanceOf(body), 2e18, "the body swaps on hub and spoke");
        assertEq(usdc.balanceOf(body), 499e6 - 400e6);
        assertEq(_nonceOf(body), 3);
    }

    function test_swap_paths_refuse_unbacked_and_malformed_swaps_on_hub_and_spoke() public {
        _openFund();
        address _parent = _account(master);
        uint _nonce = _nonceOf(_parent);
        uint _bodyNonce = _nonceOf(body);
        uint _parentUsdc = usdc.balanceOf(_parent);
        uint _bodyUsdc = usdc.balanceOf(body);
        AccountLib.Genesis memory _none = AccountLib.Genesis({parent: address(0), key: "", approval: ""});
        LiquidityGate[2] memory _gates = [LiquidityGate(address(hub)), LiquidityGate(address(spoke))];
        for (uint _g; _g < 2; ++_g) {
            LiquidityGate _gate = _gates[_g];

            Deposit.SwapIntent memory _i = _swapIntent(_parent, _nonce, _parent, 100e6, block.chainid);
            _i.swap.providerCallData =
                abi.encodeCall(MockSwapProvider.swap, (address(usdc), 100e6 - FEE, address(outToken), 1e18 - 1, _parent));
            bytes memory _sig = _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(abi.encodeWithSelector(Error.Balance__DepositNotReceived.selector, address(outToken), 1e18 - 1, 1e18));
            _gate.depositAcross(_i, _sig);

            _i.swap.providerCallData =
                abi.encodeCall(MockSwapProvider.swap, (address(usdc), 100e6 - FEE - 1, address(outToken), 1e18, _parent));
            _sig = _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(
                abi.encodeWithSelector(Error.Balance__SwapInputNotSpent.selector, address(usdc), _parentUsdc, _parentUsdc - 100e6 + 1)
            );
            _gate.depositAcross(_i, _sig);

            _i = _swapIntent(_parent, _nonce, _parent, 100e6, block.chainid);
            _i.header.feeToken = address(wnt);
            _sig = _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(abi.encodeWithSelector(Error.Intent__FeeTokenMismatch.selector, address(wnt), address(usdc)));
            _gate.depositAcross(_i, _sig);

            _i = _swapIntent(_parent, _nonce, _parent, 100e6, block.chainid);
            _i.swap.inputAmount = 0;
            _sig = _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(Error.Balance__NothingToSwap.selector);
            _gate.depositAcross(_i, _sig);

            _i = _swapIntent(_parent, _nonce, _parent, 100e6, block.chainid);
            _i.swap.outputAmount = 0;
            _sig = _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(Error.Balance__ZeroSwapOutput.selector);
            _gate.depositAcross(_i, _sig);

            _i = _swapIntent(_parent, _nonce, _parent, 100e6, block.chainid);
            _i.swap.provider = address(0);
            _sig = _swapSig(DEPOSIT_ACROSS_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(Error.Intent__InvalidProvider.selector);
            _gate.depositAcross(_i, _sig);

            _i = _swapIntent(body, _bodyNonce, body, 100e6, block.chainid);
            _i.swap.providerCallData =
                abi.encodeCall(MockSwapProvider.swap, (address(usdc), 100e6 - FEE, address(outToken), 1e18 - 1, body));
            _sig = _swapSig(FUND_SWAP_INTENT_TYPEHASH, masterKey, body, _i);
            vm.expectRevert(abi.encodeWithSelector(Error.Balance__SwapOutputNotReceived.selector, address(outToken), 1e18 - 1, 1e18));
            _gate.fundSwap(_i, _sig, _none);

            _i.swap.providerCallData =
                abi.encodeCall(MockSwapProvider.swap, (address(usdc), 100e6 - FEE - 1, address(outToken), 1e18, body));
            _sig = _swapSig(FUND_SWAP_INTENT_TYPEHASH, masterKey, body, _i);
            vm.expectRevert(
                abi.encodeWithSelector(Error.Balance__SwapInputNotSpent.selector, address(usdc), _bodyUsdc, _bodyUsdc - 100e6 + 1)
            );
            _gate.fundSwap(_i, _sig, _none);

            _i = _swapIntent(body, _bodyNonce, body, 100e6, block.chainid);
            _i.swap.outputToken = address(usdc);
            _sig = _swapSig(FUND_SWAP_INTENT_TYPEHASH, masterKey, body, _i);
            vm.expectRevert(Error.Balance__InvalidSwap.selector);
            _gate.fundSwap(_i, _sig, _none);

            _i = _swapIntent(_parent, _nonce, master, 100e6, block.chainid);
            _i.swap.providerCallData =
                abi.encodeCall(MockSwapProvider.swap, (address(usdc), 100e6 - FEE, address(outToken), 1e18 - 1, master));
            _sig = _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(abi.encodeWithSelector(Error.Balance__SwapOutputNotReceived.selector, address(outToken), 1e18 - 1, 1e18));
            _gate.withdraw(_i, _sig);

            _i = _swapIntent(_parent, _nonce, master, 100e6, block.chainid);
            _i.swap = SwapLib.SwapParams({
                inputToken: address(usdc),
                inputAmount: 100e6,
                outputToken: address(usdc),
                outputAmount: 100e6 - FEE - 1,
                provider: address(0),
                providerCallData: ""
            });
            _sig = _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(Error.Balance__InvalidWithdraw.selector);
            _gate.withdraw(_i, _sig);

            _i.swap.inputAmount = 0;
            _sig = _swapSig(WITHDRAW_INTENT_TYPEHASH, masterKey, _parent, _i);
            vm.expectRevert(Error.Balance__NothingToWithdraw.selector);
            _gate.withdraw(_i, _sig);
        }
        vm.deal(master, 1);
        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__ValueMismatch.selector, 1, 0));
        hub.deposit{value: 1}(address(usdc), 100e6);

        assertEq(usdc.balanceOf(_parent), _parentUsdc, "no refused swap moved the account's balance");
        assertEq(usdc.balanceOf(body), _bodyUsdc, "nor the body's");
        assertEq(outToken.balanceOf(master), 0, "and nothing reached the wallet");
        assertEq(_nonceOf(_parent), _nonce, "while every refused intent left the nonces unspent");
        assertEq(_nonceOf(body), _bodyNonce);
    }

    function test_operate_admits_only_a_body() public {
        _openFund();
        address _parent = _account(master);
        address _venue = makeAddr("venue");
        IAccount.Call[] memory _callList = new IAccount.Call[](1);
        _callList[0] = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: 200_000,
            callData: abi.encodeCall(IERC20.transfer, (_venue, 50e6))
        });
        uint _nonce = _nonceOf(_parent);
        (SpokeGate.OperateIntent memory _i, bytes memory _sig) =
            _operateIntent(_parent, master, masterKey, _nonce, _callList);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NotDelegated.selector, _parent));
        spoke.operate(_i, _sig, AccountLib.Genesis({parent: address(0), key: "", approval: ""}));
        assertEq(usdc.balanceOf(_venue), 0, "a user account runs no generic call list");
        assertEq(usdc.balanceOf(_parent), 1500e6);
        assertEq(_nonceOf(_parent), _nonce);

        _operate(_callList);
        assertEq(usdc.balanceOf(_venue), 50e6, "the body operates");
        assertEq(usdc.balanceOf(body), 499e6 - 50e6 - FEE);
        assertEq(_nonceOf(body), 2);
    }

    function test_a_fund_body_takes_safe_nft_transfers_that_a_user_account_refuses() public {
        address _holder = makeAddr("nft-holder");
        address _ua = _account(master);
        AccountKindsTestCollectible _collectible = new AccountKindsTestCollectible();
        AccountKindsTestEdition _edition = new AccountKindsTestEdition();
        _collectible.mint(_holder, 1);
        _collectible.mint(_holder, 2);
        _edition.mint(_holder, 7, 20);
        _edition.mint(_holder, 8, 20);
        _edition.mint(_holder, 9, 20);
        uint[] memory _ids = new uint[](2);
        _ids[0] = 8;
        _ids[1] = 9;
        uint[] memory _amounts = new uint[](2);
        _amounts[0] = 5;
        _amounts[1] = 6;
        assertEq(body.codehash, accountModule.bodyHash(), "the receiver is a wallet delegated to the fund body");

        vm.startPrank(_holder);
        _collectible.safeTransferFrom(_holder, body, 1);
        _edition.safeTransferFrom(_holder, body, 7, 4, "");
        _edition.safeBatchTransferFrom(_holder, body, _ids, _amounts, "");
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, _ua));
        _collectible.safeTransferFrom(_holder, _ua, 2);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InvalidReceiver.selector, _ua));
        _edition.safeTransferFrom(_holder, _ua, 7, 1, "");
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InvalidReceiver.selector, _ua));
        _edition.safeBatchTransferFrom(_holder, _ua, _ids, _amounts, "");
        vm.stopPrank();

        assertEq(_collectible.ownerOf(1), body, "the body takes a position NFT by safe transfer");
        assertEq(_edition.balanceOf(body, 7), 4, "and a multi-token position");
        assertEq(_edition.balanceOf(body, 8), 5, "one by one or in a batch");
        assertEq(_edition.balanceOf(body, 9), 6);
        assertEq(_collectible.ownerOf(2), _holder, "while a user account, which holds no venue position, refuses them");
        assertEq(_edition.balanceOf(_ua, 7) + _edition.balanceOf(_ua, 8) + _edition.balanceOf(_ua, 9), 0);
    }

    function test_the_hub_binds_a_body_only_by_opening_its_fund() public {
        address _parent = _account(master);
        Deposit.SwapIntent memory _swap = _swapIntent(body, 0, body, 100e6, block.chainid);
        bytes memory _signed = _swapSig(FUND_SWAP_INTENT_TYPEHASH, masterKey, body, _swap);
        bytes32 _g = AccountLib.genesisDigest(address(accountModule), body, _parent);
        AccountLib.Genesis memory _genesis =
            AccountLib.Genesis({parent: _parent, key: _coSig(bodyKey, _g), approval: _fundApproval(masterKey, body)});
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
        hub.fundSwap(_swap, _signed, _genesis);
        (address _module,) = FundAccount(payable(body)).bound();
        assertEq(_module, address(0), "a hub swap with a valid genesis leaves the body unbound");

        _openFund();
        (_module,) = FundAccount(payable(body)).bound();
        assertEq(_module, address(accountModule), "so the fund still opens, and its opening is what binds the body");
    }

    function test_createFund_and_allocate_admit_only_a_body() public {
        address _parent = _account(master);
        (Fund.AllocateIntent memory _open, bytes memory _openSig) =
            _allocateFor(_parent, _credit(block.chainid, address(usdc), 500e6));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), _parent, _parent);
        bytes memory _refused = abi.encodeWithSelector(Error.Account__NotDelegated.selector, _parent);
        bytes memory _ownerSig = _ownerCoSig(_open);
        vm.expectRevert(_refused);
        hub.createFund(
            bytes32("KND"), new bytes(GRID_BYTES), _coSig(masterKey, _genesis), _coSig(masterKey, _genesis), _open, _openSig, _ownerSig
        );

        _openFund();
        (address _module, address _bound) = FundAccount(payable(body)).bound();
        assertEq(_module, address(accountModule), "createFund binds the delegated body");
        assertEq(_bound, _parent);

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 100e6));
        hub.allocate(_i, _sig, _ownerSig);
        assertEq(usdc.balanceOf(_parent), 1500e6, "a local credit draws only on the owner's hub escrow, never its account");

        _retireEscrow(LiquidityGate(address(hub)), hubEscrowStore, address(usdc), 100e6);
        uint _held = usdc.balanceOf(_parent);
        uint _ownerNonce = _nonceOf(_parent);
        (_i, _sig) = _allocateFor(_parent, _credit(block.chainid, address(usdc), 100e6));
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(_refused);
        hub.allocate(_i, _sig, _ownerSig);
        assertEq(shareToken.balanceOf(_parent), 0, "a user account mints no shares for itself");
        assertEq(usdc.balanceOf(_parent), _held, "and nothing leaves it");
        assertEq(hubEscrowStore.releasedMap(_parent, address(usdc)), 500e6, "nor its hub escrow");

        (_i, _sig) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        _ownerSig = _ownerCoSig(_i);
        vm.recordLogs();
        hub.allocate(_i, _sig, _ownerSig);
        (bytes32 _digest, bytes memory _signature, bytes memory _executionData,) = _record(_parent, address(fundModule));
        assertEq(shareToken.balanceOf(body), 598e18, "the body allocates");
        assertEq(usdc.balanceOf(body), 598e6);
        assertEq(
            hubEscrowStore.releasedMap(_parent, address(usdc)), 600e6, "the owner contribution is released from its hub escrow"
        );
        assertEq(usdc.balanceOf(_parent), _held, "the round itself leaves the owner account alone");
        assertEq(_nonceOf(_parent), _ownerNonce, "and spends none of its nonces");
        assertEq(
            _digest,
            AccountLib.creditDigest(_parent, body, block.chainid, address(usdc), _i.credit.total, _i.credit.feeTotal),
            "the owner's consent is its signed running total, recorded on its own account"
        );
        assertEq(_signature.length, 0);
        assertEq(_executionData, abi.encode(Fund.allocate.selector, body, _i.credit), "naming the fund and its signed totals");
    }

    function test_redeem_admits_only_a_body() public {
        _openFund();
        address _parent = _account(master);
        (Redeem.RedeemIntent memory _i, bytes memory _sig) = _redeemFor(_parent, 249.5e18);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NotDelegated.selector, _parent));
        hub.redeem(_i, _sig, new address[](0));
        assertEq(shareToken.balanceOf(body), 499e18);

        _wethTo(body, 3000 ether);
        uint _relayed = wnt.balanceOf(feeReceiver);
        uint _ownerHeld = wnt.balanceOf(_ownerAccount());
        uint _halfInWeth = _nav() * 1e18 / ETH_USD / 2;
        (_i, _sig) = _redeemFor(body, 249.5e18);
        hub.redeem(_i, _sig, new address[](0));
        assertEq(shareToken.totalSupply(), 249.5e18, "the master's part burns at the open");
        assertEq(shareToken.balanceOf(body), 249.5e18);
        assertEq(usdc.balanceOf(body), 499e6, "the fund keeps its USDC, the payout is WETH");
        assertEq(usdc.balanceOf(_parent), 1500e6, "the owner account is untouched");
        assertGt(wnt.balanceOf(feeReceiver), _relayed, "the relay fee is billed in WETH");
        assertApproxEqRel(
            wnt.balanceOf(_ownerAccount()) - _ownerHeld + wnt.balanceOf(feeReceiver) - _relayed,
            _halfInWeth,
            1e12,
            "the owner's account is paid half the fund in WETH, net of the relay fee"
        );
        uint _signed = _valueOf(_i.valuation) + VIRTUAL_VALUE;
        uint _base = 499e18 + VIRTUAL_SHARES;
        assertEq(
            wnt.balanceOf(_ownerAccount()) - _ownerHeld + wnt.balanceOf(feeReceiver) - _relayed,
            Math.mulDiv(249.5e18, _signed, _base),
            "exactly the master's part at the open's price"
        );
        assertEq(fundStore.getRedemption(body).price, _signed * PRICE_PRECISION / _base, "which the open records");
        assertEq(_nonceOf(body), 2);
    }

    function test_every_body_entry_refuses_a_contract_posing_as_a_bound_body() public {
        address _victim = _account(master);
        _depositEscrow(address(usdc), 100e6);
        AccountKindsTestFakeBody _fake = new AccountKindsTestFakeBody(address(accountModule), _victim);
        (address _mimic, uint _mimicKey) = makeAddrAndKey("mimic");
        vm.signAndAttachDelegation(address(_fake), _mimicKey);
        (address _stray, uint _strayKey) = makeAddrAndKey("stray-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _strayKey);
        vm.prank(address(_fake));
        FundAccount(payable(_stray))
            .genesis(_victim, _coSig(_strayKey, AccountLib.genesisDigest(address(_fake), _stray, _victim)));
        address[3] memory _posers = [address(_fake), _mimic, _stray];
        for (uint _k; _k < 2; ++_k) {
            (address _module, address _parent) = FundAccount(payable(_posers[_k])).bound();
            assertEq(_module, address(accountModule), "the poser claims the real module");
            assertEq(_parent, _victim, "and the victim as its parent");
            assertEq(IAccount(_posers[_k]).user(), master, "answering for the victim's wallet");
            assertTrue(_posers[_k].codehash != accountModule.bodyHash(), "but is not the body designator");
        }
        (address _strayModule, address _strayParent) = FundAccount(payable(_stray)).bound();
        assertEq(_stray.codehash, accountModule.bodyHash(), "the stray is a real body");
        assertEq(_strayModule, address(_fake), "bound by another module");
        assertEq(_strayParent, _victim, "to the victim, without the victim's approval");

        vm.recordLogs();
        for (uint _k; _k < 3; ++_k) {
            address _poser = _posers[_k];
            Deposit.SwapIntent memory _swap = _swapIntent(_poser, 0, _poser, 100e6, block.chainid);
            bytes memory _swapSigned = _swapSig(FUND_SWAP_INTENT_TYPEHASH, masterKey, _poser, _swap);
            AccountLib.Genesis memory _genesis = AccountLib.Genesis({parent: _victim, key: "", approval: ""});
            (SpokeGate.OperateIntent memory _op, bytes memory _opSig) =
                _operateIntent(_poser, master, masterKey, 0, new IAccount.Call[](0));
            (Fund.AllocateIntent memory _alloc, bytes memory _allocSig) =
                _allocateFor(_poser, _credit(block.chainid, address(usdc), 100e6));
            (Redeem.RedeemIntent memory _red, bytes memory _redSig) = _redeemFor(_poser, 1e6);
            bytes memory _fulfilSig =
                _coSig(masterKey, AccountLib.creditDigest(_victim, _poser, block.chainid, address(usdc), 100e6, FEE));
            bytes memory _refused = _k < 2
                ? abi.encodeWithSelector(Error.Account__NotDelegated.selector, _poser)
                : abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, _poser);
            vm.expectRevert(_refused);
            hub.fundSwap(_swap, _swapSigned, _genesis);
            vm.expectRevert(_refused);
            spoke.fundSwap(_swap, _swapSigned, _genesis);
            vm.expectRevert(_refused);
            spoke.operate(_op, _opSig, _genesis);
            vm.expectRevert(_refused);
            spoke.fulfil(_poser, address(usdc), 100e6, FEE, _fulfilSig, _genesis);
            bytes memory _ownerSig = _ownerCoSig(_alloc);
            vm.expectRevert(_refused);
            hub.allocate(_alloc, _allocSig, _ownerSig);
            vm.expectRevert(_refused);
            hub.redeem(_red, _redSig, new address[](0));
            _ownerSig = _ownerCoSig(_alloc);
            vm.expectRevert(_k < 2 ? _refused : abi.encodeWithSelector(Error.Account__AlreadyCreated.selector));
            hub.createFund(bytes32("FAKE"), new bytes(GRID_BYTES), "", "", _alloc, _allocSig, _ownerSig);
        }
        assertEq(vm.getRecordedLogs().length, 0, "no AccountCall, nor any other log, was written");
        assertEq(spokeEscrowStore.releasedMap(_victim, address(usdc)), 0, "the victim's spoke escrow named by the posers stays whole");
        assertEq(usdc.balanceOf(address(spokeEscrowStore)), 100e6);
        for (uint _k; _k < 3; ++_k) {
            (uint64 _block, bytes24 _tip) = accountModule.accountTipMap(_posers[_k]);
            assertEq(_block, 0, "the poser has no chronicle tip");
            assertEq(_tip, bytes24(0));
        }
    }

    function test_the_wallet_grant_naming_a_fund_approves_it_for_good_and_acts_as_a_session_while_live() public {
        (address _fresh, uint _freshKey) = makeAddrAndKey("granted-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _freshKey);
        address _owner = _account(master);
        UserAccount _ua = UserAccount(payable(_owner));
        usdc.mint(_fresh, 10e6);
        IAccount.Call[] memory _callList = new IAccount.Call[](1);
        _callList[0] = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: 200_000,
            callData: abi.encodeCall(IERC20.transfer, (makeAddr("granted-venue"), 3e6))
        });
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), _fresh, _owner);
        bytes memory _approval = _fundApproval(masterKey, _fresh);
        (address _signer, uint _issuedAt, uint _expiry, uint _epoch, bytes memory _grant) =
            abi.decode(_approval, (address, uint, uint, uint, bytes));
        bytes32 _intent = keccak256("granted intent");
        bytes memory _session =
            abi.encode(_signer, _issuedAt, _expiry, _epoch, _fresh, _grant, _coSig(masterKey + 1, _intent));
        assertTrue(_ua.approves(_intent, _session), "the grant that names the fund is also the live session");

        (SpokeGate.OperateIntent memory _i, bytes memory _sig) = _operateIntent(_fresh, master, masterKey, 0, _callList);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.operate(
            _i,
            _sig,
            AccountLib.Genesis({parent: _owner, key: _coSig(_freshKey, _genesis), approval: _fundApproval(masterKey, body)})
        );
        (, uint _sessionKey) = makeAddrAndKey("granted-session");
        bytes memory _sessionSigned = _sessionBlob(masterKey, _sessionKey, _issuedAt, _expiry, 0, _genesis);
        vm.expectRevert();
        spoke.operate(
            _i, _sig, AccountLib.Genesis({parent: _owner, key: _coSig(_freshKey, _genesis), approval: _sessionSigned})
        );

        vm.warp(_expiry + MAX_SESSION_TTL);
        vm.prank(master);
        _ua.revokeSessions();
        assertFalse(_ua.approves(_intent, _session), "its session part lapses and is revoked");
        (_i, _sig) = _operateIntent(_fresh, master, masterKey, 0, _callList);
        spoke.operate(
            _i, _sig, AccountLib.Genesis({parent: _owner, key: _coSig(_freshKey, _genesis), approval: _approval})
        );
        (, address _parent) = FundAccount(payable(_fresh)).bound();
        assertEq(_parent, _owner, "while its fund approval still binds the fund, on any chain and at any time");
    }

    function test_first_operate_binds_a_fresh_body_to_its_parent() public {
        (address _fresh, uint _freshKey) = makeAddrAndKey("fresh-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _freshKey);
        FundAccount _body = FundAccount(payable(_fresh));
        (address _module, address _parent) = _body.bound();
        assertEq(_module, address(0), "a fresh body is unbound");
        assertEq(_parent, address(0));
        assertEq(_body.nonce(), 0);

        address _owner = _account(master);
        address _stranger = _account(backer);
        usdc.mint(_fresh, 10e6);
        address _venue = makeAddr("fresh-venue");
        IAccount.Call[] memory _callList = new IAccount.Call[](1);
        _callList[0] = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: 200_000,
            callData: abi.encodeCall(IERC20.transfer, (_venue, 3e6))
        });
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), _fresh, _owner);
        bytes32 _strangerGenesis = AccountLib.genesisDigest(address(accountModule), _fresh, _stranger);
        AccountLib.Genesis memory _signed = AccountLib.Genesis({
            parent: _owner, key: _coSig(_freshKey, _genesis), approval: _fundApproval(masterKey, _fresh)
        });
        AccountLib.Genesis memory _foreign = AccountLib.Genesis({
            parent: _stranger, key: _coSig(_freshKey, _strangerGenesis), approval: _fundApproval(backerKey, _fresh)
        });
        (SpokeGate.OperateIntent memory _i, bytes memory _sig) = _operateIntent(_fresh, master, masterKey, 0, _callList);
        (SpokeGate.OperateIntent memory _late, bytes memory _lateSig) =
            _operateIntent(_fresh, master, masterKey, 1, _callList);
        (Fund.AllocateIntent memory _a, bytes memory _aSig) =
            _allocateFor(_fresh, _credit(block.chainid, address(usdc), 10e6));
        bytes memory _mismatch = abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, _fresh);

        bytes memory _ownerSig = _ownerCoSig(_a);
        vm.expectRevert(_mismatch);
        hub.allocate(_a, _aSig, _ownerSig);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.operate(
            _i, _sig, AccountLib.Genesis({parent: _owner, key: _coSig(bodyKey, _genesis), approval: _signed.approval})
        );
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.operate(
            _i, _sig, AccountLib.Genesis({parent: _owner, key: _signed.key, approval: _fundApproval(backerKey, _fresh)})
        );
        vm.expectRevert(_mismatch);
        spoke.operate(_i, _sig, _foreign);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, _fresh, 0, 1));
        spoke.operate(_late, _lateSig, _signed);
        (_module, _parent) = _body.bound();
        assertEq(_module, address(0), "every refused genesis left the body unbound");

        vm.recordLogs();
        spoke.operate(_i, _sig, _signed);
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        (_module, _parent) = _body.bound();
        assertEq(_module, address(accountModule), "the first operate binds the body to the module");
        assertEq(_parent, _owner, "and to the approving parent");
        assertEq(_body.user(), master);
        assertEq(_body.nonce(), 1, "the opening intent ran at nonce 0");
        assertEq(usdc.balanceOf(_venue), 3e6);
        assertEq(usdc.balanceOf(_fresh), 10e6 - 3e6 - FEE);

        uint _records;
        for (uint _j; _j < _logs.length; ++_j) {
            if (
                _logs[_j].topics[0] != AccountModule.AccountCall.selector
                    || _logs[_j].topics[1] != bytes32(uint(uint160(_fresh)))
            ) continue;
            assertEq(_logs[_j].topics[2], bytes32(uint(uint160(address(spoke)))), "the spoke is the source");
            (,,, bytes32 _digest, bytes memory _signature, bytes memory _executionData, IAccount.Call[] memory _calls,,)
            = abi.decode(
                _logs[_j].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
            );
            if (_records == 0) {
                assertEq(_digest, _genesis, "the genesis record carries the genesis digest");
                assertEq(_signature, _signed.key, "and the body key signature");
                assertEq(_executionData, abi.encode(AccountModule.createAccount.selector, _owner));
                assertEq(_calls.length, 0);
            } else {
                assertEq(_signature, _sig, "the operate record carries the co-signature");
                assertEq(_executionData, abi.encode(SpokeGate.operate.selector, address(usdc), FEE));
                assertEq(_calls.length, 2);
            }
            ++_records;
        }
        assertEq(_records, 2, "genesis then operate, in that order");

        vm.prank(address(accountModule));
        vm.expectRevert(Error.Account__AlreadyCreated.selector);
        _body.genesis(_stranger, _foreign.key);
        (SpokeGate.OperateIntent memory _hijack, bytes memory _hijackSig) =
            _operateIntent(_fresh, backer, backerKey, 1, _callList);
        vm.expectRevert(_mismatch);
        spoke.operate(_hijack, _hijackSig, _foreign);
        (_module, _parent) = _body.bound();
        assertEq(_parent, _owner, "a bound body is never rebound");
    }

    function test_body_erc1271_answers_only_to_its_own_key() public {
        _openFund();
        (, uint _sessionKey) = makeAddrAndKey("session");
        AccountKindsTestAuthToken _token = new AccountKindsTestAuthToken();
        _token.mint(body, 100e6);
        bytes32 _digest = _token.authorizationDigest(body, master, 100e6);
        uint _now = vm.getBlockTimestamp();
        bytes memory _wallet = _coSig(masterKey, _digest);
        bytes memory _blob = _sessionBlob(masterKey, _sessionKey, _now, _now + 1 days, 0, _digest);
        UserAccount _parent = UserAccount(payable(_account(master)));
        assertTrue(_parent.approves(_digest, _wallet), "the parent honours its wallet");
        assertTrue(_parent.approves(_digest, _blob), "and its session");

        FundAccount _fund = FundAccount(payable(body));
        assertEq(_fund.isValidSignature(_digest, _coSig(bodyKey, _digest)), IERC1271.isValidSignature.selector);
        assertEq(_fund.isValidSignature(_digest, _wallet), bytes4(0xffffffff), "the master wallet is not the body");
        assertEq(_fund.isValidSignature(_digest, _blob), bytes4(0xffffffff), "a session blob is not the body");
        assertEq(_fund.isValidSignature(_digest, _coSig(_sessionKey, _digest)), bytes4(0xffffffff));
        assertEq(_fund.isValidSignature(_digest, _coSig(attestorKey, _digest)), bytes4(0xffffffff));
        assertEq(_fund.isValidSignature(_digest, _pair(masterKey, _digest)), bytes4(0xffffffff));

        vm.expectRevert(AccountKindsTestAuthToken.InvalidAuthorization.selector);
        _token.transferWithAuthorization(body, master, 100e6, _wallet);
        vm.expectRevert(AccountKindsTestAuthToken.InvalidAuthorization.selector);
        _token.transferWithAuthorization(body, master, 100e6, _blob);
        IAccount.Call[] memory _drain = new IAccount.Call[](1);
        _drain[0] = IAccount.Call({
            target: address(_token), value: 0, gasLimit: 200_000, callData: abi.encodeCall(IERC20.transfer, (master, 100e6))
        });
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        _fund.execute(attestor, _digest, _now, _pair(masterKey, _digest), _drain);
        assertEq(_token.balanceOf(body), 100e6, "an outside verifier moved nothing on a master-side signature");

        _token.transferWithAuthorization(body, master, 100e6, _coSig(bodyKey, _digest));
        assertEq(_token.balanceOf(master), 100e6, "the body key itself is honoured");
        assertEq(_token.balanceOf(body), 0);
    }

    function test_user_account_offers_no_erc1271_to_outside_verifiers() public {
        address _ua = _account(master);
        (, uint _sessionKey) = makeAddrAndKey("session");
        AccountKindsTestAuthToken _token = new AccountKindsTestAuthToken();
        _token.mint(_ua, 100e6);
        bytes32 _digest = _token.authorizationDigest(_ua, master, 100e6);
        uint _now = vm.getBlockTimestamp();
        bytes memory _wallet = _coSig(masterKey, _digest);
        bytes memory _blob = _sessionBlob(masterKey, _sessionKey, _now, _now + 1 days, 0, _digest);
        assertTrue(UserAccount(payable(_ua)).approves(_digest, _wallet), "the protocol approval honours the wallet");
        assertTrue(UserAccount(payable(_ua)).approves(_digest, _blob), "and the session");

        (bool _ok, bytes memory _ret) = _ua.staticcall(abi.encodeCall(IERC1271.isValidSignature, (_digest, _wallet)));
        assertFalse(_ok, "the user account has no isValidSignature");
        assertEq(_ret.length, 0);
        (_ok, _ret) = _ua.staticcall(abi.encodeCall(IERC1271.isValidSignature, (_digest, _blob)));
        assertFalse(_ok);
        assertEq(_ret.length, 0);

        vm.expectRevert(AccountKindsTestAuthToken.InvalidAuthorization.selector);
        _token.transferWithAuthorization(_ua, master, 100e6, _wallet);
        vm.expectRevert(AccountKindsTestAuthToken.InvalidAuthorization.selector);
        _token.transferWithAuthorization(_ua, master, 100e6, _blob);
        IAccount.Call[] memory _drain = new IAccount.Call[](1);
        _drain[0] = IAccount.Call({
            target: address(_token), value: 0, gasLimit: 200_000, callData: abi.encodeCall(IERC20.transfer, (master, 100e6))
        });
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        IAccount(_ua).execute(attestor, _digest, _now, _pair(masterKey, _digest), _drain);
        assertEq(_token.balanceOf(_ua), 100e6, "an outside verifier cannot move user account funds");
        assertEq(_token.balanceOf(master), 0);
    }

    function test_a_contract_wallet_cosigns_with_a_signature_past_1024_bytes_under_the_4096_byte_cap() public {
        address[] memory _members = new address[](20);
        uint[] memory _keys = new uint[](20);
        for (uint _j; _j < 20; ++_j) {
            (_members[_j], _keys[_j]) = makeAddrAndKey(string.concat("council-", vm.toString(_j)));
        }
        (, uint _strangerKey) = makeAddrAndKey("council-stranger");
        address _wallet = address(new AccountKindsTestCouncilWallet(_members));
        _fundWallet(_wallet, 100e6);
        address _acct = _account(_wallet);
        Deposit.SwapIntent memory _i = Deposit.SwapIntent({
            header: _header(_acct, _wallet, _nonceOf(_acct)),
            destinationChainId: block.chainid,
            swap: SwapLib.SwapParams({
                inputToken: address(usdc),
                inputAmount: 40e6,
                outputToken: address(usdc),
                outputAmount: 40e6 - FEE,
                provider: address(0),
                providerCallData: ""
            })
        });
        bytes32 _digest = _typed(
            _acct,
            _i.header.deadline,
            keccak256(abi.encode(WITHDRAW_INTENT_TYPEHASH, _hashHeader(_i.header), _i.destinationChainId, _hashSwap(_i.swap)))
        );
        bytes memory _council;
        bytes memory _forged;
        for (uint _j; _j < 20; ++_j) {
            _council = bytes.concat(_council, _coSig(_keys[_j], _digest));
            _forged = bytes.concat(_forged, _coSig(_j == 19 ? _strangerKey : _keys[_j], _digest));
        }
        bytes memory _tagged = bytes.concat(WALLET_SIGNATURE_TAG, _council);
        assertGt(_tagged.length, 1024, "twenty members sign past the old 1024-byte cap");
        assertLe(_tagged.length, MAX_SESSION_BYTES, "and inside the new one");
        assertTrue(UserAccount(payable(_acct)).approves(_digest, _tagged), "the account hands the whole signature to the wallet");
        assertFalse(
            UserAccount(payable(_acct)).approves(_digest, bytes.concat(WALLET_SIGNATURE_TAG, _forged)),
            "while the wallet's own rule refuses a stranger in one member's place"
        );

        bytes memory _attested = _coSig(attestorKey, _digest);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.withdraw(_i, bytes.concat(WALLET_SIGNATURE_TAG, _forged, _attested));
        hub.withdraw(_i, bytes.concat(_tagged, _attested));
        assertEq(usdc.balanceOf(_wallet), 40e6 - FEE, "the council's long signature co-signs a withdraw");
        assertEq(_nonceOf(_acct), 1);
    }

    function test_approves_refuses_a_grant_to_signer_zero_and_an_envelope_past_the_cap() public {
        UserAccount _ua = UserAccount(payable(_account(master)));
        bytes32 _digest = keccak256("puppet intent");
        uint _now = vm.getBlockTimestamp();
        bytes memory _zeroGrant = _coSig(
            masterKey, AccountLib.sessionDigest(address(accountModule), master, address(0), _now, _now + 1 days, 0, address(0))
        );
        assertFalse(
            _ua.approves(_digest, abi.encode(address(0), _now, _now + 1 days, uint(0), address(0), _zeroGrant, bytes(""))),
            "a wallet grant to signer zero approves nothing, though empty inner bytes recover to zero"
        );
        (, uint _signerKey) = makeAddrAndKey("capped-session");
        bytes memory _live = _sessionBlob(masterKey, _signerKey, _now, _now + 1 days, 0, _digest);
        assertTrue(_ua.approves(_digest, _live), "a canonical envelope approves");
        assertFalse(
            _ua.approves(_digest, bytes.concat(_live, new bytes(MAX_SESSION_BYTES + 1 - _live.length))),
            "the same envelope padded past the cap does not"
        );
    }

    function test_user_approves_the_wallet_and_only_a_live_session() public {
        UserAccount _ua = UserAccount(payable(_account(master)));
        (address _signer, uint _signerKey) = makeAddrAndKey("session");
        bytes32 _digest = keccak256("puppet intent");
        uint _now = vm.getBlockTimestamp();

        assertTrue(_ua.approves(_digest, _coSig(masterKey, _digest)), "the wallet approves");
        assertFalse(_ua.approves(_digest, _coSig(backerKey, _digest)), "another wallet does not");
        assertFalse(_ua.approves(_digest, _coSig(_signerKey, _digest)), "a session key without a grant does not");
        assertTrue(
            _ua.approves(_digest, _sessionBlob(masterKey, _signerKey, _now - 1 days, _now + 1 days, 0, _digest)),
            "a live grant approves"
        );
        assertTrue(
            _ua.approves(_digest, _sessionBlob(masterKey, _signerKey, _now, _now, 0, _digest)),
            "issued now and expiring now is live"
        );
        assertFalse(
            _ua.approves(_digest, _sessionBlob(masterKey, _signerKey, _now + 1, _now + 1 days, 0, _digest)),
            "a future-issued grant is refused"
        );
        assertFalse(
            _ua.approves(_digest, _sessionBlob(masterKey, _signerKey, _now - 1 days, _now - 1, 0, _digest)),
            "an expired grant is refused"
        );
        assertTrue(
            _ua.approves(_digest, _sessionBlob(masterKey, _signerKey, _now, _now + MAX_SESSION_TTL, 0, _digest)),
            "a grant at the TTL edge approves"
        );
        assertFalse(
            _ua.approves(_digest, _sessionBlob(masterKey, _signerKey, _now, _now + MAX_SESSION_TTL + 1, 0, _digest)),
            "an over-TTL grant is refused"
        );
        assertFalse(
            _ua.approves(_digest, _sessionBlob(backerKey, _signerKey, _now, _now + 1 days, 0, _digest)),
            "a grant signed by another wallet is refused"
        );
        assertFalse(
            _ua.approves(_digest, _sessionBlob(masterKey, _signerKey, _now, _now + 1 days, 1, _digest)),
            "a grant for another epoch is refused"
        );

        bytes memory _live = _sessionBlob(masterKey, _signerKey, _now, _now + 1 days, 0, _digest);
        (,,,,, bytes memory _grant,) = abi.decode(_live, (address, uint, uint, uint, address, bytes, bytes));
        assertFalse(
            _ua.approves(_digest, abi.encode(_signer, _now, _now + 1 days, uint(0), address(0), _grant, _coSig(backerKey, _digest))),
            "the inner signature must come from the granted signer"
        );
        assertFalse(_ua.approves(keccak256("another intent"), _live), "and cover the digest");

        vm.prank(backer);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        _ua.revokeSessions();
        vm.prank(master);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), _epochAfterRevoke(0));
        assertTrue(_ua.epoch() != 0, "the revoke moves the account off the epoch its live grant names");
        assertTrue(_ua.approves(_digest, _live), "a retired grant still lands in-flight intents");
        vm.warp(_now + SESSION_REVOKE_DELAY - 1);
        assertTrue(_ua.approves(_digest, _live), "up to the last second of the revoke delay");
        vm.warp(_now + SESSION_REVOKE_DELAY);
        assertFalse(_ua.approves(_digest, _live), "and is refused once it has passed");
        assertTrue(
            _ua.approves(_digest, _sessionBlob(masterKey, _signerKey, _now, _now + 1 days, _ua.epoch(), _digest)),
            "a grant at the new epoch approves"
        );
        assertTrue(_ua.approves(_digest, _coSig(masterKey, _digest)), "the wallet outlives revocation");
    }
}
