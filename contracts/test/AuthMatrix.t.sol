// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {HubGate, MANDATE_INTENT_TYPEHASH, MAX_SKIN, PRICE_TYPEHASH, SELL_INTENT_TYPEHASH} from "src/HubGate.sol";
import {SpokeGate} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Deposit} from "src/core/Deposit.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {Fund, VIRTUAL_SHARES, VIRTUAL_VALUE} from "src/core/Fund.sol";
import {Redeem} from "src/core/Redeem.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {GRID_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib, ESCROW_RETURN_DELAY, SESSION_REVOKE_DELAY, WALLET_SIGNATURE_TAG} from "src/utils/AccountLib.sol";
import {MandateLib} from "src/utils/MandateLib.sol";
import {BalanceLib} from "src/utils/BalanceLib.sol";
import {Error} from "src/utils/Error.sol";
import {GateConfig} from "src/utils/GateConfig.sol";
import {
    DEPOSIT_ACROSS_INTENT_TYPEHASH,
    LiquidityGate,
    RETIRE_ESCROW_INTENT_TYPEHASH,
    WITHDRAW_INTENT_TYPEHASH
} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {SwapLib} from "src/utils/SwapLib.sol";
import {FULL_ACCESS} from "src/utils/auth/Access.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

import {RouterProxy} from "src/utils/RouterProxy.sol";
import {HotPathTest} from "./HotPath.t.sol";
import {MockMultisig1271} from "./mock/MockMultisig1271.t.sol";
import {MockWallet1271} from "./mock/MockWallet1271.t.sol";

contract AuthMatrixTestWallet {
    UserAccount internal immutable account;
    bool internal immutable swallow;
    bytes internal selfCall;
    bytes public caught;

    constructor(
        UserAccount _account,
        bool _swallow
    ) {
        account = _account;
        swallow = _swallow;
    }

    receive() external payable {
        (bool _ok, bytes memory _ret) = address(account).call(selfCall);
        if (_ok) return;
        if (!swallow) {
            assembly ("memory-safe") {
                revert(add(_ret, 32), mload(_ret))
            }
        }
        caught = _ret;
    }

    function arm(
        bytes calldata _selfCall
    ) external {
        selfCall = _selfCall;
    }
}

contract AuthMatrixTestFalseToken {
    mapping(address holder => uint) public balanceOf;
    mapping(address holder => mapping(address spender => uint)) public allowance;

    function mint(
        address _to,
        uint _amount
    ) external {
        balanceOf[_to] += _amount;
    }

    function transfer(
        address,
        uint
    ) external pure returns (bool) {
        return false;
    }

    function approve(
        address,
        uint
    ) external pure returns (bool) {
        return false;
    }
}

contract AuthMatrixTest is HotPathTest {
    function _shareOf(
        bytes32 _symbol,
        bytes memory _pixels
    ) internal view returns (ShareToken) {
        return ShareToken(
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
                                        abi.encodePacked(body, _symbol, _pixels, uint16(PERFORMANCE_FEE))
                                    )
                                )
                            )
                        )
                    )
                )
            )
        );
    }

    function _openFund() internal {
        _escrowOnHub(address(usdc), 500e6);
        bytes memory _pixels = new bytes(GRID_BYTES);
        shareToken = _shareOf(bytes32("AUTH"), _pixels);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(
            bytes32("AUTH"),
            _pixels,
            _coSig(bodyKey, _genesis),
            _fundApproval(masterKey, body),
            _i,
            _sig,
            _ownerCoSig(_i)
        );
    }

    function _rogueDrain(
        address _acct
    ) internal returns (address rogue_, IAccount.Call[] memory drain_) {
        rogue_ = makeAddr("rogue-dispatcher");
        vm.prank(address(governorAccount));
        accountModule.setAccess(rogue_, AccountModule.dispatch.selector);
        drain_ = new IAccount.Call[](1);
        drain_[0] = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: 200_000,
            callData: abi.encodeCall(IERC20.transfer, (rogue_, usdc.balanceOf(_acct)))
        });
    }

    function test_a_dispatcher_cannot_replay_a_landed_user_intent_and_only_the_current_nonce_executes() public {
        _fundWallet(backer, 100e6);
        address _acct = _account(backer);
        (Deposit.SwapIntent memory _w, bytes32 _structHash) = _usdcWithdraw(backer, _acct, 10e6);
        bytes memory _landed = _pair(backerKey, _typed(_acct, _w.header.deadline, _structHash));
        hub.withdraw(_w, _landed);

        (address _rogue, IAccount.Call[] memory _drain) = _rogueDrain(_acct);
        vm.prank(_rogue);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        accountModule.dispatch(
            IAccount(_acct), attestor, _structHash, _w.header.deadline, _landed, "", _drain, new address[](0)
        );
        assertEq(usdc.balanceOf(_rogue), 0, "a landed signature is spent: its nonce is behind the account");

        bytes memory _fresh = _pair(backerKey, _typed(_acct, _w.header.deadline, _structHash));
        vm.prank(_rogue);
        accountModule.dispatch(
            IAccount(_acct), attestor, _structHash, _w.header.deadline, _fresh, "", _drain, new address[](0)
        );
        assertEq(usdc.balanceOf(_acct), 0, "a signature over the current nonce is the only thing that executes");
    }

    function test_a_dispatcher_cannot_replay_a_landed_fund_intent() public {
        shareToken = _shareOf(bytes32("AUTH"), new bytes(GRID_BYTES));
        (Fund.AllocateIntent memory _opening, bytes memory _landed) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        _openFund();
        assertEq(_nonceOf(body), 1, "the opening round spent nonce zero");
        uint _held = usdc.balanceOf(body);

        (address _rogue, IAccount.Call[] memory _drain) = _rogueDrain(body);
        vm.prank(_rogue);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        accountModule.dispatch(
            IAccount(body),
            attestor,
            _allocateStructHash(_opening),
            _opening.header.deadline,
            _landed,
            "",
            _drain,
            new address[](0)
        );
        assertEq(usdc.balanceOf(body), _held, "the fund keeps everything");
    }

    function _backed() internal returns (uint shares_) {
        _openFund();
        _fundWallet(backer, 1000e6);
        MandateLib.Mandate[] memory _one = new MandateLib.Mandate[](1);
        _one[0] = MandateLib.Mandate({
            master: body,
            skin: MAX_SKIN,
            allocationRate: 5000,
            exitCap: 10_000,
            cooldownPeriod: 0,
            expiry: block.timestamp + 365 days
        });
        _mandate(backer, backerKey, _one);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = _row(_account(backer), 400e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        shares_ = shareToken.balanceOf(_account(backer));
    }

    function _session(
        uint _userKey,
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
                _userKey,
                AccountLib.sessionDigest(
                    address(accountModule), vm.addr(_userKey), _signer, _issuedAt, _expiry, _epoch, address(0)
                )
            ),
            _coSig(_signerKey, _digest)
        );
    }

    function _sellIntent(
        uint _shares
    ) internal view returns (Redeem.SellIntent memory i_, bytes32 digest_) {
        address _acct = accountModule.predictUserAccount(backer);
        i_ = Redeem.SellIntent({
            header: _header(_acct, backer, _nonceOf(_acct)), shareToken: shareToken, shares: _shares
        });
        i_.header.deadline = vm.getBlockTimestamp() + 300;
        digest_ = _typed(
            _acct,
            i_.header.deadline,
            keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(i_.header), i_.shareToken, i_.shares))
        );
    }

    function _etchedWallet(
        string memory _name,
        bytes memory _selfCall,
        bool _swallow
    ) internal returns (address user_, uint key_, UserAccount ua_) {
        (user_, key_) = makeAddrAndKey(_name);
        ua_ = UserAccount(payable(accountModule.predictUserAccount(user_)));
        vm.etch(user_, address(new AuthMatrixTestWallet(ua_, _swallow)).code);
        AuthMatrixTestWallet(payable(user_)).arm(_selfCall);
        vm.deal(user_, 1 ether);
        vm.prank(user_);
        hub.deposit{value: 1 ether}(NATIVE_TOKEN, 1 ether);
        _fundWallet(user_, 10e6);
    }

    function _usdcWithdraw(
        address _user,
        address _acct,
        uint _amount
    ) internal view returns (Deposit.SwapIntent memory i_, bytes32 structHash_) {
        i_ = Deposit.SwapIntent({
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
        i_.header.deadline = vm.getBlockTimestamp() + 300;
        structHash_ = keccak256(
            abi.encode(WITHDRAW_INTENT_TYPEHASH, _hashHeader(i_.header), i_.destinationChainId, _hashSwap(i_.swap))
        );
    }

    function _nativeWithdraw(
        address _user,
        uint _key,
        UserAccount _ua
    ) internal view returns (Deposit.SwapIntent memory i_, bytes memory sig_) {
        i_ = Deposit.SwapIntent({
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
        i_.header.feeToken = NATIVE_TOKEN;
        i_.header.fee = 1e15;
        i_.header.deadline = vm.getBlockTimestamp() + 300;
        sig_ = _swapSig(WITHDRAW_INTENT_TYPEHASH, _key, address(_ua), i_);
    }

    function test_session_blob_approves_a_relayed_sell() public {
        uint _shares = _backed();
        UserAccount _ua = UserAccount(payable(_account(backer)));
        (, uint _sessionKey) = makeAddrAndKey("session");
        uint _now = vm.getBlockTimestamp();
        (Redeem.SellIntent memory _i, bytes32 _d) = _sellIntent(_shares / 2);
        bytes memory _blob = _session(backerKey, _sessionKey, _now, _now + 1 days, 0, _d);

        assertTrue(_ua.approves(_d, _blob), "the protocol primitive honours the grant");
        assertFalse(
            SignatureCheckerLib.isValidERC1271SignatureNow(address(_ua), _d, _blob),
            "the grant is no world-facing ERC-1271 approval"
        );
        bytes memory _own = _coSig(backerKey, _d);
        assertTrue(_ua.approves(_d, _own), "the owner's plain signature is an approval");
        assertFalse(
            SignatureCheckerLib.isValidERC1271SignatureNow(address(_ua), _d, _own),
            "yet not even the owner's plain signature is a world-facing ERC-1271 approval"
        );
        (bool _ok, bytes memory _ret) = address(_ua).staticcall(abi.encodeCall(IERC1271.isValidSignature, (_d, _blob)));
        assertFalse(_ok, "the user account exposes no isValidSignature at all");
        assertEq(_ret.length, 0, "the probe hits no function, not a function that refuses");
        (_ok, _ret) = address(_ua).staticcall(abi.encodeCall(IERC1271.isValidSignature, (_d, _own)));
        assertFalse(_ok, "for the owner's plain signature either");
        assertEq(_ret.length, 0, "with no function to answer it");

        uint _nonce = _ua.nonce();
        uint _cash = usdc.balanceOf(address(_ua));
        uint _relay = usdc.balanceOf(feeReceiver);
        hub.sell(_i, bytes.concat(_blob, _coSig(attestorKey, _d)));
        assertEq(fundStore.getRedemption(body).queued, _shares / 2, "the sold shares wait in the queue");
        assertEq(shareToken.balanceOf(address(_ua)), _shares, "locked in the backer's own balance");
        assertEq(fundStore.getHolding(body, address(_ua)).queued, _shares / 2, "as its queue");
        assertEq(_ua.nonce(), _nonce + 1, "the sell consumed exactly one nonce");
        assertEq(usdc.balanceOf(address(_ua)), _cash - FEE, "the account paid exactly the relay fee");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "to the fee receiver");
    }

    function _walletSigned(
        uint _first,
        uint _second,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        return bytes.concat(WALLET_SIGNATURE_TAG, _coSig(_first, _digest), _coSig(_second, _digest));
    }

    function test_a_two_of_two_contract_wallet_mandates_joins_a_round_and_sells_with_its_own_signatures() public {
        _openFund();
        (, uint _a) = makeAddrAndKey("multisig-first");
        (, uint _b) = makeAddrAndKey("multisig-second");
        address _wallet = address(new MockMultisig1271(vm.addr(_a), vm.addr(_b)));
        _fundWallet(_wallet, 1000e6);
        address _acct = _account(_wallet);
        MandateLib.Mandate[] memory _one = new MandateLib.Mandate[](1);
        _one[0] = MandateLib.Mandate({
            master: body,
            skin: MAX_SKIN,
            allocationRate: 5000,
            exitCap: 10_000,
            cooldownPeriod: 0,
            expiry: block.timestamp + 365 days
        });
        HubGate.MandateIntent memory _m = HubGate.MandateIntent({
            header: _header(_acct, _wallet, _nonceOf(_acct)),
            epoch: UserAccount(payable(_acct)).epoch(),
            mandateList: _one
        });
        bytes32 _md = _typed(
            _acct,
            _m.header.deadline,
            keccak256(
                abi.encode(MANDATE_INTENT_TYPEHASH, _hashHeader(_m.header), _m.epoch, keccak256(abi.encode(_one)))
            )
        );

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.mandate(_m, bytes.concat(WALLET_SIGNATURE_TAG, _coSig(_a, _md), _coSig(attestorKey, _md)));
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.mandate(_m, bytes.concat(_walletSigned(_b, _a, _md), _coSig(attestorKey, _md)));

        hub.mandate(_m, bytes.concat(_walletSigned(_a, _b, _md), _coSig(attestorKey, _md)));
        assertEq(
            mandateStore.mandateMap(_acct, body),
            keccak256(abi.encode(_one[0], uint(0))),
            "both owners' signatures commit the mandate on the hub at the account's epoch"
        );

        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = Fund.Allocation({puppet: _acct, mandate: _one[0], amount: 400e6});
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        uint _cash = usdc.balanceOf(_acct);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _shares = shareToken.balanceOf(_acct);
        assertGt(_shares, 0, "the round pulled under the wallet-signed mandate");
        assertEq(_cash - usdc.balanceOf(_acct), 400e6, "exactly the row's amount");

        Redeem.SellIntent memory _s = Redeem.SellIntent({
            header: _header(_acct, _wallet, _nonceOf(_acct)), shareToken: shareToken, shares: _shares / 2
        });
        bytes32 _sd = _typed(
            _acct,
            _s.header.deadline,
            keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(_s.header), _s.shareToken, _s.shares))
        );
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_s, bytes.concat(_walletSigned(_a, _a, _sd), _coSig(attestorKey, _sd)));
        hub.sell(_s, bytes.concat(_walletSigned(_a, _b, _sd), _coSig(attestorKey, _sd)));
        assertEq(fundStore.getHolding(body, _acct).queued, _shares / 2, "both owners' signatures queued the sale");
    }

    function test_the_wallet_tag_routes_to_the_wallets_own_check_by_marker_not_by_length() public {
        bytes32 _d = keccak256("an intent the wallet is asked about");
        MockWallet1271 _approving = new MockWallet1271();
        MockWallet1271 _refusing = new MockWallet1271();
        _refusing.set(1, fundStore, address(0), address(0));
        UserAccount _yes = UserAccount(payable(_account(address(_approving))));
        UserAccount _no = UserAccount(payable(_account(address(_refusing))));

        bytes memory _short = bytes.concat(WALLET_SIGNATURE_TAG, bytes1(0x01), new bytes(32));
        assertEq(_short.length, 65, "a tagged blob as long as a plain signature");
        assertTrue(_yes.approves(_d, _short), "goes to the wallet that approves it");
        assertFalse(_no.approves(_d, _short), "and to the wallet that refuses it, never to signature recovery");

        (address _eoa, uint _eoaKey) = makeAddrAndKey("tagged-eoa");
        UserAccount _plain = UserAccount(payable(_account(_eoa)));
        assertFalse(
            _plain.approves(_d, bytes.concat(WALLET_SIGNATURE_TAG, _coSig(_eoaKey, _d))),
            "a wallet with no code approves nothing under the tag"
        );
        assertTrue(_plain.approves(_d, _coSig(_eoaKey, _d)), "while its plain signature still approves");
        assertFalse(
            _plain.approves(bytes32(uint(_d) + 1), bytes.concat(WALLET_SIGNATURE_TAG, _coSig(_eoaKey, _d))),
            "nor another digest"
        );
    }

    function test_a_signature_of_4096_bytes_is_the_cap_and_one_of_4097_bytes_approves_nothing() public {
        MockWallet1271 _wallet = new MockWallet1271();
        UserAccount _ua = UserAccount(payable(_account(address(_wallet))));
        (address _signer, uint _signerKey) = makeAddrAndKey("long-grant-session");
        bytes32 _d = keccak256("an intent under a long wallet grant");
        uint _now = vm.getBlockTimestamp();
        bytes memory _envelope =
            abi.encode(_signer, _now, _now + 1 days, uint(0), address(0), new bytes(3712), _coSig(_signerKey, _d));

        assertEq(_envelope.length, 4096, "a session envelope whose wallet grant fills it to 4096 bytes");
        assertTrue(_ua.approves(_d, _envelope), "approves at the cap");
        assertFalse(
            _ua.approves(_d, bytes.concat(_envelope, bytes1(0x01))),
            "and one byte past it approves nothing, though it decodes to the same grant"
        );
        assertTrue(
            _ua.approves(_d, bytes.concat(WALLET_SIGNATURE_TAG, new bytes(4096 - 32))),
            "a tagged wallet signature of 4096 bytes reaches the wallet"
        );
        assertFalse(
            _ua.approves(_d, bytes.concat(WALLET_SIGNATURE_TAG, new bytes(4097 - 32))),
            "and one of 4097 bytes approves nothing, even for a wallet that approves everything"
        );
    }

    function test_a_session_envelope_cut_below_nine_words_answers_false_instead_of_reverting() public {
        _fundWallet(backer, 100e6);
        address _acct = _account(backer);
        UserAccount _ua = UserAccount(payable(_acct));
        (, uint _sessionKey) = makeAddrAndKey("cut-session");
        uint _now = vm.getBlockTimestamp();
        (Deposit.SwapIntent memory _w, bytes32 _structHash) = _usdcWithdraw(backer, _acct, 20e6);
        bytes32 _d = _typed(_acct, _w.header.deadline, _structHash);
        bytes memory _live = _session(backerKey, _sessionKey, _now, _now + 1 days, 0, _d);
        assertTrue(_ua.approves(_d, _live), "the whole envelope approves");

        uint[5] memory _cuts = [uint(66), 128, 224, 256, 287];
        for (uint _k; _k < _cuts.length; ++_k) {
            bytes memory _cut = bytes.concat(_live);
            uint _length = _cuts[_k];
            assembly ("memory-safe") {
                mstore(_cut, _length)
            }
            assertFalse(_ua.approves(_d, _cut), "the same envelope cut below nine words answers false");
            bytes memory _pairWithCut = bytes.concat(_cut, _coSig(attestorKey, _d));
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.withdraw(_w, _pairWithCut);
        }
        assertEq(_nonceOf(_acct), 0, "so a relayed pair carrying one is refused as a bad signature and spends no nonce");

        hub.withdraw(_w, bytes.concat(_live, _coSig(attestorKey, _d)));
        assertEq(_nonceOf(_acct), 1, "while the whole envelope lands the same intent");
    }

    function test_a_grant_at_the_top_epoch_answers_false_without_overflowing() public {
        _fundWallet(backer, 100e6);
        address _acct = _account(backer);
        UserAccount _ua = UserAccount(payable(_acct));
        (, uint _sessionKey) = makeAddrAndKey("top-epoch-session");
        uint _now = vm.getBlockTimestamp();
        (Deposit.SwapIntent memory _w, bytes32 _structHash) = _usdcWithdraw(backer, _acct, 20e6);
        bytes32 _d = _typed(_acct, _w.header.deadline, _structHash);
        bytes memory _top = _session(backerKey, _sessionKey, _now, _now + 1 days, type(uint).max, _d);
        bytes memory _attest = _coSig(attestorKey, _d);

        assertFalse(_ua.approves(_d, _top), "a grant at the top epoch answers false at epoch zero");
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.withdraw(_w, bytes.concat(_top, _attest));

        vm.prank(backer);
        _ua.revokeSessions();
        assertTrue(
            _ua.approves(_d, _session(backerKey, _sessionKey, _now, _now + 1 days, 0, _d)),
            "the retired epoch still lands in flight"
        );
        assertFalse(_ua.approves(_d, _top), "while the top epoch still answers false beside it");
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.withdraw(_w, bytes.concat(_top, _attest));
        assertEq(_nonceOf(_acct), 0, "no top-epoch grant spent the nonce");

        hub.withdraw(_w, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 1 days, _ua.epoch(), _d), _attest));
        assertEq(_nonceOf(_acct), 1, "a grant at the current epoch lands the same intent");
    }

    function test_revoke_sessions_retires_the_epoch_zero_grant() public {
        uint _shares = _backed();
        UserAccount _ua = UserAccount(payable(_account(backer)));
        (, uint _sessionKey) = makeAddrAndKey("session");
        uint _now = vm.getBlockTimestamp();

        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        _ua.revokeSessions();

        vm.recordLogs();
        vm.prank(backer);
        _ua.revokeSessions();
        uint _epoch = _ua.epoch();
        assertEq(_epoch, _epochAfterRevoke(0), "the wallet's revoke advances the epoch");
        assertTrue(_epoch != 0, "off epoch zero");
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        assertEq(_logs.length, 1, "the revoke writes one record");
        assertEq(_logs[0].emitter, address(accountModule), "through the module");
        assertEq(_logs[0].topics[0], AccountModule.AccountCall.selector, "as an AccountCall");
        assertEq(_logs[0].topics[1], bytes32(uint(uint160(address(_ua)))), "for the account");
        assertEq(_logs[0].topics[2], bytes32(uint(uint160(address(_ua)))), "sourced from the account itself");
        (,,,,, bytes memory _executionData) = abi.decode(_logs[0].data, (uint, uint, uint, bytes32, bytes, bytes));
        assertEq(_executionData, abi.encode(UserAccount.revokeSessions.selector, _epoch), "carrying the new epoch");

        bytes32 _inFlight = keccak256("relayed before the revoke");
        assertTrue(
            _ua.approves(_inFlight, _session(backerKey, _sessionKey, _now, _now + 1 days, 0, _inFlight)),
            "the retired grant still lands intents already in flight"
        );
        vm.warp(_now + SESSION_REVOKE_DELAY);
        assertFalse(
            _ua.approves(_inFlight, _session(backerKey, _sessionKey, _now, _now + 1 days, 0, _inFlight)),
            "until the revoke delay has passed"
        );

        uint _nonce = _ua.nonce();
        (Redeem.SellIntent memory _i, bytes32 _d) = _sellIntent(_shares / 2);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(
            _i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d))
        );
        assertEq(_ua.nonce(), _nonce, "a refused approval consumes no nonce");

        hub.sell(
            _i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 1 days, _epoch, _d), _coSig(attestorKey, _d))
        );
        assertEq(fundStore.getRedemption(body).queued, _shares / 2, "a grant re-signed at the new epoch is honoured");
        assertEq(_ua.nonce(), _nonce + 1, "and consumes the nonce");
    }

    function test_a_grant_signed_for_a_guessed_next_epoch_never_wakes_up_at_the_revoke_while_one_at_the_epoch_read_after_it_lands()
        public
    {
        _fundWallet(backer, 100e6);
        address _acct = _account(backer);
        UserAccount _ua = UserAccount(payable(_acct));
        (, uint _sessionKey) = makeAddrAndKey("guessed-epoch-session");
        uint _start = vm.getBlockTimestamp();
        (Deposit.SwapIntent memory _w, bytes32 _structHash) = _usdcWithdraw(backer, _acct, 20e6);
        bytes32 _d = _typed(_acct, _w.header.deadline, _structHash);
        bytes memory _attest = _coSig(attestorKey, _d);
        uint _epoch = _ua.epoch();
        uint[2] memory _guesses = [_epoch + 1, _epochAfterRevoke(_epoch)];
        bytes[2] memory _guessed;
        for (uint _k; _k < _guesses.length; ++_k) {
            _guessed[_k] = _session(backerKey, _sessionKey, _start, _start + 30 days, _guesses[_k], _d);
            assertFalse(
                _ua.approves(_d, _guessed[_k]),
                "a grant the wallet signs for a guessed next epoch is refused before the revoke"
            );
        }

        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(_start + 12);
        vm.prank(backer);
        _ua.revokeSessions();
        uint _next = _ua.epoch();
        for (uint _k; _k < _guesses.length; ++_k) {
            assertFalse(_ua.approves(_d, _guessed[_k]), "the revoke does not wake it in the grace");
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.withdraw(_w, bytes.concat(_guessed[_k], _attest));
            assertTrue(_next != _guesses[_k], "since the revoke lands on an epoch no one could derive before it");
        }
        assertEq(_nonceOf(_acct), 0, "no guessed grant spent the nonce");
        hub.withdraw(_w, bytes.concat(_session(backerKey, _sessionKey, _start, _start + 30 days, _next, _d), _attest));
        assertEq(_nonceOf(_acct), 1, "while a grant signed at the epoch read after the revoke lands the same intent");

        vm.warp(_start + 12 + SESSION_REVOKE_DELAY);
        for (uint _k; _k < _guesses.length; ++_k) {
            assertFalse(_ua.approves(_d, _guessed[_k]), "nor once the grace is over");
        }
        assertTrue(
            _ua.approves(_d, _session(backerKey, _sessionKey, _start, _start + 30 days, _next, _d)),
            "where the grant at the epoch read after the revoke still approves"
        );
    }

    function test_session_expiry_is_capped_at_thirty_days() public {
        uint _shares = _backed();
        (, uint _sessionKey) = makeAddrAndKey("session");
        uint _now = vm.getBlockTimestamp();
        (Redeem.SellIntent memory _i, bytes32 _d) = _sellIntent(_shares / 4);
        bytes memory _attest = _coSig(attestorKey, _d);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 30 days + 1, 0, _d), _attest));
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now - 2, _now - 1, 0, _d), _attest));

        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 30 days, 0, _d), _attest));
        assertEq(fundStore.getRedemption(body).queued, _shares / 4, "a grant of exactly thirty days is honoured");

        uint _expiry = _now + 1 hours;
        vm.warp(_expiry);
        (_i, _d) = _sellIntent(_shares / 4);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _expiry, 0, _d), _coSig(attestorKey, _d)));
        assertEq(fundStore.getRedemption(body).queued, 2 * (_shares / 4), "a grant is live through its expiry second");

        vm.warp(_expiry + 1);
        (_i, _d) = _sellIntent(_shares / 4);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _expiry, 0, _d), _coSig(attestorKey, _d)));
    }

    function test_forward_dated_grant_is_refused() public {
        uint _shares = _backed();
        (, uint _sessionKey) = makeAddrAndKey("session");
        uint _now = vm.getBlockTimestamp();
        (Redeem.SellIntent memory _i, bytes32 _d) = _sellIntent(_shares / 2);
        bytes memory _attest = _coSig(attestorKey, _d);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now + 1, _now + 1 days, 0, _d), _attest));

        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 1 days, 0, _d), _attest));
        assertEq(fundStore.getRedemption(body).queued, _shares / 2, "a grant issued at the current second is honoured");
    }

    function test_parent_session_approves_a_body_allocate() public {
        _openFund();
        _escrowOnHub(address(usdc), 200e6);
        UserAccount _parent = UserAccount(payable(_account(master)));
        (, uint _sessionKey) = makeAddrAndKey("master-session");
        uint _now = vm.getBlockTimestamp();

        (Fund.AllocateIntent memory _i,) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        bytes32 _d = _allocateDigest(_i);
        uint _supply = shareToken.totalSupply();
        uint _held = shareToken.balanceOf(body);
        uint _cash = usdc.balanceOf(body);
        uint _relay = usdc.balanceOf(feeReceiver);
        uint _parentNonce = _parent.nonce();

        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(
            _i,
            bytes.concat(_session(bodyKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)),
            _ownerSig
        );

        hub.allocate(
            _i,
            bytes.concat(_session(masterKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)),
            _ownerSig
        );
        assertEq(
            shareToken.balanceOf(body) - _held,
            Math.mulDiv(100e6 * USD - FEE * USD, _supply + VIRTUAL_SHARES, _valueOf(_i.valuation) + VIRTUAL_VALUE),
            "the credit mints the master's shares at the signed valuation"
        );
        assertEq(
            usdc.balanceOf(body), _cash + 100e6 - FEE, "the released credit lands in the body net of the round fee"
        );
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "the round fee is billed once");
        assertEq(
            hubEscrowStore.releasedMap(address(_parent), address(usdc)), 600e6, "drawn from the owner's hub escrow"
        );
        assertEq(_nonceOf(body), 2, "the body consumed its second nonce");
        assertEq(_parent.nonce(), _parentNonce, "while the owner's signed credit total spends no parent nonce");

        vm.prank(master);
        _parent.revokeSessions();
        vm.warp(_now + SESSION_REVOKE_DELAY);
        (_i,) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        _i.header.deadline = vm.getBlockTimestamp() + 300;
        _d = _allocateDigest(_i);
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(
            _i,
            bytes.concat(_session(masterKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)),
            _ownerSig
        );

        hub.allocate(
            _i,
            bytes.concat(
                _session(masterKey, _sessionKey, _now, _now + 1 days, _parent.epoch(), _d), _coSig(attestorKey, _d)
            ),
            _ownerSig
        );
        assertEq(_nonceOf(body), 3, "revoking on the parent retires the body's session authority until re-granted");
        assertEq(
            hubEscrowStore.releasedMap(address(_parent), address(usdc)),
            700e6,
            "and the re-granted round draws its credit"
        );
    }

    function test_user_account_pair_reject_paths() public {
        uint _shares = _backed();
        address _acct = _account(backer);
        (address _other, uint _otherKey) = makeAddrAndKey("other");
        (address _forger, uint _forgerKey) = makeAddrAndKey("forger");
        (address _sessionSigner, uint _sessionKey) = makeAddrAndKey("session");
        uint _now = vm.getBlockTimestamp();
        (Redeem.SellIntent memory _i, bytes32 _d) = _sellIntent(_shares / 2);
        bytes memory _approval = _coSig(backerKey, _d);
        bytes memory _attest = _coSig(attestorKey, _d);
        (bytes32 _r, bytes32 _vs) = vm.signCompact(attestorKey, _d);
        assertTrue(
            SignatureCheckerLib.isValidSignatureNow(attestor, _d, bytes.concat(_r, _vs)),
            "the 64-byte tail below is a genuine compact attestor signature"
        );
        bytes memory _grant = _coSig(
            backerKey,
            AccountLib.sessionDigest(
                address(accountModule), backer, _sessionSigner, _now, _now + 1 hours, 0, address(0)
            )
        );
        bytes memory _inner = _coSig(_sessionKey, _d);
        assertTrue(
            UserAccount(payable(_acct))
                .approves(_d, abi.encode(_sessionSigner, _now, _now + 1 hours, uint(0), address(0), _grant, _inner)),
            "the untampered grant the tampered rows below start from is honoured"
        );
        uint _nonce = _nonceOf(_acct);

        bytes[] memory _bad = new bytes[](15);
        _bad[0] = bytes.concat(_approval, _coSig(_forgerKey, _d));
        _bad[1] = bytes.concat(_approval, _coSig(attestorKey, keccak256("another intent")));
        _bad[2] = _approval;
        _bad[3] = bytes.concat(_approval, _approval);
        _bad[4] = bytes.concat(_coSig(_otherKey, _d), _attest);
        _bad[5] = bytes.concat(
            abi.encode(
                _sessionSigner,
                _now,
                _now + 1 days,
                uint(0),
                address(0),
                _coSig(
                    _otherKey,
                    AccountLib.sessionDigest(
                        address(accountModule), backer, _sessionSigner, _now, _now + 1 days, 0, address(0)
                    )
                ),
                _coSig(_sessionKey, _d)
            ),
            _attest
        );
        _bad[6] = bytes.concat(
            abi.encode(
                _sessionSigner,
                _now,
                _now + 1 days,
                uint(0),
                address(0),
                _coSig(
                    backerKey,
                    AccountLib.sessionDigest(
                        address(accountModule), backer, _sessionSigner, _now, _now + 1 days, 0, address(0)
                    )
                ),
                _coSig(_forgerKey, _d)
            ),
            _attest
        );
        _bad[7] = bytes.concat(_approval, _r, _vs);
        _bad[8] = "";
        _bad[9] =
            bytes.concat(abi.encode(_sessionSigner, _now, _now + 1 days, uint(0), address(0), _grant, _inner), _attest);
        _bad[10] = bytes.concat(
            abi.encode(_sessionSigner, _now - 1, _now + 1 hours, uint(0), address(0), _grant, _inner), _attest
        );
        _bad[11] = bytes.concat(
            abi.encode(_forger, _now, _now + 1 hours, uint(0), address(0), _grant, _coSig(_forgerKey, _d)), _attest
        );
        _bad[12] = bytes.concat(
            abi.encode(
                _sessionSigner,
                _now,
                _now + 1 hours,
                uint(0),
                address(0),
                _coSig(
                    backerKey,
                    AccountLib.sessionDigest(
                        makeAddr("previous-module"), backer, _sessionSigner, _now, _now + 1 hours, 0, address(0)
                    )
                ),
                _inner
            ),
            _attest
        );
        _bad[13] = bytes.concat(
            abi.encode(
                _sessionSigner,
                _now,
                _now + 1 hours,
                uint(0),
                address(0),
                _coSig(
                    backerKey,
                    AccountLib.sessionDigest(
                        address(accountModule), _other, _sessionSigner, _now, _now + 1 hours, 0, address(0)
                    )
                ),
                _inner
            ),
            _attest
        );
        _bad[14] = bytes.concat(
            abi.encode(_sessionSigner, _now, _now + 1 hours, uint(1), address(0), _grant, _inner), _attest
        );
        for (uint _k; _k < _bad.length; ++_k) {
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.sell(_i, _bad[_k]);
        }
        assertEq(_bad[7].length, 129, "one byte short of a pair");
        assertEq(_nonceOf(_acct), _nonce, "no refused pair consumed the nonce");

        hub.sell(_i, bytes.concat(_approval, _attest));
        assertEq(fundStore.getRedemption(body).queued, _shares / 2, "the same intent with an honest pair goes through");
        assertEq(_nonceOf(_acct), _nonce + 1, "and consumes the nonce");
    }

    function test_body_pair_reject_paths() public {
        _openFund();
        _escrowOnHub(address(usdc), 100e6);
        (, uint _forgerKey) = makeAddrAndKey("forger");
        (Fund.AllocateIntent memory _i, bytes memory _honest) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        bytes32 _d = _allocateDigest(_i);
        bytes memory _attest = _coSig(attestorKey, _d);

        bytes[] memory _bad = new bytes[](5);
        _bad[0] = bytes.concat(_coSig(bodyKey, _d), _attest);
        _bad[1] = bytes.concat(_coSig(backerKey, _d), _attest);
        _bad[2] = bytes.concat(_coSig(masterKey, _d), _coSig(_forgerKey, _d));
        _bad[3] = _coSig(masterKey, _d);
        _bad[4] = bytes.concat(_coSig(masterKey, _d), bytes32(0), bytes32(0));
        for (uint _k; _k < _bad.length; ++_k) {
            bytes memory _ownerSig = _ownerCoSig(_i);
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.allocate(_i, _bad[_k], _ownerSig);
        }
        assertEq(_nonceOf(body), 1, "no refused pair consumed the body's nonce");
        assertEq(hubEscrowStore.releasedMap(_account(master), address(usdc)), 500e6, "nor released the owner's escrow");

        assertEq(
            _honest,
            bytes.concat(_coSig(masterKey, _d), _attest),
            "the honest pair is the parent's wallet then the attestor"
        );
        hub.allocate(_i, _honest, _ownerCoSig(_i));
        assertEq(_nonceOf(body), 2, "the parent's wallet with the attestor approves the body");
        assertEq(hubEscrowStore.releasedMap(_account(master), address(usdc)), 600e6, "and its round draws the credit");
    }

    function test_wallet_cannot_revoke_inside_its_own_dispatch() public {
        (address _user, uint _key, UserAccount _ua) =
            _etchedWallet("wallet-revoke", abi.encodeCall(UserAccount.revokeSessions, ()), false);
        (Deposit.SwapIntent memory _i, bytes memory _sig) = _nativeWithdraw(_user, _key, _ua);
        uint _epoch = _ua.epoch();

        vm.expectRevert(Error.Account__Executing.selector);
        hub.withdraw(_i, _sig);
        assertEq(_ua.nonce(), 0, "the dispatch never landed");
        assertEq(_ua.epoch(), _epoch, "no revoke landed inside it");
        assertEq(address(_ua).balance, 1 ether, "no native left the account");

        vm.prank(_user);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), _epochAfterRevoke(_epoch), "the same revoke lands outside a dispatch");
        assertTrue(_ua.epoch() != _epoch, "moving the account off its epoch");
    }

    function test_the_wallet_cannot_revoke_or_withdraw_inside_its_own_dispatch_even_with_its_window_open() public {
        (address _user, uint _key, UserAccount _ua) = _etchedWallet("wallet-window", "", false);
        uint _start = vm.getBlockTimestamp();
        vm.prank(_user);
        _ua.revokeSessions();
        vm.warp(_start + SESSION_REVOKE_DELAY);
        (Deposit.SwapIntent memory _i, bytes memory _sig) = _nativeWithdraw(_user, _key, _ua);
        bytes[] memory _selfCalls = new bytes[](2);
        _selfCalls[0] = abi.encodeCall(UserAccount.revokeSessions, ());
        _selfCalls[1] = abi.encodeCall(UserAccount.withdraw, (NATIVE_TOKEN, 0.1 ether));
        uint _epoch = _ua.epoch();
        for (uint _k; _k < _selfCalls.length; ++_k) {
            AuthMatrixTestWallet(payable(_user)).arm(_selfCalls[_k]);
            vm.expectRevert(Error.Account__Executing.selector);
            hub.withdraw(_i, _sig);
        }
        assertEq(_ua.epoch(), _epoch, "no revoke landed inside the dispatch");
        assertEq(address(_ua).balance, 1 ether, "and no native left the account, though its withdraw window is open");
        assertEq(_ua.nonce(), 0, "no refused dispatch landed");

        AuthMatrixTestWallet(payable(_user)).arm("");
        vm.prank(_user);
        _ua.withdraw(NATIVE_TOKEN, 0.1 ether);
        assertEq(address(_ua).balance, 0.9 ether, "the same withdraw lands from the wallet outside a dispatch");
    }

    function test_swallowed_self_call_keeps_records_in_execution_order() public {
        (address _user, uint _key, UserAccount _ua) =
            _etchedWallet("wallet-swallow", abi.encodeCall(UserAccount.revokeSessions, ()), true);
        (Deposit.SwapIntent memory _i, bytes memory _sig) = _nativeWithdraw(_user, _key, _ua);
        bytes32 _d = _typed(
            address(_ua),
            _i.header.deadline,
            keccak256(
                abi.encode(WITHDRAW_INTENT_TYPEHASH, _hashHeader(_i.header), _i.destinationChainId, _hashSwap(_i.swap))
            )
        );
        uint _walletBefore = _user.balance;
        uint _epoch = _ua.epoch();

        vm.recordLogs();
        hub.withdraw(_i, _sig);
        assertEq(
            AuthMatrixTestWallet(payable(_user)).caught(),
            abi.encodeWithSelector(Error.Account__Executing.selector),
            "the nested revoke was refused as executing"
        );
        assertEq(_ua.epoch(), _epoch, "so the epoch did not move mid-dispatch");
        assertEq(_ua.nonce(), 1, "while the dispatch itself landed");
        assertEq(_user.balance, _walletBefore + 0.5 ether - 1e15, "and paid the wallet");

        vm.prank(_user);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), _epochAfterRevoke(_epoch), "the revoke lands once the dispatch is over");
        assertTrue(_ua.epoch() != _epoch, "moving the account off its epoch");

        Vm.Log[] memory _logs = vm.getRecordedLogs();
        assertEq(_logs.length, 2, "one record per landed action, none nested");
        for (uint _k; _k < 2; ++_k) {
            assertEq(_logs[_k].emitter, address(accountModule), "each record comes from the module");
            assertEq(_logs[_k].topics[0], AccountModule.AccountCall.selector, "as an AccountCall");
            assertEq(_logs[_k].topics[1], bytes32(uint(uint160(address(_ua)))), "for the wallet's account");
        }
        assertEq(_logs[0].topics[2], bytes32(uint(uint160(address(depositModule)))), "the dispatch is recorded first");
        (,,, bytes32 _digest,, bytes memory _withdrawData,,, BalanceLib.Balance[] memory _balances) = abi.decode(
            _logs[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, _d, "under the withdraw digest");
        assertEq(bytes4(abi.decode(_withdrawData, (bytes32))), Deposit.withdraw.selector, "as the withdraw");
        assertEq(_balances.length, 1, "with one closing balance");
        assertEq(_balances[0].token, NATIVE_TOKEN, "in native");
        assertEq(_balances[0].amount, 0.5 ether, "taken after the dispatch closed");
        assertEq(
            _logs[1].topics[2], bytes32(uint(uint160(address(_ua)))), "the revoke follows, sourced from the account"
        );
        (,,,,, bytes memory _revokeData) = abi.decode(_logs[1].data, (uint, uint, uint, bytes32, bytes, bytes));
        assertEq(_revokeData, abi.encode(UserAccount.revokeSessions.selector, _ua.epoch()), "at the next epoch");
    }

    function test_false_returning_token_reverts_its_pay_leg() public {
        AuthMatrixTestFalseToken _ft = new AuthMatrixTestFalseToken();

        _fundWallet(backer, 10e6);
        address _acct = _account(backer);
        _ft.mint(_acct, 100e18);

        Deposit.SwapIntent memory _w = Deposit.SwapIntent({
            header: _header(_acct, backer, 0),
            swap: SwapLib.SwapParams({
                inputToken: address(_ft),
                inputAmount: 10e18,
                outputToken: address(_ft),
                outputAmount: 9e18,
                provider: address(0),
                providerCallData: ""
            }),
            destinationChainId: block.chainid
        });
        _w.header.feeToken = address(_ft);
        _w.header.fee = 1e18;
        bytes memory _withdrawSig = _swapSig(WITHDRAW_INTENT_TYPEHASH, backerKey, _acct, _w);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__CallReturnedFalse.selector, address(_ft)));
        hub.withdraw(_w, _withdrawSig);

        assertEq(usdc.balanceOf(_acct), 10e6, "the account paid no relay fee for the refused intents");
        assertEq(_nonceOf(_acct), 0, "none of them consumed the nonce");
    }

    function test_accounts_start_at_nonce_zero_and_replays_revert() public {
        UserAccount _fresh = UserAccount(payable(_account(makeAddr("fresh"))));
        assertEq(_fresh.nonce(), 0, "a user account starts at nonce 0");
        assertEq(_fresh.epoch(), 0, "at epoch 0");
        assertEq(FundAccount(payable(body)).nonce(), 0, "a delegated body starts at nonce 0");
        (address _module, address _bound) = FundAccount(payable(body)).bound();
        assertEq(_module, address(0), "unbound before genesis");
        assertEq(_bound, address(0), "with no parent");

        _fundWallet(master, 2000e6);
        address _parent = _account(master);
        assertEq(_nonceOf(_parent), 0, "the first deposit does not consume a nonce");
        (Deposit.SwapIntent memory _w, bytes32 _structHash) = _usdcWithdraw(master, _parent, 10e6);
        bytes memory _withdrawSig = _pair(masterKey, _typed(_parent, _w.header.deadline, _structHash));
        hub.withdraw(_w, _withdrawSig);
        assertEq(_nonceOf(_parent), 1, "a relayed intent consumes exactly one nonce");
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, _parent, 1, 0));
        hub.withdraw(_w, _withdrawSig);
        _w.header.nonce = 2;
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, _parent, 1, 2));
        hub.withdraw(_w, _withdrawSig);
        assertEq(usdc.balanceOf(_parent), 1990e6, "the replay withdrew nothing more");

        _escrowOnHub(address(usdc), 500e6);
        bytes memory _pixels = new bytes(GRID_BYTES);
        shareToken = _shareOf(bytes32("AUTH"), _pixels);
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _parent);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(1, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, 0, 1));
        hub.createFund(
            bytes32("AUTH"), _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerSig
        );

        (_i, _sig) = _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        hub.createFund(
            bytes32("AUTH"),
            _pixels,
            _coSig(bodyKey, _genesis),
            _fundApproval(masterKey, body),
            _i,
            _sig,
            _ownerCoSig(_i)
        );
        assertEq(_nonceOf(body), 1, "the opening allocate consumed the body's nonce 0");
        assertEq(_nonceOf(_parent), 1, "and the owner's signed credit total none of the parent's");

        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, 1, 0));
        hub.allocate(_i, _sig, _ownerSig);
        assertEq(shareToken.balanceOf(body), 499e18, "the replayed round minted nothing more");
        assertEq(hubEscrowStore.releasedMap(_parent, address(usdc)), 500e6, "released the owner's escrow once");
        assertEq(usdc.balanceOf(_parent), 1990e6, "and never touched the owner's account");
    }

    function test_an_account_is_created_by_its_own_wallet_or_an_access_grantee_and_never_by_a_stranger() public {
        address _user = makeAddr("create-user");
        address _other = makeAddr("create-other");
        address _granted = makeAddr("create-granted");
        address _stranger = makeAddr("create-stranger");
        address _predicted = accountModule.predictUserAccount(_user);
        address _otherPredicted = accountModule.predictUserAccount(_other);

        vm.prank(_stranger);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        accountModule.createUserAccount(_user);
        vm.prank(_granted);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        accountModule.createUserAccount(_other);
        assertEq(_predicted.code.length, 0, "a stranger opens no account for another wallet");
        assertEq(_otherPredicted.code.length, 0, "nor does a caller governance never granted");

        vm.prank(_user);
        address _created = accountModule.createUserAccount(_user);
        assertEq(_created, _predicted, "the wallet opens its own account at its predicted address");
        assertEq(UserAccount(payable(_created)).user(), _user, "bound to that wallet");
        vm.prank(_stranger);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        accountModule.createUserAccount(_user);

        vm.prank(address(governorAccount));
        accountModule.setAccess(_granted, AccountModule.createUserAccount.selector);
        vm.prank(_granted);
        _created = accountModule.createUserAccount(_other);
        assertEq(_created, _otherPredicted, "an access grantee opens an account for any wallet");
        assertEq(UserAccount(payable(_created)).user(), _other, "bound to that wallet, not to the grantee");
    }

    function test_the_hub_gate_names_its_release_and_attestor_endpoints_and_only_governance_moves_them() public {
        assertEq(hub.websiteRelease(), WEBSITE_RELEASE, "the hub names its approved website release through the proxy");
        assertEq(hub.attestorEndpoints().length, 1, "the hub lists where its attestor answers");
        assertEq(hub.attestorEndpoints()[0], ATTESTOR_ENDPOINT, "through the proxy, from the implementation's storage");
        bytes32 _next = keccak256("the next website release");
        string memory _nextEndpoint = "https://attestor.example/next";
        address _nextImpl = address(
            new HubGate(
                accountModule,
                depositModule,
                hubEscrowStore,
                fundModule,
                redeemModule,
                hub.getConfig(),
                _endpoints(_nextEndpoint),
                _list(address(usdc), address(wnt)),
                50,
                1000,
                _next
            )
        );
        vm.prank(makeAddr("release-rogue"));
        vm.expectRevert(Error.Access__CallerNotAuthority.selector);
        RouterProxy(payable(address(hub))).upgrade(_nextImpl);
        assertEq(hub.websiteRelease(), WEBSITE_RELEASE, "no one but governance moves it");
        assertEq(hub.attestorEndpoints()[0], ATTESTOR_ENDPOINT, "nor the endpoints");

        vm.prank(address(governorAccount));
        RouterProxy(payable(address(hub))).upgrade(_nextImpl);
        assertEq(hub.websiteRelease(), _next, "approving a release is a governance upgrade of the hub's config");
        assertEq(hub.attestorEndpoints()[0], _nextEndpoint, "and moving an endpoint is the same upgrade");

        GateConfig memory _config = hub.getConfig();
        vm.expectRevert(Error.Gate__NoAttestorEndpoint.selector);
        new HubGate(
            accountModule,
            depositModule,
            hubEscrowStore,
            fundModule,
            redeemModule,
            _config,
            new string[](0),
            _list(address(usdc)),
            50,
            1000,
            _next
        );
        vm.expectRevert(Error.Gate__NoAttestorEndpoint.selector);
        new HubGate(
            accountModule,
            depositModule,
            hubEscrowStore,
            fundModule,
            redeemModule,
            _config,
            _endpoints(""),
            _list(address(usdc)),
            50,
            1000,
            _next
        );

        address _revoked = address(
            new HubGate(
                accountModule,
                depositModule,
                hubEscrowStore,
                fundModule,
                redeemModule,
                _config,
                _endpoints(_nextEndpoint),
                _list(address(usdc), address(wnt)),
                50,
                1000,
                bytes32(0)
            )
        );
        vm.prank(address(governorAccount));
        RouterProxy(payable(address(hub))).upgrade(_revoked);
        assertEq(hub.websiteRelease(), bytes32(0), "and revoking every release is one upgrade to the zero hash");
    }

    function _escrowFrom(
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

    function _retireIntent(
        address _user,
        uint _key,
        address _acct,
        uint _amount
    ) internal view returns (LiquidityGate.RetireEscrowIntent memory i_, bytes memory sig_) {
        i_ = LiquidityGate.RetireEscrowIntent({
            header: _header(_acct, _user, _nonceOf(_acct)), token: address(usdc), amount: _amount
        });
        i_.header.deadline = vm.getBlockTimestamp() + 300;
        sig_ = _pair(_key, _retireDigest(i_));
    }

    function _retireDigest(
        LiquidityGate.RetireEscrowIntent memory _i
    ) internal view returns (bytes32) {
        return _typed(
            _i.header.account,
            _i.header.deadline,
            keccak256(abi.encode(RETIRE_ESCROW_INTENT_TYPEHASH, _hashHeader(_i.header), _i.token, _i.amount))
        );
    }

    function _accountCalls(
        Vm.Log[] memory _logs
    ) internal view returns (Vm.Log[] memory calls_) {
        calls_ = new Vm.Log[](_logs.length);
        uint _n;
        for (uint _k; _k < _logs.length; ++_k) {
            if (_logs[_k].emitter == address(accountModule)) calls_[_n++] = _logs[_k];
        }
        assembly ("memory-safe") {
            mstore(calls_, _n)
        }
    }

    function _refuses(
        EscrowStore _store,
        address _caller
    ) internal {
        vm.prank(_caller);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _store.escrow(master, address(usdc), 1);
        vm.prank(_caller);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _store.release(master, body, address(usdc), 1, 0, feeReceiver, 200_000);
        vm.prank(_caller);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _store.requestReturn(master, address(usdc));
        vm.prank(_caller);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _store.refund(master, address(usdc), 200_000);
    }

    function test_deposit_escrow_on_the_hub_books_only_the_callers_own_account() public {
        _depositEscrowBooksOnlyTheCaller(LiquidityGate(address(hub)), hubEscrowStore, spokeEscrowStore);
    }

    function test_deposit_escrow_on_the_spoke_books_only_the_callers_own_account() public {
        _depositEscrowBooksOnlyTheCaller(LiquidityGate(address(spoke)), spokeEscrowStore, hubEscrowStore);
    }

    function _depositEscrowBooksOnlyTheCaller(
        LiquidityGate _gate,
        EscrowStore _store,
        EscrowStore _other
    ) internal {
        address _owner = _account(master);
        usdc.mint(master, 500e6);
        vm.prank(master);
        IERC20(address(usdc)).approve(address(depositModule), 500e6);
        address _stranger = makeAddr("escrow-stranger");
        address _strangerAccount = accountModule.predictUserAccount(_stranger);

        vm.prank(_stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Error.TransferUtils__TokenTransferFromError.selector, address(usdc), _stranger, address(_store), 100e6
            )
        );
        _gate.depositEscrow(address(usdc), 100e6);
        assertEq(
            usdc.balanceOf(master),
            500e6,
            "an escrow pulls from its caller, never from another wallet's standing allowance"
        );
        assertEq(_strangerAccount.code.length, 0, "and the refused call opened nothing");

        usdc.mint(_stranger, 100e6);
        vm.startPrank(_stranger);
        IERC20(address(usdc)).approve(address(depositModule), 100e6);
        _gate.depositEscrow(address(usdc), 70e6);
        assertGt(_strangerAccount.code.length, 0, "the first escrow opens the caller's own account");
        vm.recordLogs();
        _gate.depositEscrow(address(usdc), 30e6);
        vm.stopPrank();
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(
            _store.escrowedMap(_strangerAccount, address(usdc)), 100e6, "both escrows book to the caller's own account"
        );
        assertEq(_store.escrowedMap(_owner, address(usdc)), 0, "never to another owner");
        assertEq(_other.escrowedMap(_strangerAccount, address(usdc)), 0, "nor into the other gate's store");
        assertEq(usdc.balanceOf(address(_store)), 100e6, "the tokens sit in the gate's own store");
        assertEq(_store.heldMap(address(usdc)), 100e6, "held against its ledger");
        assertEq(usdc.balanceOf(_strangerAccount), 0, "and none in the account itself");

        assertEq(_calls.length, 1, "the escrow writes one record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(_strangerAccount))), "on the caller's account");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(_gate)))), "written by the gate entrypoint itself");
        (,,, bytes32 _digest,, bytes memory _data,,, BalanceLib.Balance[] memory _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, bytes32(0), "under no signature: the caller is the owner");
        assertEq(
            _data,
            abi.encode(LiquidityGate.depositEscrow.selector, address(usdc), uint(30e6), uint(0), uint(100e6)),
            "carrying the owner's escrowed total after it"
        );
        assertEq(_balances.length, 0, "and no account balance, since nothing landed there");

        usdc.mint(_stranger, 20e6);
        vm.startPrank(_stranger);
        IERC20(address(usdc)).approve(address(depositModule), 20e6);
        vm.recordLogs();
        _gate.deposit(address(usdc), 20e6);
        vm.stopPrank();
        _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(usdc.balanceOf(_strangerAccount), 20e6, "a plain deposit lands in the caller's own account");
        assertEq(_store.escrowedMap(_strangerAccount, address(usdc)), 100e6, "and escrows nothing");
        assertEq(_calls.length, 1, "one record");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(_gate)))), "written by the gate entrypoint as well");
        (,,,,, _data,,, _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(
            _data,
            abi.encode(LiquidityGate.deposit.selector, address(usdc), uint(20e6), uint(0)),
            "carrying the deposit"
        );
        assertEq(_balances[0].amount, 20e6, "and the account's balance after it");

        vm.deal(_stranger, 1 ether);
        vm.prank(_stranger);
        vm.expectRevert(Error.Balance__InvalidDeposit.selector);
        _gate.depositEscrow{value: 1 ether}(NATIVE_TOKEN, 1 ether);
        vm.prank(_stranger);
        _gate.depositEscrow{value: 1 ether}(address(wnt), 1 ether);
        assertEq(
            _store.escrowedMap(_strangerAccount, address(wnt)),
            1 ether,
            "native attached to a WETH escrow is booked as WETH"
        );
        assertEq(wnt.balanceOf(address(_store)), 1 ether, "and lands as WETH in the gate's store");
    }

    function test_only_the_wallet_revokes_its_sessions_and_neither_a_stranger_a_session_nor_the_protocol_can() public {
        _fundWallet(backer, 100e6);
        UserAccount _ua = UserAccount(payable(_account(backer)));
        (address _signer, uint _signerKey) = makeAddrAndKey("revoke-session");
        address _stranger = makeAddr("revoke-stranger");
        uint _start = vm.getBlockTimestamp();
        bytes32 _d = keccak256("an intent the session approves");
        bytes memory _grant = _session(backerKey, _signerKey, _start, _start + 1 days, 0, _d);
        assertTrue(_ua.approves(_d, _grant), "the session holds a live grant");
        address[4] memory _refused = [_stranger, _signer, address(accountModule), address(hub)];
        uint _epoch = _ua.epoch();

        for (uint _k; _k < _refused.length; ++_k) {
            vm.prank(_refused[_k]);
            vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
            _ua.revokeSessions();
        }
        assertEq(_ua.epoch(), _epoch, "neither a stranger, the session nor the protocol moves the epoch");
        vm.warp(_start + SESSION_REVOKE_DELAY);
        assertTrue(_ua.approves(_d, _grant), "so the grant outlives the grace of every refused revoke");

        uint _revokedAt = _start + SESSION_REVOKE_DELAY;
        vm.recordLogs();
        vm.prank(backer);
        _ua.revokeSessions();
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(_ua.epoch(), _epochAfterRevoke(_epoch), "the wallet's own call advances the epoch");
        assertTrue(_ua.epoch() != _epoch, "off the epoch the grant names");
        _epoch = _ua.epoch();
        assertEq(_calls.length, 1, "one record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(address(_ua)))), "on the account");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(_ua)))), "sourced from the account itself");
        (,, uint _stamp,,, bytes memory _data) = abi.decode(_calls[0].data, (uint, uint, uint, bytes32, bytes, bytes));
        assertEq(_data, abi.encode(UserAccount.revokeSessions.selector, _epoch), "carrying the new epoch");
        assertEq(_stamp, _revokedAt, "stamped with the second its grace and withdraw window count from");
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawClosed.selector, _revokedAt));
        _ua.withdraw(address(usdc), 1);

        vm.warp(_revokedAt + SESSION_REVOKE_DELAY);
        assertFalse(_ua.approves(_d, _grant), "the grant is retired once the grace is over");
        for (uint _k; _k < _refused.length; ++_k) {
            vm.prank(_refused[_k]);
            vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
            _ua.withdraw(address(usdc), 1);
        }
        assertEq(usdc.balanceOf(address(_ua)), 100e6, "and no caller but the wallet withdraws its own in the window");

        vm.prank(backer);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), _epochAfterRevoke(_epoch), "a later revoke by the wallet lands as well");
        assertTrue(_ua.epoch() != _epoch, "moving the account off the epoch the first revoke set");
        vm.prank(backer);
        vm.expectRevert(
            abi.encodeWithSelector(Error.Account__WithdrawClosed.selector, _revokedAt + SESSION_REVOKE_DELAY)
        );
        _ua.withdraw(address(usdc), 1);
    }

    function _sessionSigned(
        uint _sessionKey,
        uint _issuedAt,
        uint _epoch,
        bytes32 _digest
    ) internal view returns (bytes memory) {
        return bytes.concat(
            _session(backerKey, _sessionKey, _issuedAt, _issuedAt + 1 days, _epoch, _digest),
            _coSig(attestorKey, _digest)
        );
    }

    function _sessionSweep(
        uint _shares,
        uint _sessionKey,
        uint _issuedAt,
        uint _epoch,
        bytes memory _refusal
    ) internal {
        address _acct = accountModule.predictUserAccount(backer);
        LiquidityGate[2] memory _gates = [LiquidityGate(address(hub)), LiquidityGate(address(spoke))];
        bytes memory _sig;
        for (uint _g; _g < _gates.length; ++_g) {
            (Deposit.SwapIntent memory _w, bytes32 _structHash) = _usdcWithdraw(backer, _acct, 20e6);
            _sig = _sessionSigned(_sessionKey, _issuedAt, _epoch, _typed(_acct, _w.header.deadline, _structHash));
            if (_refusal.length > 0) vm.expectRevert(_refusal);
            _gates[_g].withdraw(_w, _sig);

            (LiquidityGate.RetireEscrowIntent memory _r,) = _retireIntent(backer, backerKey, _acct, 10e6);
            _sig = _sessionSigned(_sessionKey, _issuedAt, _epoch, _retireDigest(_r));
            if (_refusal.length > 0) vm.expectRevert(_refusal);
            _gates[_g].retireEscrow(_r, _sig);

            Deposit.SwapIntent memory _across = Deposit.SwapIntent({
                header: _header(_acct, backer, _nonceOf(_acct)),
                swap: _swapParams(_acct, 20e6),
                destinationChainId: block.chainid
            });
            _across.header.deadline = vm.getBlockTimestamp() + 300;
            _sig = _sessionSigned(
                _sessionKey,
                _issuedAt,
                _epoch,
                _typed(
                    _acct,
                    _across.header.deadline,
                    keccak256(
                        abi.encode(
                            DEPOSIT_ACROSS_INTENT_TYPEHASH,
                            _hashHeader(_across.header),
                            _across.destinationChainId,
                            _hashSwap(_across.swap)
                        )
                    )
                )
            );
            if (_refusal.length > 0) vm.expectRevert(_refusal);
            _gates[_g].depositAcross(_across, _sig);
        }

        MandateLib.Mandate[] memory _list = _freshMandates(11, 1);
        HubGate.MandateIntent memory _m =
            HubGate.MandateIntent({header: _header(_acct, backer, _nonceOf(_acct)), epoch: _epoch, mandateList: _list});
        _m.header.deadline = vm.getBlockTimestamp() + 300;
        _sig = _sessionSigned(
            _sessionKey,
            _issuedAt,
            _epoch,
            _typed(
                _acct,
                _m.header.deadline,
                keccak256(
                    abi.encode(MANDATE_INTENT_TYPEHASH, _hashHeader(_m.header), _m.epoch, keccak256(abi.encode(_list)))
                )
            )
        );
        uint _accountEpoch = UserAccount(payable(_acct)).epoch();
        if (_epoch != _accountEpoch) {
            vm.expectRevert(abi.encodeWithSelector(Error.Mandate__StaleEpoch.selector, _epoch, _accountEpoch));
        } else if (_refusal.length > 0) {
            vm.expectRevert(_refusal);
        }
        hub.mandate(_m, _sig);

        (Redeem.SellIntent memory _s, bytes32 _sd) = _sellIntent(_shares);
        _sig = _sessionSigned(_sessionKey, _issuedAt, _epoch, _sd);
        if (_refusal.length > 0) vm.expectRevert(_refusal);
        hub.sell(_s, _sig);
    }

    function test_intents_signed_under_a_retired_session_land_through_the_ten_minute_grace_and_are_refused_from_its_end_on_hub_and_spoke()
        public
    {
        uint _shares = _backed();
        _fundWallet(backer, 300e6);
        UserAccount _ua = UserAccount(payable(_account(backer)));
        (, uint _sessionKey) = makeAddrAndKey("sweep-session");
        uint _start = vm.getBlockTimestamp();
        vm.prank(backer);
        _ua.revokeSessions();

        vm.warp(_start + SESSION_REVOKE_DELAY - 1);
        uint _nonce = _ua.nonce();
        _sessionSweep(_shares / 4, _sessionKey, _start, 0, "");
        assertEq(
            _ua.nonce(),
            _nonce + 7,
            "a withdraw, retire and depositAcross on each gate and a sell land under the retired session until the grace's last second, while a mandate signed in the retired epoch is refused as stale"
        );
        assertEq(fundStore.getHolding(body, address(_ua)).queued, _shares / 4, "the sell among them queued its shares");

        vm.warp(_start + SESSION_REVOKE_DELAY);
        _sessionSweep(
            _shares / 4, _sessionKey, _start, 0, abi.encodeWithSelector(Error.Account__InvalidSignature.selector)
        );
        assertEq(_ua.nonce(), _nonce + 7, "from its end every one of them is refused on either gate");
        assertEq(fundStore.getHolding(body, address(_ua)).queued, _shares / 4, "and no further sale queues");

        _sessionSweep(_shares / 4, _sessionKey, _start, _ua.epoch(), "");
        assertEq(
            _ua.nonce(),
            _nonce + 15,
            "a grant the wallet signs at the new epoch lands every one of them, the mandate included"
        );
        assertEq(fundStore.getHolding(body, address(_ua)).queued, 2 * (_shares / 4), "the second sale among them");
    }

    function test_withdraw_opens_ten_minutes_after_a_revoke_for_ten_minutes_and_pays_only_the_wallet_in_erc20_and_native()
        public
    {
        _fundWallet(backer, 300e6);
        vm.deal(backer, 2 ether);
        vm.prank(backer);
        hub.deposit{value: 2 ether}(NATIVE_TOKEN, 2 ether);
        UserAccount _ua = UserAccount(payable(_account(backer)));
        address _relayer = makeAddr("withdraw-own-relayer");
        uint _start = vm.getBlockTimestamp();

        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawClosed.selector, 0));
        _ua.withdraw(address(usdc), 100e6);

        vm.prank(backer);
        _ua.revokeSessions();
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawClosed.selector, _start));
        _ua.withdraw(address(usdc), 100e6);
        vm.warp(_start + SESSION_REVOKE_DELAY - 1);
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawClosed.selector, _start));
        _ua.withdraw(address(usdc), 100e6);

        vm.warp(_start + SESSION_REVOKE_DELAY);
        vm.prank(backer);
        vm.expectRevert(Error.Balance__NothingToWithdraw.selector);
        _ua.withdraw(address(usdc), 0);
        vm.prank(_relayer);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        _ua.withdraw(address(usdc), 100e6);

        uint _relay = usdc.balanceOf(feeReceiver);
        uint _nonce = _ua.nonce();
        vm.recordLogs();
        vm.prank(backer);
        _ua.withdraw(address(usdc), 100e6);
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(usdc.balanceOf(backer), 100e6, "ten minutes after the revoke, the wallet's own call pays the wallet");
        assertEq(usdc.balanceOf(address(_ua)), 200e6, "out of its account");
        assertEq(usdc.balanceOf(_relayer), 0, "and nothing to the relayer refused before it");
        assertEq(usdc.balanceOf(feeReceiver), _relay, "with no relay fee");
        assertEq(_ua.nonce(), _nonce, "and no nonce");
        assertEq(_calls.length, 1, "one record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(address(_ua)))), "on the account");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(_ua)))), "sourced from the account itself");
        (,, uint _stamp, bytes32 _digest,, bytes memory _data,,, BalanceLib.Balance[] memory _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_stamp, _start + SESSION_REVOKE_DELAY, "at the second the window opened");
        assertEq(_digest, bytes32(0), "under no signature: the caller is the wallet");
        assertEq(
            _data, abi.encode(UserAccount.withdraw.selector, address(usdc), uint(100e6)), "naming the token and amount"
        );
        assertEq(_balances.length, 1, "with one closing balance");
        assertEq(_balances[0].token, address(usdc), "in the token withdrawn");
        assertEq(_balances[0].amount, 200e6, "the account's after it");

        uint _native = backer.balance;
        vm.recordLogs();
        vm.prank(backer);
        _ua.withdraw(NATIVE_TOKEN, 1.5 ether);
        _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(backer.balance, _native + 1.5 ether, "native comes home to the wallet the same way");
        assertEq(address(_ua).balance, 0.5 ether, "out of the account");
        (,,,,, _data,,, _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_data, abi.encode(UserAccount.withdraw.selector, NATIVE_TOKEN, uint(1.5 ether)), "recorded in native");
        assertEq(_balances[0].token, NATIVE_TOKEN, "with the native balance");
        assertEq(_balances[0].amount, 0.5 ether, "left after it");

        vm.warp(_start + 2 * SESSION_REVOKE_DELAY - 1);
        vm.prank(backer);
        _ua.withdraw(address(usdc), 50e6);
        assertEq(usdc.balanceOf(backer), 150e6, "the window holds through its last second");
        vm.warp(_start + 2 * SESSION_REVOKE_DELAY);
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawClosed.selector, _start));
        _ua.withdraw(address(usdc), 50e6);

        uint _again = _start + 2 * SESSION_REVOKE_DELAY;
        vm.prank(backer);
        _ua.revokeSessions();
        vm.warp(_again + SESSION_REVOKE_DELAY - 1);
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawClosed.selector, _again));
        _ua.withdraw(address(usdc), 50e6);
        vm.warp(_again + SESSION_REVOKE_DELAY);
        vm.prank(backer);
        _ua.withdraw(address(usdc), 50e6);
        assertEq(usdc.balanceOf(backer), 200e6, "a later revoke reopens it ten minutes on");

        uint _inside = _again + SESSION_REVOKE_DELAY + 1;
        vm.warp(_inside);
        vm.prank(backer);
        _ua.revokeSessions();
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__WithdrawClosed.selector, _inside));
        _ua.withdraw(address(usdc), 50e6);
        assertEq(usdc.balanceOf(address(_ua)), 100e6, "and a revoke inside an open window shuts it at once");
    }

    function test_a_two_of_two_contract_wallet_revokes_its_session_and_brings_its_balance_home_by_calling_its_account_directly()
        public
    {
        (, uint _a) = makeAddrAndKey("revoke-multisig-first");
        (, uint _b) = makeAddrAndKey("revoke-multisig-second");
        address _wallet = address(new MockMultisig1271(vm.addr(_a), vm.addr(_b)));
        _fundWallet(_wallet, 300e6);
        UserAccount _ua = UserAccount(payable(_account(_wallet)));
        (address _signer, uint _signerKey) = makeAddrAndKey("revoke-multisig-session");
        uint _start = vm.getBlockTimestamp();
        bytes32 _grantDigest =
            AccountLib.sessionDigest(address(accountModule), _wallet, _signer, _start, _start + 1 days, 0, address(0));
        bytes memory _grant = bytes.concat(_coSig(_a, _grantDigest), _coSig(_b, _grantDigest));

        vm.prank(_wallet);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), _epochAfterRevoke(0), "the contract wallet revokes its sessions by calling its account");
        assertTrue(_ua.epoch() != 0, "moving it off the epoch both owners granted the session in");

        (Deposit.SwapIntent memory _w, bytes32 _structHash) = _usdcWithdraw(_wallet, address(_ua), 50e6);
        bytes32 _d = _typed(address(_ua), _w.header.deadline, _structHash);
        hub.withdraw(
            _w,
            bytes.concat(
                abi.encode(_signer, _start, _start + 1 days, uint(0), address(0), _grant, _coSig(_signerKey, _d)),
                _coSig(attestorKey, _d)
            )
        );
        assertEq(
            usdc.balanceOf(_wallet),
            50e6 - FEE,
            "a withdraw under the session both owners granted still lands in the grace"
        );

        vm.warp(_start + SESSION_REVOKE_DELAY);
        (_w, _structHash) = _usdcWithdraw(_wallet, address(_ua), 50e6);
        _d = _typed(address(_ua), _w.header.deadline, _structHash);
        bytes memory _retired = bytes.concat(
            abi.encode(_signer, _start, _start + 1 days, uint(0), address(0), _grant, _coSig(_signerKey, _d)),
            _coSig(attestorKey, _d)
        );
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.withdraw(_w, _retired);
        assertTrue(
            _ua.approves(_d, _walletSigned(_a, _b, _d)),
            "the revoke retires the session, never the wallet's own two signatures"
        );

        vm.prank(vm.addr(_a));
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        _ua.withdraw(address(usdc), 100e6);
        uint _held = usdc.balanceOf(address(_ua));
        vm.prank(_wallet);
        _ua.withdraw(address(usdc), _held);
        assertEq(usdc.balanceOf(_wallet), 50e6 - FEE + _held, "the wallet's own call brings the whole balance home");
        assertEq(usdc.balanceOf(address(_ua)), 0, "out of its account, though neither owner alone could");
    }

    function test_after_a_revoke_the_next_round_skips_the_backer_and_a_mandate_signed_after_it_lets_the_fund_pull_again()
        public
    {
        uint _shares = _backed();
        address _acct = _account(backer);
        UserAccount _ua = UserAccount(payable(_acct));
        MandateLib.Mandate[] memory _one = new MandateLib.Mandate[](1);
        _one[0] = mandateLog[_acct][body];
        (address _peer, uint _peerKey) = makeAddrAndKey("revoke-round-peer");
        _fundWallet(_peer, 1000e6);
        _mandate(_peer, _peerKey, _one);
        address _peerAcct = _account(_peer);
        bytes32 _committed = keccak256(abi.encode(_one[0], uint(0)));
        assertEq(
            mandateStore.mandateMap(_acct, body), _committed, "the hub holds the backer's terms committed at its epoch"
        );

        vm.prank(backer);
        _ua.revokeSessions();
        assertEq(mandateStore.mandateMap(_acct, body), _committed, "the revoke writes nothing to the hub");
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        bool _backerFirst = uint160(_acct) < uint160(_peerAcct);
        _rows[0] = _row(_backerFirst ? _acct : _peerAcct, 100e6);
        _rows[1] = _row(_backerFirst ? _peerAcct : _acct, 100e6);
        uint _cash = usdc.balanceOf(_acct);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        vm.recordLogs();
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(
            shareToken.balanceOf(_acct),
            _shares,
            "yet the next round skips the backer, whose epoch moved past its commitment"
        );
        assertEq(usdc.balanceOf(_acct), _cash, "pulling nothing from its account");
        assertGt(shareToken.balanceOf(_peerAcct), 0, "while the rest of the round mints");
        for (uint _k; _k < _calls.length; ++_k) {
            assertTrue(
                _calls[_k].topics[1] != bytes32(uint(uint160(_acct))),
                "and the round records nothing on the skipped backer"
            );
        }

        _mandate(backer, backerKey, _one);
        assertEq(
            mandateStore.mandateMap(_acct, body),
            keccak256(abi.encode(_one[0], _ua.epoch())),
            "a mandate signed after the revoke commits the same terms at the new epoch"
        );
        _cash = usdc.balanceOf(_acct);
        _rows = new Fund.Allocation[](1);
        _rows[0] = _row(_acct, 100e6);
        (_i, _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertGt(shareToken.balanceOf(_acct), _shares, "so the next round pulls from the backer again");
        assertEq(_cash - usdc.balanceOf(_acct), 100e6, "exactly the row's amount");
    }

    function test_an_attestorless_dispatch_lands_only_as_one_value_free_erc20_transfer() public {
        _fundWallet(backer, 100e6);
        address _acct = _account(backer);
        vm.deal(_acct, 1 ether);
        (address _rogue, IAccount.Call[] memory _drain) = _rogueDrain(_acct);
        uint _deadline = vm.getBlockTimestamp() + 300;
        IAccount.Call memory _approve = IAccount.Call({
            target: address(usdc),
            value: 0,
            gasLimit: 200_000,
            callData: abi.encodeCall(IERC20.approve, (_rogue, type(uint).max))
        });
        IAccount.Call[][] memory _refused = new IAccount.Call[][](5);
        _refused[0] = new IAccount.Call[](0);
        _refused[1] = new IAccount.Call[](2);
        _refused[1][0] = _drain[0];
        _refused[1][1] = _approve;
        _refused[2] = new IAccount.Call[](1);
        _refused[2][0] = IAccount.Call({
            target: _rogue, value: 1 ether, gasLimit: 200_000, callData: abi.encodeCall(IERC20.transfer, (_rogue, 0))
        });
        _refused[3] = new IAccount.Call[](1);
        _refused[3][0] = IAccount.Call({target: _rogue, value: 1 ether, gasLimit: 200_000, callData: ""});
        _refused[4] = new IAccount.Call[](1);
        _refused[4][0] = _approve;
        for (uint _k; _k < _refused.length; ++_k) {
            vm.prank(_rogue);
            vm.expectRevert(Error.Account__ForbiddenPull.selector);
            accountModule.dispatch(
                IAccount(_acct), address(0), bytes32(0), _deadline, "", "", _refused[_k], new address[](0)
            );
        }
        assertEq(usdc.balanceOf(_acct), 100e6, "no empty, paired, valued or non-transfer call list moves a token");
        assertEq(_acct.balance, 1 ether, "nor native");
        assertEq(usdc.allowance(_acct, _rogue), 0, "nor grants an allowance");

        vm.prank(_rogue);
        accountModule.dispatch(IAccount(_acct), address(0), bytes32(0), _deadline, "", "", _drain, new address[](0));
        assertEq(usdc.balanceOf(_rogue), 100e6, "the one shape that lands is a single value-free ERC-20 transfer");
        assertEq(_nonceOf(_acct), 0, "and spends no nonce");
    }

    function test_retire_escrow_on_the_hub_admits_only_the_users_own_account() public {
        _retireEscrowAdmitsOnlyTheOwnAccount(LiquidityGate(address(hub)), hubEscrowStore, spokeEscrowStore);
    }

    function test_retire_escrow_on_the_spoke_admits_only_the_users_own_account() public {
        _retireEscrowAdmitsOnlyTheOwnAccount(LiquidityGate(address(spoke)), spokeEscrowStore, hubEscrowStore);
    }

    function _retireEscrowAdmitsOnlyTheOwnAccount(
        LiquidityGate _gate,
        EscrowStore _store,
        EscrowStore _other
    ) internal {
        _openFund();
        _fundWallet(master, 300e6);
        _fundWallet(backer, 200e6);
        address _owner = _account(master);
        address _peer = _account(backer);
        uint _bodyCash = usdc.balanceOf(body);
        uint _escrowed = _store.escrowedMap(_owner, address(usdc));
        uint _elsewhere = _other.escrowedMap(_owner, address(usdc));

        (LiquidityGate.RetireEscrowIntent memory _i, bytes memory _sig) = _retireIntent(master, masterKey, body, 100e6);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
        _gate.retireEscrow(_i, _sig);
        (_i, _sig) = _retireIntent(master, masterKey, _peer, 100e6);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, _peer));
        _gate.retireEscrow(_i, _sig);
        (_i, _sig) = _retireIntent(backer, backerKey, _owner, 100e6);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, _owner));
        _gate.retireEscrow(_i, _sig);
        (_i, _sig) = _retireIntent(master, backerKey, _owner, 100e6);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        _gate.retireEscrow(_i, _sig);
        assertEq(
            usdc.balanceOf(body), _bodyCash, "a fund body cannot lock its holdings in escrow, even under its own pair"
        );
        assertEq(usdc.balanceOf(_peer), 200e6, "nor can anyone lock another user's account");

        (_i, _sig) = _retireIntent(master, masterKey, _owner, 100e6);
        bytes32 _d = _retireDigest(_i);
        LiquidityGate.RetireEscrowIntent[] memory _tampered = new LiquidityGate.RetireEscrowIntent[](5);
        for (uint _k; _k < 5; ++_k) {
            _tampered[_k] = LiquidityGate.RetireEscrowIntent({
                header: _header(_owner, master, _i.header.nonce), token: address(usdc), amount: 100e6
            });
        }
        _tampered[0].amount = 150e6;
        _tampered[1].token = address(wnt);
        _tampered[2].header.fee = FEE + 1;
        _tampered[3].header.feeToken = address(wnt);
        _tampered[4].header.deadline = _i.header.deadline - 1;
        for (uint _k; _k < 5; ++_k) {
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            _gate.retireEscrow(_tampered[_k], _sig);
        }
        bytes[] memory _unpaired = new bytes[](3);
        _unpaired[0] = _coSig(masterKey, _d);
        _unpaired[1] = bytes.concat(_coSig(masterKey, _d), _coSig(masterKey, _d));
        _unpaired[2] = bytes.concat(_coSig(attestorKey, _d), _coSig(attestorKey, _d));
        for (uint _k; _k < 3; ++_k) {
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            _gate.retireEscrow(_i, _unpaired[_k]);
        }
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        _gate.retireEscrow(_i, _sig);
        vm.chainId(HUB_CHAIN);

        uint _cash = usdc.balanceOf(_owner);
        uint _relay = usdc.balanceOf(feeReceiver);
        uint _storeCash = usdc.balanceOf(address(_store));
        uint _nonce = _nonceOf(_owner);
        address _relayer = makeAddr("retire-relayer");
        vm.recordLogs();
        vm.prank(_relayer);
        _gate.retireEscrow(_i, _sig);
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(
            usdc.balanceOf(_owner), _cash - 100e6 - FEE, "the user's own account pays the escrow and the relay fee"
        );
        assertEq(usdc.balanceOf(address(_store)), _storeCash + 100e6, "into the gate's own store");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "the fee to the fee receiver");
        assertEq(usdc.balanceOf(_relayer), 0, "nothing to the relayer that sent it");
        assertEq(_store.escrowedMap(_owner, address(usdc)), _escrowed + 100e6, "booked to the signing user's account");
        assertEq(_other.escrowedMap(_owner, address(usdc)), _elsewhere, "in no other store");
        assertEq(_nonceOf(_owner), _nonce + 1, "spending one nonce");
        assertEq(_calls.length, 1, "one record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(_owner))), "on the user's account");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(_gate)))), "dispatched by the gate");
        (,,, bytes32 _digest,, bytes memory _data,,, BalanceLib.Balance[] memory _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, _d, "under the digest the user and the attestor signed");
        assertEq(
            _data,
            abi.encode(
                LiquidityGate.retireEscrow.selector, address(usdc), uint(100e6), _escrowed + 100e6, address(usdc), FEE
            ),
            "carrying the escrowed total and the relay fee"
        );
        assertEq(_balances.length, 1, "with one closing balance");
        assertEq(_balances[0].amount, _cash - 100e6 - FEE, "the account's, after it");

        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, _owner, _nonce + 1, _nonce));
        _gate.retireEscrow(_i, _sig);

        (_i, _sig) = _retireIntent(backer, backerKey, _peer, 50e6);
        _gate.retireEscrow(_i, _sig);
        assertEq(_store.escrowedMap(_peer, address(usdc)), 50e6, "another user retires into its own ledger");
        assertEq(_store.escrowedMap(_owner, address(usdc)), _escrowed + 100e6, "beside the first, untouched");
    }

    function test_return_escrow_on_the_hub_pays_only_the_owners_wallet_a_day_after_its_own_request() public {
        _returnEscrowPaysOnlyTheOwnersWallet(
            LiquidityGate(address(hub)), hubEscrowStore, LiquidityGate(address(spoke)), spokeEscrowStore
        );
    }

    function test_return_escrow_on_the_spoke_pays_only_the_owners_wallet_a_day_after_its_own_request() public {
        _returnEscrowPaysOnlyTheOwnersWallet(
            LiquidityGate(address(spoke)), spokeEscrowStore, LiquidityGate(address(hub)), hubEscrowStore
        );
    }

    function _returnEscrowPaysOnlyTheOwnersWallet(
        LiquidityGate _gate,
        EscrowStore _store,
        LiquidityGate _otherGate,
        EscrowStore _other
    ) internal {
        _fundWallet(master, 50e6);
        address _owner = _account(master);
        address _peer = _account(backer);
        address _usdc = address(usdc);
        _escrowFrom(_gate, master, 100e6);
        _escrowFrom(_gate, backer, 80e6);
        _escrowFrom(_otherGate, master, 30e6);
        address _stranger = makeAddr("return-stranger");
        uint _start = vm.getBlockTimestamp();
        uint _returnAt = _start + 1 days;

        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        _gate.returnEscrow(_usdc);
        vm.prank(_stranger);
        vm.expectRevert(Error.Account__InvalidUser.selector);
        _gate.requestReturn(_usdc);
        vm.prank(_stranger);
        vm.expectRevert(Error.Account__InvalidUser.selector);
        _gate.returnEscrow(_usdc);

        vm.prank(backer);
        _gate.requestReturn(_usdc);
        assertEq(_store.returnAtMap(_peer, _usdc), _returnAt, "another wallet's request opens only its own return");
        assertEq(_store.returnAtMap(_owner, _usdc), 0, "never the owner's");

        vm.recordLogs();
        vm.prank(master);
        _gate.requestReturn(_usdc);
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(_store.returnAtMap(_owner, _usdc), _returnAt, "the owner's wallet opens its own a day from now");
        assertEq(_other.returnAtMap(_owner, _usdc), 0, "in this gate's store alone");
        assertEq(_calls.length, 1, "one record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(_owner))), "on the owner's account");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(_gate)))), "written by the gate");
        (,,, bytes32 _digest,, bytes memory _data,,, BalanceLib.Balance[] memory _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, bytes32(0), "under no signature: the caller is the owner's wallet");
        assertEq(_data, abi.encode(LiquidityGate.requestReturn.selector, _usdc, _returnAt), "naming when it opens");

        vm.warp(_returnAt - 1);
        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, _returnAt));
        _gate.returnEscrow(_usdc);

        vm.warp(_returnAt);
        uint _wallet = usdc.balanceOf(master);
        uint _peerWallet = usdc.balanceOf(backer);
        uint _cash = usdc.balanceOf(_owner);
        uint _storeCash = usdc.balanceOf(address(_store));
        _account(_stranger);
        vm.prank(_stranger);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        _gate.returnEscrow(_usdc);
        assertEq(
            _store.returnAtMap(_owner, _usdc),
            _returnAt,
            "a stranger's return acts on its own account and leaves the owner's request standing"
        );

        vm.recordLogs();
        vm.prank(master);
        _gate.returnEscrow(_usdc);
        _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(usdc.balanceOf(master), _wallet + 100e6, "the owner's wallet gets back all its open escrow");
        assertEq(usdc.balanceOf(_owner), _cash, "never the owner's account");
        assertEq(usdc.balanceOf(address(_store)), _storeCash - 100e6, "out of the gate's own store");
        assertEq(_store.heldMap(_usdc), _storeCash - 100e6, "which holds exactly what it still books");
        assertEq(_store.returnedMap(_owner, _usdc), 100e6, "at the returned total");
        assertEq(_store.returnAtMap(_owner, _usdc), 0, "spending the request");
        assertEq(_store.returnedMap(_peer, _usdc), 0, "another owner's ledger is untouched");
        assertEq(_other.returnedMap(_owner, _usdc), 0, "and so is the other store's");
        assertEq(_calls.length, 1, "one record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(_owner))), "on the owner's account");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(_gate)))), "written by the gate");
        (,,, _digest,, _data,,, _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, bytes32(0), "under no signature");
        assertEq(
            _data, abi.encode(LiquidityGate.returnEscrow.selector, _usdc, uint(100e6)), "carrying the returned total"
        );
        assertEq(_balances.length, 0, "and no account balance, since the account is not paid");

        vm.prank(master);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        _gate.returnEscrow(_usdc);
        vm.prank(master);
        _gate.requestReturn(_usdc);
        vm.warp(_returnAt + 1 days);
        vm.prank(master);
        vm.expectRevert(Error.Balance__NothingToWithdraw.selector);
        _gate.returnEscrow(_usdc);

        vm.prank(backer);
        _gate.returnEscrow(_usdc);
        assertEq(usdc.balanceOf(backer), _peerWallet + 80e6, "each owner's return pays that owner's own wallet");
        assertEq(usdc.balanceOf(address(_store)), 0, "the store paid out all it held");
        assertEq(_store.heldMap(_usdc), 0, "and books nothing more");
        assertEq(
            _other.escrowedMap(_owner, _usdc) - _other.returnedMap(_owner, _usdc),
            30e6,
            "while the other store keeps its own"
        );
    }

    function test_fulfil_settles_the_owners_signed_total_from_any_relayer_and_only_into_the_body_it_names() public {
        _openFund();
        address _owner = _account(master);
        address _peer = _account(backer);
        address _usdc = address(usdc);
        (address _twin, uint _twinKey) = makeAddrAndKey("twin-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _twinKey);
        (address _stray, uint _strayKey) = makeAddrAndKey("stray-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _strayKey);
        _depositEscrow(_usdc, 300e6);
        vm.chainId(FOREIGN_CHAIN_ID);

        bytes memory _twinSig =
            _coSig(masterKey, AccountLib.creditDigest(_owner, _twin, FOREIGN_CHAIN_ID, _usdc, 50e6, FEE));
        AccountLib.Genesis memory _genesis = AccountLib.Genesis({
            parent: _peer,
            key: _coSig(_twinKey, AccountLib.genesisDigest(address(accountModule), _twin, _owner)),
            approval: _fundApproval(backerKey, _twin)
        });
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_twin, _usdc, 50e6, FEE, _twinSig, _genesis);
        _genesis.parent = _owner;
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_twin, _usdc, 50e6, FEE, _twinSig, _genesis);
        _genesis.approval = _fundApproval(masterKey, _twin);
        spoke.fulfil(_twin, _usdc, 50e6, FEE, _twinSig, _genesis);
        (, address _twinParent) = FundAccount(payable(_twin)).bound();
        assertEq(
            _twinParent, _owner, "a fresh body binds only to the parent its own key and that owner's approval name"
        );
        assertEq(usdc.balanceOf(_twin), 50e6 - FEE, "and its first fulfil releases the owner's escrow to it");

        bytes32 _bodyDigest = AccountLib.creditDigest(_owner, body, FOREIGN_CHAIN_ID, _usdc, 100e6, FEE);
        bytes memory _bodySig = _coSig(masterKey, _bodyDigest);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_twin, _usdc, 100e6, FEE, _bodySig, _noGenesis());
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, _usdc, 50e6, FEE, _twinSig, _noGenesis());

        (, uint _sessionKey) = makeAddrAndKey("fulfil-session");
        uint _now = vm.getBlockTimestamp();
        bytes memory _sessionSig = _session(masterKey, _sessionKey, _now, _now + 1 days, 0, _bodyDigest);
        assertTrue(
            UserAccount(payable(_owner)).approves(_bodyDigest, _sessionSig),
            "the owner's account honours its session over the total"
        );
        bytes[] memory _forged = new bytes[](9);
        _forged[0] = _coSig(attestorKey, _bodyDigest);
        _forged[1] = _coSig(backerKey, _bodyDigest);
        _forged[2] = _coSig(bodyKey, _bodyDigest);
        _forged[3] = _sessionSig;
        _forged[4] = _coSig(masterKey, AccountLib.creditDigest(_owner, body, HUB_CHAIN, _usdc, 100e6, FEE));
        _forged[5] =
            _coSig(masterKey, AccountLib.creditDigest(_owner, body, FOREIGN_CHAIN_ID, address(wnt), 100e6, FEE));
        _forged[6] = _coSig(masterKey, AccountLib.creditDigest(_owner, body, FOREIGN_CHAIN_ID, _usdc, 90e6, FEE));
        _forged[7] = _coSig(masterKey, AccountLib.creditDigest(_owner, body, FOREIGN_CHAIN_ID, _usdc, 100e6, FEE / 2));
        _forged[8] = _coSig(masterKey, AccountLib.creditDigest(_peer, body, FOREIGN_CHAIN_ID, _usdc, 100e6, FEE));
        for (uint _k; _k < _forged.length; ++_k) {
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            spoke.fulfil(body, _usdc, 100e6, FEE, _forged[_k], _noGenesis());
        }

        uint _bodyCash = usdc.balanceOf(body);
        uint _relay = usdc.balanceOf(feeReceiver);
        address _relayer = makeAddr("fulfil-relayer");
        vm.recordLogs();
        vm.prank(_relayer);
        spoke.fulfil(body, _usdc, 100e6, FEE, _bodySig, _noGenesis());
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(
            usdc.balanceOf(body),
            _bodyCash + 100e6 - FEE,
            "any relayer settles the owner's signed total into the body it names"
        );
        assertEq(usdc.balanceOf(_twin), 50e6 - FEE, "in no other body of the same owner");
        assertEq(usdc.balanceOf(_relayer), 0, "nor in the relayer");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "billing the signed fee once");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, body, _usdc), 100e6, "the body's total meets the signed total");
        assertEq(spokeEscrowStore.feePaidMap(_owner, body, _usdc), FEE, "and its fee total the signed fee total");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, _twin, _usdc), 50e6, "each body keeps its own total");
        assertEq(
            spokeEscrowStore.releasedMap(_owner, _usdc),
            150e6,
            "both drawn on the one owner, read as each body's parent"
        );
        assertEq(_calls.length, 1, "one record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(body))), "on the body");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(spoke)))), "written by the spoke gate");
        (,,, bytes32 _digest,, bytes memory _data,,, BalanceLib.Balance[] memory _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, _bodyDigest, "under the owner's credit digest for that body");
        assertEq(
            _data,
            abi.encode(SpokeGate.fulfil.selector, _usdc, uint(100e6), FEE),
            "naming no owner: the owner is the body's parent"
        );
        assertEq(_balances[0].amount, _bodyCash + 100e6 - FEE, "with the body's balance after it");

        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 100e6, 100e6));
        spoke.fulfil(body, _usdc, 100e6, FEE, _bodySig, _noGenesis());
        spoke.fulfil(
            body,
            _usdc,
            160e6,
            2 * FEE,
            _coSig(masterKey, AccountLib.creditDigest(_owner, body, FOREIGN_CHAIN_ID, _usdc, 160e6, 2 * FEE)),
            _noGenesis()
        );
        assertEq(usdc.balanceOf(body), _bodyCash + 160e6 - 2 * FEE, "a later total settles only what it adds");
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 160e6, 100e6));
        spoke.fulfil(body, _usdc, 100e6, FEE, _bodySig, _noGenesis());

        _genesis = AccountLib.Genesis({
            parent: _peer,
            key: _coSig(_strayKey, AccountLib.genesisDigest(address(accountModule), _stray, _peer)),
            approval: _fundApproval(backerKey, _stray)
        });
        bytes memory _strayByOwner =
            _coSig(masterKey, AccountLib.creditDigest(_owner, _stray, FOREIGN_CHAIN_ID, _usdc, 50e6, FEE));
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_stray, _usdc, 50e6, FEE, _strayByOwner, _genesis);
        bytes memory _strayByPeer =
            _coSig(backerKey, AccountLib.creditDigest(_peer, _stray, FOREIGN_CHAIN_ID, _usdc, 50e6, FEE));
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 50e6));
        spoke.fulfil(_stray, _usdc, 50e6, FEE, _strayByPeer, _genesis);
        assertEq(
            spokeEscrowStore.releasedMap(_owner, _usdc),
            210e6,
            "a body bound to another owner never draws on this owner's escrow"
        );

        address _plain = makeAddr("plain-address");
        bytes memory _plainSig =
            _coSig(masterKey, AccountLib.creditDigest(_owner, _plain, FOREIGN_CHAIN_ID, _usdc, 50e6, FEE));
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NotDelegated.selector, _plain));
        spoke.fulfil(_plain, _usdc, 50e6, FEE, _plainSig, _noGenesis());
    }

    function test_a_local_credit_releases_the_owners_hub_escrow_only_under_the_owners_signed_total() public {
        _openFund();
        _escrowOnHub(address(usdc), 100e6);
        _escrowFrom(LiquidityGate(address(hub)), backer, 400e6);
        address _owner = _account(master);
        address _peer = _account(backer);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        bytes32 _total = AccountLib.creditDigest(
            _owner, body, _i.credit.chainId, _i.credit.token, _i.credit.total, _i.credit.feeTotal
        );
        (Fund.AllocateIntent memory _smaller,) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 50e6), new Fund.Allocation[](0)
        );
        uint _ownerNonce = _nonceOf(_owner);

        bytes[] memory _refused = new bytes[](7);
        _refused[0] = "";
        _refused[1] = _coSig(masterKey, _allocateDigest(_i));
        _refused[2] = _coSig(backerKey, _total);
        _refused[3] = _coSig(attestorKey, _total);
        _refused[4] = _sig;
        _refused[5] = _ownerCoSig(_smaller);
        _refused[6] = _coSig(
            masterKey,
            AccountLib.creditDigest(
                _peer, body, _i.credit.chainId, _i.credit.token, _i.credit.total, _i.credit.feeTotal
            )
        );
        for (uint _k; _k < _refused.length; ++_k) {
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.allocate(_i, _sig, _refused[_k]);
        }
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)), 500e6, "no refused signature released the owner's escrow"
        );

        (Fund.AllocateIntent memory _over, bytes memory _overSig) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 200e6), new Fund.Allocation[](0)
        );
        bytes memory _overTotal = _ownerCoSig(_over);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 100e6, 200e6));
        hub.allocate(_over, _overSig, _overTotal);
        assertEq(
            hubEscrowStore.releasedMap(_peer, address(usdc)),
            0,
            "another owner's escrow in the same store is out of the round's reach"
        );

        uint _bodyCash = usdc.balanceOf(body);
        uint _cash = usdc.balanceOf(_owner);
        uint _relay = usdc.balanceOf(feeReceiver);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.recordLogs();
        hub.allocate(_i, _sig, _ownerSig);
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)),
            600e6,
            "the owner's signed total releases the credit from its hub escrow"
        );
        assertEq(hubEscrowStore.fulfilledMap(_owner, body, address(usdc)), 600e6, "booked to the body it funds");
        assertEq(usdc.balanceOf(body), _bodyCash + 100e6 - FEE, "which receives it net of the master slice");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "billed by the store to its fee receiver");
        assertEq(usdc.balanceOf(_owner), _cash, "while the owner's account pays nothing");
        assertEq(
            hubEscrowStore.escrowedMap(_peer, address(usdc)) - hubEscrowStore.releasedMap(_peer, address(usdc)),
            400e6,
            "and the other owner's escrow stays whole"
        );
        assertEq(_nonceOf(_owner), _ownerNonce, "the signed total spends no owner nonce");
        assertEq(_calls.length, 2, "the round writes the owner's credit and the body's record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(_owner))), "the credit first, on the owner's account");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(fundModule)))), "written by the fund module");
        (,,, bytes32 _digest,, bytes memory _data, IAccount.Call[] memory _callList,,) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, _total, "under the owner's credit digest");
        assertEq(
            _data,
            abi.encode(Fund.allocate.selector, body, _i.credit),
            "naming the body and the signed totals"
        );
        assertEq(_callList.length, 0, "with no call: the credit moves nothing of the owner's account");
        assertEq(_calls[1].topics[1], bytes32(uint(uint160(body))), "then the body's own record");

        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, 2, 1));
        hub.allocate(_i, _sig, _ownerSig);
        (Fund.AllocateIntent memory _again,) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        _again.credit = _i.credit;
        bytes memory _againSig = _pair(masterKey, _allocateDigest(_again));
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__CreditNotIncreasing.selector, 600e6, 600e6));
        hub.allocate(_again, _againSig, _ownerSig);
    }

    function test_an_allocate_signed_over_an_old_shape_does_not_verify() public {
        _openFund();
        _escrowOnHub(address(usdc), 100e6);
        address _owner = _account(master);
        (Fund.AllocateIntent memory _i, bytes memory _honest) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        bytes32 _oldCredit = keccak256(
            abi.encode(
                keccak256("Credit(uint256 chainId,address token,uint256 amount)"),
                _i.credit.chainId,
                _i.credit.token,
                _i.credit.total
            )
        );
        bytes32[2] memory _old = [
            keccak256(
                abi.encode(
                    keccak256(
                        "AllocateIntent(IntentHeader header,address shareToken,Valuation valuation,uint256 feeShares,address token,Price price,Credit credit,bytes32 allocationListHash)Asset(uint256 chainId,address token,uint256 id,uint256 amount,uint256 value)Credit(uint256 chainId,address token,uint256 amount)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)Position(uint256 chainId,bytes32 venue,bytes32 id,uint256 value)Price(uint256 amount,uint256 value)Valuation(Asset[] assetList,Position[] positionList)"
                    ),
                    _hashHeader(_i.header),
                    _i.shareToken,
                    _valuationHash(_i.valuation),
                    uint(0),
                    _i.token,
                    keccak256(abi.encode(PRICE_TYPEHASH, _i.price.amount, _i.price.value)),
                    _oldCredit,
                    keccak256(abi.encode(_i.allocationList))
                )
            ),
            keccak256(
                abi.encode(
                    keccak256(
                        "AllocateIntent(IntentHeader header,address shareToken,Valuation valuation,address token,Price price,Credit credit,bytes32 allocationListHash)Asset(uint256 chainId,address token,uint256 id,uint256 amount,uint256 value)Credit(uint256 chainId,address token,uint256 amount)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)Position(uint256 chainId,bytes32 venue,bytes32 id,uint256 value)Price(uint256 amount,uint256 value)Valuation(Asset[] assetList,Position[] positionList)"
                    ),
                    _hashHeader(_i.header),
                    _i.shareToken,
                    _valuationHash(_i.valuation),
                    _i.token,
                    keccak256(abi.encode(PRICE_TYPEHASH, _i.price.amount, _i.price.value)),
                    _oldCredit,
                    keccak256(abi.encode(_i.allocationList))
                )
            )
        ];
        bytes memory _total = _ownerCoSig(_i);
        uint _bodyNonce = _nonceOf(body);

        for (uint _k; _k < _old.length; ++_k) {
            assertTrue(_old[_k] != _allocateStructHash(_i), "an old shape hashes to another struct");
            bytes memory _oldBody = _pair(masterKey, _typed(body, _i.header.deadline, _old[_k]));
            bytes memory _oldConsent = _pair(masterKey, _typed(_owner, _i.header.deadline, _old[_k]));
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.allocate(_i, _oldBody, _total);
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.allocate(_i, _honest, _oldConsent);
        }
        assertEq(_nonceOf(body), _bodyNonce, "an old-shape body signature spends no body nonce");
        assertEq(
            hubEscrowStore.releasedMap(_owner, address(usdc)),
            500e6,
            "and neither it nor an old-shape consent releases the owner's escrow"
        );

        hub.allocate(_i, _honest, _total);
        assertEq(_nonceOf(body), _bodyNonce + 1, "the same round signed over the new shape lands");
        assertEq(hubEscrowStore.releasedMap(_owner, address(usdc)), 600e6, "and draws its credit");
    }

    function test_a_redeem_signed_over_the_old_shape_with_fee_shares_and_retire_chain_does_not_verify() public {
        uint _shares = _backed();
        address _holder = _account(backer);
        _sell(backer, backerKey, _shares / 2);
        _wethTo(body, 3000 ether);
        Redeem.RedeemIntent memory _i = _redeemIntent(0, 0, _valuation(_nav()));
        bytes32 _old = keccak256(
            abi.encode(
                keccak256(
                    "RedeemIntent(IntentHeader header,address shareToken,Valuation valuation,uint256 feeShares,address token,uint256 fraction,uint256 join,uint256 retireChainId)Asset(uint256 chainId,address token,uint256 id,uint256 amount,uint256 value)IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)Position(uint256 chainId,bytes32 venue,bytes32 id,uint256 value)Valuation(Asset[] assetList,Position[] positionList)"
                ),
                _hashHeader(_i.header),
                _i.shareToken,
                _valuationHash(_i.valuation),
                uint(0),
                _i.token,
                _i.fraction,
                _i.join,
                block.chainid
            )
        );
        bytes memory _oldSig = _pair(masterKey, _typed(body, _i.header.deadline, _old));
        bytes memory _sig = _redeemSig(_i);
        uint _nonce = _nonceOf(body);
        uint _paid = wnt.balanceOf(_holder);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.redeem(_i, _oldSig, _list(_holder));
        assertEq(fundStore.getRedemption(body).id, 0, "a redeem signed over the old shape opens nothing");
        assertEq(_nonceOf(body), _nonce, "spends no body nonce");
        assertEq(wnt.balanceOf(_holder), _paid, "and pays no holder");

        hub.redeem(_i, _sig, _list(_holder));
        assertEq(fundStore.getRedemption(body).id, 1, "the same redemption signed over the new shape opens");
        assertGt(wnt.balanceOf(_holder), _paid, "and pays its cohort");
    }

    function test_each_escrow_store_answers_only_to_its_own_gates() public {
        _openFund();
        address _owner = _account(master);
        address _usdc = address(usdc);
        address _stranger = makeAddr("store-stranger");
        address[] memory _refused = new address[](10);
        _refused[0] = _stranger;
        _refused[1] = master;
        _refused[2] = _owner;
        _refused[3] = body;
        _refused[4] = owner;
        _refused[5] = address(governorAccount);
        _refused[6] = address(accountModule);
        _refused[7] = address(depositModule);
        _refused[8] = address(redeemModule);
        _refused[9] = attestor;
        for (uint _k; _k < _refused.length; ++_k) {
            _refuses(hubEscrowStore, _refused[_k]);
            _refuses(spokeEscrowStore, _refused[_k]);
        }
        _refuses(hubEscrowStore, address(spoke));
        _refuses(spokeEscrowStore, address(hub));
        _refuses(spokeEscrowStore, address(fundModule));

        EscrowStore[2] memory _stores = [hubEscrowStore, spokeEscrowStore];
        address[2] memory _gates = [address(hub), address(spoke)];
        for (uint _s; _s < 2; ++_s) {
            address[3] memory _granters = [_stranger, _gates[_s], owner];
            for (uint _k; _k < 3; ++_k) {
                vm.prank(_granters[_k]);
                vm.expectRevert(Error.Access__CallerNotAuthority.selector);
                _stores[_s].setAccess(_stranger, FULL_ACCESS);
            }
        }

        uint _start = vm.getBlockTimestamp();
        uint _bodyBefore = usdc.balanceOf(body);
        uint _walletBefore = usdc.balanceOf(master);
        usdc.mint(address(hubEscrowStore), 100e6);
        vm.prank(address(hub));
        hubEscrowStore.escrow(_owner, _usdc, 100e6);
        uint _fulfilled = hubEscrowStore.fulfilledMap(_owner, body, _usdc) + 60e6;
        uint _feePaid = hubEscrowStore.feePaidMap(_owner, body, _usdc);
        vm.prank(address(fundModule));
        hubEscrowStore.release(_owner, body, _usdc, _fulfilled, _feePaid, feeReceiver, 200_000);
        vm.prank(address(hub));
        hubEscrowStore.requestReturn(_owner, _usdc);
        vm.warp(_start + ESCROW_RETURN_DELAY);
        vm.prank(address(hub));
        hubEscrowStore.refund(_owner, _usdc, 200_000);
        assertEq(usdc.balanceOf(body) - _bodyBefore, 60e6, "the hub store releases for the fund module");
        assertEq(usdc.balanceOf(master) - _walletBefore, 40e6, "and books and returns for its own gate");
        assertEq(hubEscrowStore.heldMap(_usdc), 0, "holding nothing after");

        usdc.mint(address(spokeEscrowStore), 100e6);
        vm.prank(address(spoke));
        spokeEscrowStore.escrow(_owner, _usdc, 100e6);
        vm.prank(address(spoke));
        spokeEscrowStore.release(_owner, body, _usdc, 60e6, 0, feeReceiver, 200_000);
        vm.prank(address(spoke));
        spokeEscrowStore.requestReturn(_owner, _usdc);
        vm.warp(_start + 2 * ESCROW_RETURN_DELAY);
        vm.prank(address(spoke));
        spokeEscrowStore.refund(_owner, _usdc, 200_000);
        assertEq(usdc.balanceOf(body) - _bodyBefore, 120e6, "the spoke store releases for its own gate");
        assertEq(usdc.balanceOf(master) - _walletBefore, 80e6, "and books and returns for it");
        assertEq(spokeEscrowStore.heldMap(_usdc), 0, "holding nothing after");

        vm.prank(address(governorAccount));
        hubEscrowStore.setAccess(address(hub), bytes4(0));
        usdc.mint(master, 10e6);
        vm.startPrank(master);
        IERC20(_usdc).approve(address(depositModule), 10e6);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        hub.depositEscrow(_usdc, 10e6);
        vm.stopPrank();
    }

    function testFuzz_escrow_ledgers_net_to_their_balance_deltas_per_store_and_owner(
        uint _deposit,
        uint _retire,
        uint _release,
        bool _return
    ) public {
        _deposit = bound(_deposit, 10e6, 1e12);
        _retire = bound(_retire, 10e6, 1e12);
        _release = bound(_release, 10e6, _deposit + _retire);
        _openFund();
        _fundWallet(master, 2 * (_retire + FEE));
        address _owner = _account(master);
        address _usdc = address(usdc);
        for (uint _s; _s < 2; ++_s) {
            LiquidityGate _gate = _s == 0 ? LiquidityGate(address(hub)) : LiquidityGate(address(spoke));
            EscrowStore _store = _s == 0 ? hubEscrowStore : spokeEscrowStore;
            uint _open = _store.escrowedMap(_owner, _usdc) - _store.releasedMap(_owner, _usdc)
                - _store.returnedMap(_owner, _usdc);
            uint _storeCash = usdc.balanceOf(address(_store));
            uint _bodyCash = usdc.balanceOf(body);
            uint _wallet = usdc.balanceOf(master);
            uint _cash = usdc.balanceOf(_owner);
            uint _relay = usdc.balanceOf(feeReceiver);

            _escrowFrom(_gate, master, _deposit);
            _escrowFrom(_gate, backer, 50e6);
            (LiquidityGate.RetireEscrowIntent memory _i, bytes memory _sig) =
                _retireIntent(master, masterKey, _owner, _retire);
            _gate.retireEscrow(_i, _sig);
            if (_s == 0) {
                (Fund.AllocateIntent memory _round, bytes memory _roundSig) = _allocateIntent(
                    _nonceOf(body), _nav(), _credit(block.chainid, _usdc, _release), new Fund.Allocation[](0)
                );
                hub.allocate(_round, _roundSig, _ownerCoSig(_round));
            } else {
                _fulfil(
                    _usdc,
                    spokeEscrowStore.fulfilledMap(_owner, body, _usdc) + _release,
                    spokeEscrowStore.feePaidMap(_owner, body, _usdc) + FEE
                );
            }
            uint _returned;
            if (_return) {
                _returned = _open + _deposit + _retire - _release;
                vm.prank(master);
                _gate.requestReturn(_usdc);
                vm.warp(vm.getBlockTimestamp() + ESCROW_RETURN_DELAY);
                if (_returned == 0) vm.expectRevert(Error.Balance__NothingToWithdraw.selector);
                vm.prank(master);
                _gate.returnEscrow(_usdc);
            }
            assertEq(
                usdc.balanceOf(address(_store)),
                _storeCash + _deposit + 50e6 + _retire - _release - _returned,
                "the store moved exactly its entries"
            );
            assertEq(_store.heldMap(_usdc), usdc.balanceOf(address(_store)), "and holds what its ledger books");
            assertEq(
                _store.escrowedMap(_owner, _usdc) - _store.releasedMap(_owner, _usdc)
                    - _store.returnedMap(_owner, _usdc),
                _open + _deposit + _retire - _release - _returned,
                "the owner's open escrow nets its entries"
            );
            assertEq(
                _store.escrowedMap(_account(backer), _usdc) - _store.releasedMap(_account(backer), _usdc),
                50e6,
                "beside another owner's, untouched"
            );
            assertEq(usdc.balanceOf(body), _bodyCash + _release - FEE, "the release lands in the body net of its fee");
            assertEq(usdc.balanceOf(master), _wallet + _returned, "the return lands in the owner's wallet");
            assertEq(usdc.balanceOf(_owner), _cash - _retire - FEE, "the account paid its retire and that relay fee");
            assertEq(
                usdc.balanceOf(feeReceiver),
                _relay + 2 * FEE,
                "the fee receiver took the retire fee and the release fee"
            );
        }
        assertEq(
            hubEscrowStore.escrowedMap(_owner, _usdc),
            500e6 + _deposit + _retire,
            "the hub store books only the hub's entries"
        );
        assertEq(
            spokeEscrowStore.escrowedMap(_owner, _usdc), _deposit + _retire, "and the spoke store only the spoke's"
        );
    }
}
