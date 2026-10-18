// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {HubGate, CREDIT_TYPEHASH, MANDATE_INTENT_TYPEHASH, MAX_SKIN, PRICE_TYPEHASH, SELL_INTENT_TYPEHASH} from "src/HubGate.sol";
import {FULFIL_TYPEHASH, SpokeGate} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Deposit} from "src/core/Deposit.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {Fund, VIRTUAL_SHARES, VIRTUAL_VALUE} from "src/core/Fund.sol";
import {Redeem} from "src/core/Redeem.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {GRID_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib, MAX_SESSION_BYTES, SESSION_REVOKE_DELAY, WALLET_SIGNATURE_TAG} from "src/utils/AccountLib.sol";
import {MandateLib} from "src/utils/MandateLib.sol";
import {BalanceLib} from "src/utils/BalanceLib.sol";
import {Error} from "src/utils/Error.sol";
import {GateConfig} from "src/utils/GateConfig.sol";
import {
    LiquidityGate,
    RETIRE_ESCROW_INTENT_TYPEHASH,
    RETURN_ESCROW_TYPEHASH,
    WITHDRAW_INTENT_TYPEHASH
} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {SwapLib} from "src/utils/SwapLib.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

import {HotPathTest} from "./HotPath.t.sol";
import {MockMultisig1271} from "./mock/MockMultisig1271.t.sol";
import {MockWallet1271} from "./mock/MockWallet1271.t.sol";

contract AuthMatrixTestWallet {
    UserAccount internal immutable account;
    bytes4 internal immutable selfCall;
    bool internal immutable swallow;
    bytes public caught;

    constructor(
        UserAccount _account,
        bytes4 _selfCall,
        bool _swallow
    ) {
        account = _account;
        selfCall = _selfCall;
        swallow = _swallow;
    }

    receive() external payable {
        (bool _ok, bytes memory _ret) = address(account).call(abi.encodeWithSelector(selfCall));
        if (_ok) return;
        if (!swallow) {
            assembly ("memory-safe") {
                revert(add(_ret, 32), mload(_ret))
            }
        }
        caught = _ret;
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
        hub.createFund(bytes32("AUTH"), _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i));
    }

    function _rogueDrain(
        address _acct
    ) internal returns (address rogue_, IAccount.Call[] memory drain_) {
        rogue_ = makeAddr("rogue-dispatcher");
        vm.prank(owner);
        dictate.setAccess(accountModule, rogue_);
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
        accountModule.dispatch(IAccount(_acct), attestor, _structHash, _w.header.deadline, _landed, "", _drain, new address[](0));
        assertEq(usdc.balanceOf(_rogue), 0, "a landed signature is spent: its nonce is behind the account");

        bytes memory _fresh = _pair(backerKey, _typed(_acct, _w.header.deadline, _structHash));
        vm.prank(_rogue);
        accountModule.dispatch(IAccount(_acct), attestor, _structHash, _w.header.deadline, _fresh, "", _drain, new address[](0));
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
            master: body, skin: MAX_SKIN, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
        _mandate(backer, backerKey, _one);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = _row(_account(backer), _one[0], 400e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
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
        i_ = Redeem.SellIntent({header: _header(_acct, backer, _nonceOf(_acct)), shareToken: shareToken, shares: _shares});
        i_.header.deadline = vm.getBlockTimestamp() + 300;
        digest_ = _typed(
            _acct, i_.header.deadline, keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(i_.header), i_.shareToken, i_.shares))
        );
    }

    function _etchedWallet(
        string memory _name,
        bytes4 _selfCall,
        bool _swallow
    ) internal returns (address user_, uint key_, UserAccount ua_) {
        (user_, key_) = makeAddrAndKey(_name);
        ua_ = UserAccount(payable(accountModule.predictUserAccount(user_)));
        vm.etch(user_, address(new AuthMatrixTestWallet(ua_, _selfCall, _swallow)).code);
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
            master: body, skin: MAX_SKIN, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
        bytes[] memory _sigs = new bytes[](1);
        _sigs[0] = _walletSigned(_a, _b, this.digestOf(_acct, _one[0]));
        HubGate.MandateIntent memory _m =
            HubGate.MandateIntent({header: _header(_acct, _wallet, _nonceOf(_acct)), mandateList: _one, signatureList: _sigs});
        bytes32 _md = _typed(
            _acct,
            _m.header.deadline,
            keccak256(abi.encode(MANDATE_INTENT_TYPEHASH, _hashHeader(_m.header), keccak256(abi.encode(_one))))
        );

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.mandate(_m, bytes.concat(WALLET_SIGNATURE_TAG, _coSig(_a, _md), _coSig(attestorKey, _md)));
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.mandate(_m, bytes.concat(_walletSigned(_b, _a, _md), _coSig(attestorKey, _md)));

        hub.mandate(_m, bytes.concat(_walletSigned(_a, _b, _md), _coSig(attestorKey, _md)));
        assertEq(mandateStore.mandateMap(_acct, body), MandateLib.digest(_acct, _one[0]), "both owners' signatures registered the mandate");

        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = Fund.Allocation({puppet: _acct, mandate: _one[0], signature: _sigs[0], amount: 400e6});
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        uint _cash = usdc.balanceOf(_acct);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _shares = shareToken.balanceOf(_acct);
        assertGt(_shares, 0, "the round pulled under the wallet-signed mandate");
        assertEq(_cash - usdc.balanceOf(_acct), 400e6, "exactly the row's amount");

        Redeem.SellIntent memory _s =
            Redeem.SellIntent({header: _header(_acct, _wallet, _nonceOf(_acct)), shareToken: shareToken, shares: _shares / 2});
        bytes32 _sd = _typed(
            _acct, _s.header.deadline, keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(_s.header), _s.shareToken, _s.shares))
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

        assertTrue(_yes.approves(_d, bytes.concat(WALLET_SIGNATURE_TAG, new bytes(MAX_SESSION_BYTES - 32))), "up to the approval cap");
        assertFalse(
            _yes.approves(_d, bytes.concat(WALLET_SIGNATURE_TAG, new bytes(MAX_SESSION_BYTES - 31))),
            "and never past it, even for a wallet that approves everything"
        );

        (address _eoa, uint _eoaKey) = makeAddrAndKey("tagged-eoa");
        UserAccount _plain = UserAccount(payable(_account(_eoa)));
        assertFalse(_plain.approves(_d, bytes.concat(WALLET_SIGNATURE_TAG, _coSig(_eoaKey, _d))), "a wallet with no code approves nothing under the tag");
        assertTrue(_plain.approves(_d, _coSig(_eoaKey, _d)), "while its plain signature still approves");
        assertFalse(_plain.approves(bytes32(uint(_d) + 1), bytes.concat(WALLET_SIGNATURE_TAG, _coSig(_eoaKey, _d))), "nor another digest");
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
        assertEq(_ua.epoch(), 1, "the wallet's revoke advances the epoch");
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        assertEq(_logs.length, 1, "the revoke writes one record");
        assertEq(_logs[0].emitter, address(accountModule), "through the module");
        assertEq(_logs[0].topics[0], AccountModule.AccountCall.selector, "as an AccountCall");
        assertEq(_logs[0].topics[1], bytes32(uint(uint160(address(_ua)))), "for the account");
        assertEq(_logs[0].topics[2], bytes32(uint(uint160(address(_ua)))), "sourced from the account itself");
        (,,,,, bytes memory _executionData) = abi.decode(_logs[0].data, (uint, uint, uint, bytes32, bytes, bytes));
        assertEq(_executionData, abi.encode(UserAccount.revokeSessions.selector, uint(1)), "carrying the new epoch");

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
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)));
        assertEq(_ua.nonce(), _nonce, "a refused approval consumes no nonce");

        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 1 days, 1, _d), _coSig(attestorKey, _d)));
        assertEq(fundStore.getRedemption(body).queued, _shares / 2, "a grant re-signed at the new epoch is honoured");
        assertEq(_ua.nonce(), _nonce + 1, "and consumes the nonce");
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
        hub.allocate(_i, bytes.concat(_session(bodyKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)), _ownerSig);

        hub.allocate(_i, bytes.concat(_session(masterKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)), _ownerCoSig(_i));
        assertEq(
            shareToken.balanceOf(body) - _held,
            Math.mulDiv(100e6 * USD - FEE * USD, _supply + VIRTUAL_SHARES, _valueOf(_i.valuation) + VIRTUAL_VALUE),
            "the credit mints the master's shares at the signed valuation"
        );
        assertEq(usdc.balanceOf(body), _cash + 100e6 - FEE, "the released credit lands in the body net of the round fee");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "the round fee is billed once");
        assertEq(
            hubEscrowStore.releasedMap(address(_parent), address(usdc)), 600e6, "drawn from the owner's hub escrow"
        );
        assertEq(_nonceOf(body), 2, "the body consumed its second nonce");
        assertEq(_parent.nonce(), _parentNonce + 1, "the parent spends one nonce on its co-signed consent");

        vm.prank(master);
        _parent.revokeSessions();
        vm.warp(_now + SESSION_REVOKE_DELAY);
        (_i,) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        _d = _allocateDigest(_i);
        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, bytes.concat(_session(masterKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)), _ownerSig);

        hub.allocate(_i, bytes.concat(_session(masterKey, _sessionKey, _now, _now + 1 days, 1, _d), _coSig(attestorKey, _d)), _ownerCoSig(_i));
        assertEq(_nonceOf(body), 3, "revoking on the parent retires the body's session authority until re-granted");
        assertEq(hubEscrowStore.releasedMap(address(_parent), address(usdc)), 700e6, "and the re-granted round draws its credit");
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
            AccountLib.sessionDigest(address(accountModule), backer, _sessionSigner, _now, _now + 1 hours, 0, address(0))
        );
        bytes memory _inner = _coSig(_sessionKey, _d);
        assertTrue(
            UserAccount(payable(_acct)).approves(_d, abi.encode(_sessionSigner, _now, _now + 1 hours, uint(0), address(0), _grant, _inner)),
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
                    AccountLib.sessionDigest(address(accountModule), backer, _sessionSigner, _now, _now + 1 days, 0, address(0))
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
                    AccountLib.sessionDigest(address(accountModule), backer, _sessionSigner, _now, _now + 1 days, 0, address(0))
                ),
                _coSig(_forgerKey, _d)
            ),
            _attest
        );
        _bad[7] = bytes.concat(_approval, _r, _vs);
        _bad[8] = "";
        _bad[9] = bytes.concat(abi.encode(_sessionSigner, _now, _now + 1 days, uint(0), address(0), _grant, _inner), _attest);
        _bad[10] = bytes.concat(abi.encode(_sessionSigner, _now - 1, _now + 1 hours, uint(0), address(0), _grant, _inner), _attest);
        _bad[11] = bytes.concat(abi.encode(_forger, _now, _now + 1 hours, uint(0), address(0), _grant, _coSig(_forgerKey, _d)), _attest);
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
                    AccountLib.sessionDigest(address(accountModule), _other, _sessionSigner, _now, _now + 1 hours, 0, address(0))
                ),
                _inner
            ),
            _attest
        );
        _bad[14] = bytes.concat(abi.encode(_sessionSigner, _now, _now + 1 hours, uint(1), address(0), _grant, _inner), _attest);
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
        assertEq(
            hubEscrowStore.releasedMap(_account(master), address(usdc)), 500e6, "nor released the owner's escrow"
        );

        assertEq(_honest, bytes.concat(_coSig(masterKey, _d), _attest), "the honest pair is the parent's wallet then the attestor");
        hub.allocate(_i, _honest, _ownerCoSig(_i));
        assertEq(_nonceOf(body), 2, "the parent's wallet with the attestor approves the body");
        assertEq(hubEscrowStore.releasedMap(_account(master), address(usdc)), 600e6, "and its round draws the credit");
    }

    function _selfCallInsideDispatch(
        string memory _name,
        bytes4 _selfCall
    ) internal returns (address user_, UserAccount ua_) {
        uint _key;
        (user_, _key, ua_) = _etchedWallet(_name, _selfCall, false);
        (Deposit.SwapIntent memory _i, bytes memory _sig) = _nativeWithdraw(user_, _key, ua_);

        vm.expectRevert(Error.Account__Executing.selector);
        hub.withdraw(_i, _sig);
        assertEq(ua_.nonce(), 0, "the dispatch never landed");
        assertEq(ua_.epoch(), 0, "no revoke landed inside it");
        assertEq(address(ua_).balance, 1 ether, "no native left the account");
    }

    function test_wallet_cannot_revoke_inside_its_own_dispatch() public {
        (address _user, UserAccount _ua) =
            _selfCallInsideDispatch("wallet-revoke", UserAccount.revokeSessions.selector);
        vm.prank(_user);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), 1, "the same revoke lands outside a dispatch");
    }

    function test_swallowed_self_call_keeps_records_in_execution_order() public {
        (address _user, uint _key, UserAccount _ua) =
            _etchedWallet("wallet-swallow", UserAccount.revokeSessions.selector, true);
        (Deposit.SwapIntent memory _i, bytes memory _sig) = _nativeWithdraw(_user, _key, _ua);
        bytes32 _d = _typed(
            address(_ua),
            _i.header.deadline,
            keccak256(
                abi.encode(WITHDRAW_INTENT_TYPEHASH, _hashHeader(_i.header), _i.destinationChainId, _hashSwap(_i.swap))
            )
        );
        uint _walletBefore = _user.balance;

        vm.recordLogs();
        hub.withdraw(_i, _sig);
        assertEq(
            AuthMatrixTestWallet(payable(_user)).caught(),
            abi.encodeWithSelector(Error.Account__Executing.selector),
            "the nested revoke was refused as executing"
        );
        assertEq(_ua.epoch(), 0, "so the epoch did not move mid-dispatch");
        assertEq(_ua.nonce(), 1, "while the dispatch itself landed");
        assertEq(_user.balance, _walletBefore + 0.5 ether - 1e15, "and paid the wallet");

        vm.prank(_user);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), 1, "the revoke lands once the dispatch is over");

        Vm.Log[] memory _logs = vm.getRecordedLogs();
        assertEq(_logs.length, 2, "one record per landed action, none nested");
        for (uint _k; _k < 2; ++_k) {
            assertEq(_logs[_k].emitter, address(accountModule), "each record comes from the module");
            assertEq(_logs[_k].topics[0], AccountModule.AccountCall.selector, "as an AccountCall");
            assertEq(_logs[_k].topics[1], bytes32(uint(uint160(address(_ua)))), "for the wallet's account");
        }
        assertEq(_logs[0].topics[2], bytes32(uint(uint160(address(depositModule)))), "the dispatch is recorded first");
        (,,, bytes32 _digest,, bytes memory _withdrawData,,, BalanceLib.Balance[] memory _balances) = abi.decode(
            _logs[0].data,
            (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, _d, "under the withdraw digest");
        assertEq(bytes4(abi.decode(_withdrawData, (bytes32))), Deposit.withdraw.selector, "as the withdraw");
        assertEq(_balances.length, 1, "with one closing balance");
        assertEq(_balances[0].token, NATIVE_TOKEN, "in native");
        assertEq(_balances[0].amount, 0.5 ether, "taken after the dispatch closed");
        assertEq(_logs[1].topics[2], bytes32(uint(uint160(address(_ua)))), "the revoke follows, sourced from the account");
        (,,,,, bytes memory _revokeData) = abi.decode(_logs[1].data, (uint, uint, uint, bytes32, bytes, bytes));
        assertEq(_revokeData, abi.encode(UserAccount.revokeSessions.selector, uint(1)), "at the next epoch");
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
        hub.createFund(bytes32("AUTH"), _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerSig);

        (_i, _sig) = _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        hub.createFund(bytes32("AUTH"), _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i));
        assertEq(_nonceOf(body), 1, "the opening allocate consumed the body's nonce 0");
        assertEq(_nonceOf(_parent), 2, "and the parent's co-signed consent one of its own");

        _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, 1, 0));
        hub.allocate(_i, _sig, _ownerSig);
        assertEq(shareToken.balanceOf(body), 499e18, "the replayed round minted nothing more");
        assertEq(hubEscrowStore.releasedMap(_parent, address(usdc)), 500e6, "released the owner's escrow once");
        assertEq(usdc.balanceOf(_parent), 1990e6, "and never touched the owner's account");
    }

    function test_the_hub_gate_names_its_release_and_attestor_endpoints_and_only_governance_moves_them() public {
        assertEq(hub.websiteRelease(), WEBSITE_RELEASE, "the hub names its approved website release through the proxy in one call");
        assertEq(hub.attestorEndpoints().length, 1, "the hub lists where its attestor answers");
        assertEq(hub.attestorEndpoints()[0], ATTESTOR_ENDPOINT, "through the proxy, from the implementation's storage");
        bytes32 _next = keccak256("the next website release");
        string memory _nextEndpoint = "https://attestor.example/next";
        address _nextImpl = address(
            new HubGate(
                accountModule, depositModule, hubEscrowStore, mandateStore, fundModule, redeemModule, hub.getConfig(), _endpoints(_nextEndpoint), _list(address(usdc), address(wnt)), 50, 1000, _next
            )
        );
        vm.prank(makeAddr("release-rogue"));
        vm.expectRevert(Error.Dictate__Unauthorized.selector);
        dictate.setGate(bytes32("HubGate"), _nextImpl);
        assertEq(hub.websiteRelease(), WEBSITE_RELEASE, "no one but governance moves it");
        assertEq(hub.attestorEndpoints()[0], ATTESTOR_ENDPOINT, "nor the endpoints");

        vm.prank(owner);
        dictate.setGate(bytes32("HubGate"), _nextImpl);
        assertEq(hub.websiteRelease(), _next, "approving a release is a governance upgrade of the hub's config");
        assertEq(hub.attestorEndpoints()[0], _nextEndpoint, "and moving an endpoint is the same upgrade");

        GateConfig memory _config = hub.getConfig();
        vm.expectRevert(Error.Gate__NoAttestorEndpoint.selector);
        new HubGate(accountModule, depositModule, hubEscrowStore, mandateStore, fundModule, redeemModule, _config, new string[](0), _list(address(usdc)), 50, 1000, _next);
        vm.expectRevert(Error.Gate__NoAttestorEndpoint.selector);
        new HubGate(accountModule, depositModule, hubEscrowStore, mandateStore, fundModule, redeemModule, _config, _endpoints(""), _list(address(usdc)), 50, 1000, _next);

        address _revoked = address(
            new HubGate(
                accountModule, depositModule, hubEscrowStore, mandateStore, fundModule, redeemModule, hub.getConfig(), _endpoints(_nextEndpoint), _list(address(usdc), address(wnt)), 50, 1000, bytes32(0)
            )
        );
        vm.prank(owner);
        dictate.setGate(bytes32("HubGate"), _revoked);
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

    function _returnDigest(
        EscrowStore _store,
        address _owner,
        address _token,
        uint _from,
        uint _total,
        uint _deadline
    ) internal view returns (bytes32) {
        return AccountLib.typedDigest(
            block.chainid,
            _owner,
            keccak256(abi.encode(RETURN_ESCROW_TYPEHASH, address(_store), _token, _from, _total, _deadline))
        );
    }

    function _fulfilDigest(
        EscrowStore _store,
        address _body,
        address _token,
        bytes32 _round,
        uint _from,
        uint _total,
        uint _fee
    ) internal view returns (bytes32) {
        return AccountLib.typedDigest(
            block.chainid,
            _body,
            keccak256(abi.encode(FULFIL_TYPEHASH, address(_store), _token, _round, _from, _total, _fee))
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
        _store.release(master, body, address(usdc), 1, 0, 200_000);
        vm.prank(_caller);
        vm.expectRevert(Error.Access__Unauthorized.selector);
        _store.refund(master, address(usdc), 1, 200_000);
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
            usdc.balanceOf(master), 500e6, "an escrow pulls from its caller, never from another wallet's standing allowance"
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
        assertEq(_store.escrowedMap(_strangerAccount, address(usdc)), 100e6, "both escrows book to the caller's own account");
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
            _data, abi.encode(LiquidityGate.deposit.selector, address(usdc), uint(20e6), uint(0)), "carrying the deposit"
        );
        assertEq(_balances[0].amount, 20e6, "and the account's balance after it");

        vm.deal(_stranger, 1 ether);
        vm.prank(_stranger);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__ValueMismatch.selector, 0.4 ether, 1 ether));
        _gate.depositEscrow{value: 0.4 ether}(NATIVE_TOKEN, 1 ether);
        vm.prank(_stranger);
        _gate.depositEscrow{value: 1 ether}(NATIVE_TOKEN, 1 ether);
        assertEq(_store.escrowedMap(_strangerAccount, NATIVE_TOKEN), 1 ether, "a native escrow attaches its whole amount");
        assertEq(address(_store).balance, 1 ether, "and lands as native in the gate's store");
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
        assertEq(usdc.balanceOf(body), _bodyCash, "a fund body cannot lock its holdings in escrow, even under its own pair");
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
        assertEq(usdc.balanceOf(_owner), _cash - 100e6 - FEE, "the user's own account pays the escrow and the relay fee");
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

    function test_return_escrow_on_the_hub_pays_the_owners_wallet_under_the_attestors_signature() public {
        _returnEscrowPaysTheOwnersWallet(
            LiquidityGate(address(hub)), hubEscrowStore, LiquidityGate(address(spoke)), spokeEscrowStore
        );
    }

    function test_return_escrow_on_the_spoke_pays_the_owners_wallet_under_the_attestors_signature() public {
        _returnEscrowPaysTheOwnersWallet(
            LiquidityGate(address(spoke)), spokeEscrowStore, LiquidityGate(address(hub)), hubEscrowStore
        );
    }

    function _returnEscrowPaysTheOwnersWallet(
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
        uint _start = vm.getBlockTimestamp();
        uint _deadline = _start + 300;

        bytes[] memory _refused = new bytes[](7);
        _refused[0] = _coSig(masterKey, _returnDigest(_store, _owner, _usdc, 0, 40e6, _deadline));
        _refused[1] = _coSig(attestorKey, _returnDigest(_other, _owner, _usdc, 0, 40e6, _deadline));
        _refused[2] = _coSig(attestorKey, _returnDigest(_store, _peer, _usdc, 0, 40e6, _deadline));
        _refused[3] = _coSig(attestorKey, _returnDigest(_store, _owner, address(wnt), 0, 40e6, _deadline));
        _refused[4] = _coSig(attestorKey, _returnDigest(_store, _owner, _usdc, 1, 40e6, _deadline));
        _refused[5] = _coSig(attestorKey, _returnDigest(_store, _owner, _usdc, 0, 41e6, _deadline));
        _refused[6] = _coSig(attestorKey, _returnDigest(_store, _owner, _usdc, 0, 40e6, _deadline + 1));
        for (uint _k; _k < _refused.length; ++_k) {
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            _gate.returnEscrow(_owner, _usdc, 0, 40e6, _deadline, _refused[_k]);
        }
        bytes memory _far = _coSig(attestorKey, _returnDigest(_store, _owner, _usdc, 0, 40e6, _start + 601));
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__DeadlineTooFar.selector, _start + 601, _start, 600));
        _gate.returnEscrow(_owner, _usdc, 0, 40e6, _start + 601, _far);
        assertEq(_store.returnedMap(_owner, _usdc), 0, "no refused return moved the ledger");

        bytes32 _d = _returnDigest(_store, _owner, _usdc, 0, 40e6, _deadline);
        bytes memory _honest = _coSig(attestorKey, _d);
        uint _wallet = usdc.balanceOf(master);
        uint _peerWallet = usdc.balanceOf(backer);
        uint _cash = usdc.balanceOf(_owner);
        uint _storeCash = usdc.balanceOf(address(_store));
        address _relayer = makeAddr("return-relayer");
        vm.recordLogs();
        vm.prank(_relayer);
        _gate.returnEscrow(_owner, _usdc, 0, 40e6, _deadline, _honest);
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(usdc.balanceOf(master), _wallet + 40e6, "a return pays the owner's wallet");
        assertEq(usdc.balanceOf(_owner), _cash, "never the owner's account");
        assertEq(usdc.balanceOf(_relayer), 0, "nor the relayer that sent it");
        assertEq(usdc.balanceOf(address(_store)), _storeCash - 40e6, "out of the gate's own store");
        assertEq(_store.heldMap(_usdc), _storeCash - 40e6, "which holds exactly what it still books");
        assertEq(_store.returnedMap(_owner, _usdc), 40e6, "at the signed total");
        assertEq(_store.returnedMap(_peer, _usdc), 0, "another owner's ledger is untouched");
        assertEq(_other.returnedMap(_owner, _usdc), 0, "and so is the other store's");
        assertEq(_calls.length, 1, "one record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(_owner))), "on the owner's account");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(_gate)))), "written by the gate");
        (,,, bytes32 _digest,, bytes memory _data,,, BalanceLib.Balance[] memory _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, _d, "under the attestor's digest");
        assertEq(
            _data, abi.encode(LiquidityGate.returnEscrow.selector, _usdc, uint(0), uint(40e6)), "carrying the returned total"
        );
        assertEq(_balances.length, 0, "and no account balance, since the account is not paid");

        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidReturn.selector, 40e6, 40e6));
        _gate.returnEscrow(_owner, _usdc, 0, 40e6, _deadline, _honest);
        bytes memory _stale = _coSig(attestorKey, _returnDigest(_store, _owner, _usdc, 0, 60e6, _deadline));
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidReturn.selector, 40e6, 60e6));
        _gate.returnEscrow(_owner, _usdc, 0, 60e6, _deadline, _stale);
        bytes memory _over = _coSig(attestorKey, _returnDigest(_store, _owner, _usdc, 40e6, 101e6, _deadline));
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 60e6, 61e6));
        _gate.returnEscrow(_owner, _usdc, 40e6, 101e6, _deadline, _over);

        bytes memory _late = _coSig(attestorKey, _returnDigest(_store, _owner, _usdc, 40e6, 100e6, _deadline));
        vm.warp(_deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__ExpiredDeadline.selector, _deadline, _deadline + 1));
        _gate.returnEscrow(_owner, _usdc, 40e6, 100e6, _deadline, _late);

        uint _renewed = _deadline + 301;
        _gate.returnEscrow(
            _owner,
            _usdc,
            40e6,
            100e6,
            _renewed,
            _coSig(attestorKey, _returnDigest(_store, _owner, _usdc, 40e6, 100e6, _renewed))
        );
        _gate.returnEscrow(
            _peer, _usdc, 0, 80e6, _renewed, _coSig(attestorKey, _returnDigest(_store, _peer, _usdc, 0, 80e6, _renewed))
        );
        assertEq(usdc.balanceOf(master), _wallet + 100e6, "the rest returns to the owner's wallet under a fresh deadline");
        assertEq(usdc.balanceOf(backer), _peerWallet + 80e6, "each owner's return pays that owner's own wallet");
        assertEq(usdc.balanceOf(address(_store)), 0, "the store paid out all it held");
        assertEq(_store.heldMap(_usdc), 0, "and books nothing more");
        assertEq(
            _other.escrowedMap(_owner, _usdc) - _other.returnedMap(_owner, _usdc),
            30e6,
            "while the other store keeps its own"
        );
    }

    function test_fulfil_releases_only_to_the_body_its_signature_names() public {
        _openFund();
        address _owner = _account(master);
        address _peer = _account(backer);
        address _usdc = address(usdc);
        (address _twin, uint _twinKey) = makeAddrAndKey("twin-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _twinKey);
        (address _stray, uint _strayKey) = makeAddrAndKey("stray-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), _strayKey);
        _depositEscrow(_usdc, 300e6);
        bytes32 _first = keccak256("first-round");
        bytes32 _second = keccak256("second-round");
        bytes32 _third = keccak256("third-round");

        bytes memory _twinSig = _coSig(attestorKey, _fulfilDigest(spokeEscrowStore, _twin, _usdc, _second, 0, 50e6, FEE));
        AccountLib.Genesis memory _genesis = AccountLib.Genesis({
            parent: _peer,
            key: _coSig(_twinKey, AccountLib.genesisDigest(address(accountModule), _twin, _owner)),
            approval: _fundApproval(backerKey, _twin)
        });
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_twin, _usdc, _second, 0, 50e6, FEE, _twinSig, _genesis);
        _genesis.parent = _owner;
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_twin, _usdc, _second, 0, 50e6, FEE, _twinSig, _genesis);
        _genesis.approval = _fundApproval(masterKey, _twin);
        spoke.fulfil(_twin, _usdc, _second, 0, 50e6, FEE, _twinSig, _genesis);
        (, address _twinParent) = FundAccount(payable(_twin)).bound();
        assertEq(_twinParent, _owner, "a fresh body binds only to the parent its own key and that owner's approval name");
        assertEq(usdc.balanceOf(_twin), 50e6 - FEE, "and its first fulfil releases the owner's escrow to it");

        bytes32 _bodyDigest = _fulfilDigest(spokeEscrowStore, body, _usdc, _first, 0, 100e6, FEE);
        bytes memory _bodySig = _coSig(attestorKey, _bodyDigest);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_twin, _usdc, _first, 0, 100e6, FEE, _bodySig, _noGenesis());
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(body, _usdc, _second, 0, 50e6, FEE, _twinSig, _noGenesis());

        bytes[] memory _forged = new bytes[](6);
        _forged[0] = _coSig(attestorKey, _fulfilDigest(hubEscrowStore, body, _usdc, _first, 0, 100e6, FEE));
        _forged[1] = _coSig(masterKey, _bodyDigest);
        _forged[2] = _coSig(attestorKey, _fulfilDigest(spokeEscrowStore, body, address(wnt), _first, 0, 100e6, FEE));
        _forged[3] = _coSig(attestorKey, _fulfilDigest(spokeEscrowStore, body, _usdc, _second, 0, 100e6, FEE));
        _forged[4] = _coSig(attestorKey, _fulfilDigest(spokeEscrowStore, body, _usdc, _first, 0, 90e6, FEE));
        _forged[5] = _coSig(attestorKey, _fulfilDigest(spokeEscrowStore, body, _usdc, _first, 0, 100e6, FEE / 2));
        for (uint _k; _k < _forged.length; ++_k) {
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            spoke.fulfil(body, _usdc, _first, 0, 100e6, FEE, _forged[_k], _noGenesis());
        }

        uint _bodyCash = usdc.balanceOf(body);
        uint _relay = usdc.balanceOf(feeReceiver);
        address _relayer = makeAddr("fulfil-relayer");
        vm.recordLogs();
        vm.prank(_relayer);
        spoke.fulfil(body, _usdc, _first, 0, 100e6, FEE, _bodySig, _noGenesis());
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(usdc.balanceOf(body), _bodyCash + 100e6 - FEE, "the release lands in the body its signature names");
        assertEq(usdc.balanceOf(_twin), 50e6 - FEE, "in no other body of the same owner");
        assertEq(usdc.balanceOf(_relayer), 0, "nor in the relayer");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "billing the signed fee once");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, body, _usdc), 100e6, "the body's total meets the signed total");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, _twin, _usdc), 50e6, "each body keeps its own total");
        assertEq(spokeEscrowStore.releasedMap(_owner, _usdc), 150e6, "both drawn on the one owner, read as each body's parent");
        assertEq(_calls.length, 1, "one record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(body))), "on the body");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(spoke)))), "written by the spoke gate");
        (,,, bytes32 _digest,, bytes memory _data,,, BalanceLib.Balance[] memory _balances) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, _bodyDigest, "under the attestor's digest for that body");
        assertEq(
            _data,
            abi.encode(SpokeGate.fulfil.selector, _usdc, _first, uint(0), uint(100e6), FEE),
            "naming no owner: the owner is the body's parent"
        );
        assertEq(_balances[0].amount, _bodyCash + 100e6 - FEE, "with the body's balance after it");

        vm.recordLogs();
        spoke.fulfil(body, _usdc, _first, 0, 100e6, FEE, _bodySig, _noGenesis());
        assertEq(vm.getRecordedLogs().length, 0, "a replayed fulfil writes nothing");
        assertEq(usdc.balanceOf(body), _bodyCash + 100e6 - FEE, "releases nothing");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "and bills nothing");

        spoke.fulfil(
            body,
            _usdc,
            _third,
            100e6,
            160e6,
            FEE,
            _coSig(attestorKey, _fulfilDigest(spokeEscrowStore, body, _usdc, _third, 100e6, 160e6, FEE)),
            _noGenesis()
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__InvalidFulfil.selector, 160e6, 100e6));
        spoke.fulfil(body, _usdc, _first, 0, 100e6, FEE, _bodySig, _noGenesis());
        assertEq(
            usdc.balanceOf(body),
            _bodyCash + 160e6 - 2 * FEE,
            "once a later round moved the total, the earlier signature never lands again"
        );

        _genesis = AccountLib.Genesis({
            parent: _peer,
            key: _coSig(_strayKey, AccountLib.genesisDigest(address(accountModule), _stray, _peer)),
            approval: _fundApproval(backerKey, _stray)
        });
        bytes memory _straySig = _coSig(attestorKey, _fulfilDigest(spokeEscrowStore, _stray, _usdc, _third, 0, 50e6, FEE));
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 50e6));
        spoke.fulfil(_stray, _usdc, _third, 0, 50e6, FEE, _straySig, _genesis);
        assertEq(
            spokeEscrowStore.releasedMap(_owner, _usdc), 210e6, "a body bound to another owner never draws on this owner's escrow"
        );

        address _plain = makeAddr("plain-address");
        bytes memory _plainSig = _coSig(attestorKey, _fulfilDigest(spokeEscrowStore, _plain, _usdc, _third, 0, 50e6, FEE));
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NotDelegated.selector, _plain));
        spoke.fulfil(_plain, _usdc, _third, 0, 50e6, FEE, _plainSig, _noGenesis());
    }

    function test_a_local_credit_releases_the_owners_hub_escrow_only_with_the_owners_consent() public {
        _openFund();
        _escrowOnHub(address(usdc), 100e6);
        _escrowFrom(LiquidityGate(address(hub)), backer, 400e6);
        address _owner = _account(master);
        address _peer = _account(backer);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        bytes32 _consent = _typed(_owner, _i.header.deadline, _allocateStructHash(_i));
        (Fund.AllocateIntent memory _smaller,) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 50e6), new Fund.Allocation[](0)
        );
        uint _ownerNonce = _nonceOf(_owner);

        bytes[] memory _refused = new bytes[](5);
        _refused[0] = "";
        _refused[1] = _coSig(masterKey, _consent);
        _refused[2] = _pair(backerKey, _consent);
        _refused[3] = _sig;
        _refused[4] = _ownerCoSig(_smaller);
        for (uint _k; _k < _refused.length; ++_k) {
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.allocate(_i, _sig, _refused[_k]);
        }
        assertEq(hubEscrowStore.releasedMap(_owner, address(usdc)), 500e6, "no refused consent released the owner's escrow");
        assertEq(_nonceOf(_owner), _ownerNonce, "nor spent the owner's nonce");

        (Fund.AllocateIntent memory _over, bytes memory _overSig) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 200e6), new Fund.Allocation[](0)
        );
        bytes memory _overConsent = _ownerCoSig(_over);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 100e6, 200e6));
        hub.allocate(_over, _overSig, _overConsent);
        assertEq(
            hubEscrowStore.releasedMap(_peer, address(usdc)), 0, "another owner's escrow in the same store is out of the round's reach"
        );

        uint _bodyCash = usdc.balanceOf(body);
        uint _cash = usdc.balanceOf(_owner);
        uint _relay = usdc.balanceOf(feeReceiver);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.recordLogs();
        hub.allocate(_i, _sig, _ownerSig);
        Vm.Log[] memory _calls = _accountCalls(vm.getRecordedLogs());
        assertEq(hubEscrowStore.releasedMap(_owner, address(usdc)), 600e6, "the owner's consent releases the credit from its hub escrow");
        assertEq(hubEscrowStore.fulfilledMap(_owner, body, address(usdc)), 600e6, "booked to the body it funds");
        assertEq(usdc.balanceOf(body), _bodyCash + 100e6 - FEE, "which receives it net of the master slice");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "billed by the store to its fee receiver");
        assertEq(usdc.balanceOf(_owner), _cash, "while the owner's account pays nothing");
        assertEq(
            hubEscrowStore.escrowedMap(_peer, address(usdc)) - hubEscrowStore.releasedMap(_peer, address(usdc)),
            400e6,
            "and the other owner's escrow stays whole"
        );
        assertEq(_nonceOf(_owner), _ownerNonce + 1, "the consent spends one owner nonce");
        assertEq(_calls.length, 2, "the round writes the consent and the body's record");
        assertEq(_calls[0].topics[1], bytes32(uint(uint160(_owner))), "the consent first, on the owner's account");
        assertEq(_calls[0].topics[2], bytes32(uint(uint160(address(fundModule)))), "dispatched by the fund module");
        (,,, bytes32 _digest,, bytes memory _data, IAccount.Call[] memory _callList,,) = abi.decode(
            _calls[0].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
        );
        assertEq(_digest, _consent, "under the owner's own digest of the round");
        assertEq(
            _data,
            abi.encode(Fund.allocate.selector, body, _i.credit, FEE, hubEscrowStore.fulfilledMap(_owner, body, address(usdc))),
            "naming the body, the credit, the master slice and the escrow's fulfilled total"
        );
        assertEq(_callList.length, 0, "with no call: the consent moves nothing itself");
        assertEq(_calls[1].topics[1], bytes32(uint(uint160(body))), "then the body's own record");

        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, 2, 1));
        hub.allocate(_i, _sig, _ownerSig);
    }

    function test_an_allocate_signed_over_the_old_shape_with_fee_shares_does_not_verify() public {
        _openFund();
        _escrowOnHub(address(usdc), 100e6);
        address _owner = _account(master);
        (Fund.AllocateIntent memory _i, bytes memory _honest) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        bytes32 _old = keccak256(
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
                keccak256(abi.encode(CREDIT_TYPEHASH, _i.credit.chainId, _i.credit.token, _i.credit.amount)),
                keccak256(abi.encode(_i.allocationList))
            )
        );
        assertTrue(_old != _allocateStructHash(_i), "the old shape hashes to another struct");
        bytes memory _oldBody = _pair(masterKey, _typed(body, _i.header.deadline, _old));
        bytes memory _oldConsent = _pair(masterKey, _typed(_owner, _i.header.deadline, _old));
        bytes memory _consent = _ownerCoSig(_i);
        uint _bodyNonce = _nonceOf(body);
        uint _ownerNonce = _nonceOf(_owner);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _oldBody, _consent);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, _honest, _oldConsent);
        assertEq(_nonceOf(body), _bodyNonce, "an old-shape body signature spends no body nonce");
        assertEq(_nonceOf(_owner), _ownerNonce, "nor an old-shape consent an owner nonce");
        assertEq(hubEscrowStore.releasedMap(_owner, address(usdc)), 500e6, "and neither releases the owner's escrow");

        hub.allocate(_i, _honest, _consent);
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
        _refused[5] = address(dictate);
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
                _stores[_s].setAccess(_stranger, true);
            }
        }
        vm.prank(_stranger);
        vm.expectRevert(Error.Dictate__Unauthorized.selector);
        dictate.setAccess(hubEscrowStore, _stranger);

        uint _bodyBefore = usdc.balanceOf(body);
        uint _walletBefore = usdc.balanceOf(master);
        usdc.mint(address(hubEscrowStore), 100e6);
        vm.prank(address(hub));
        hubEscrowStore.escrow(_owner, _usdc, 100e6);
        uint _fulfilled = hubEscrowStore.fulfilledMap(_owner, body, _usdc) + 60e6;
        vm.prank(address(fundModule));
        hubEscrowStore.release(_owner, body, _usdc, _fulfilled, 0, 200_000);
        vm.prank(address(hub));
        hubEscrowStore.refund(_owner, _usdc, 40e6, 200_000);
        assertEq(usdc.balanceOf(body) - _bodyBefore, 60e6, "the hub store releases for the fund module");
        assertEq(usdc.balanceOf(master) - _walletBefore, 40e6, "and books and refunds for its own gate");
        assertEq(hubEscrowStore.heldMap(_usdc), 0, "holding nothing after");

        usdc.mint(address(spokeEscrowStore), 100e6);
        vm.prank(address(spoke));
        spokeEscrowStore.escrow(_owner, _usdc, 100e6);
        vm.prank(address(spoke));
        spokeEscrowStore.release(_owner, body, _usdc, 60e6, 0, 200_000);
        vm.prank(address(spoke));
        spokeEscrowStore.refund(_owner, _usdc, 40e6, 200_000);
        assertEq(usdc.balanceOf(body) - _bodyBefore, 120e6, "the spoke store releases for its own gate");
        assertEq(usdc.balanceOf(master) - _walletBefore, 80e6, "and books and refunds for it");
        assertEq(spokeEscrowStore.heldMap(_usdc), 0, "holding nothing after");

        vm.prank(owner);
        dictate.removeAccess(hubEscrowStore, address(hub));
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
        uint _return
    ) public {
        _deposit = bound(_deposit, 10e6, 1e12);
        _retire = bound(_retire, 10e6, 1e12);
        _release = bound(_release, 10e6, _deposit + _retire);
        _return = bound(_return, 0, _deposit + _retire - _release);
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
            (LiquidityGate.RetireEscrowIntent memory _i, bytes memory _sig) = _retireIntent(master, masterKey, _owner, _retire);
            _gate.retireEscrow(_i, _sig);
            if (_s == 0) {
                (Fund.AllocateIntent memory _round, bytes memory _roundSig) = _allocateIntent(
                    _nonceOf(body), _nav(), _credit(block.chainid, _usdc, _release), new Fund.Allocation[](0)
                );
                hub.allocate(_round, _roundSig, _ownerCoSig(_round));
            } else {
                spoke.fulfil(
                    body,
                    _usdc,
                    keccak256("fuzzed-round"),
                    0,
                    _release,
                    FEE,
                    _coSig(
                        attestorKey,
                        _fulfilDigest(spokeEscrowStore, body, _usdc, keccak256("fuzzed-round"), 0, _release, FEE)
                    ),
                    _noGenesis()
                );
            }
            if (_return > 0) {
                uint _deadline = vm.getBlockTimestamp() + 300;
                _gate.returnEscrow(
                    _owner,
                    _usdc,
                    0,
                    _return,
                    _deadline,
                    _coSig(attestorKey, _returnDigest(_store, _owner, _usdc, 0, _return, _deadline))
                );
            }
            assertEq(
                usdc.balanceOf(address(_store)),
                _storeCash + _deposit + 50e6 + _retire - _release - _return,
                "the store moved exactly its entries"
            );
            assertEq(_store.heldMap(_usdc), usdc.balanceOf(address(_store)), "and holds what its ledger books");
            assertEq(
                _store.escrowedMap(_owner, _usdc) - _store.releasedMap(_owner, _usdc) - _store.returnedMap(_owner, _usdc),
                _open + _deposit + _retire - _release - _return,
                "the owner's open escrow nets its entries"
            );
            assertEq(
                _store.escrowedMap(_account(backer), _usdc) - _store.releasedMap(_account(backer), _usdc),
                50e6,
                "beside another owner's, untouched"
            );
            assertEq(usdc.balanceOf(body), _bodyCash + _release - FEE, "the release lands in the body net of its fee");
            assertEq(usdc.balanceOf(master), _wallet + _return, "the return lands in the owner's wallet");
            assertEq(usdc.balanceOf(_owner), _cash - _retire - FEE, "the account paid its retire and that relay fee");
            assertEq(usdc.balanceOf(feeReceiver), _relay + 2 * FEE, "the fee receiver took the retire fee and the release fee");
        }
        assertEq(
            hubEscrowStore.escrowedMap(_owner, _usdc), 500e6 + _deposit + _retire, "the hub store books only the hub's entries"
        );
        assertEq(spokeEscrowStore.escrowedMap(_owner, _usdc), _deposit + _retire, "and the spoke store only the spoke's");
    }
}
