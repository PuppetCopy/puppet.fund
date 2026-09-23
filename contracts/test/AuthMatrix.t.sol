// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {HubGate, MANDATE_INTENT_TYPEHASH, SELL_INTENT_TYPEHASH} from "src/HubGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Deposit} from "src/core/Deposit.sol";
import {Fund} from "src/core/Fund.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {Share} from "src/core/Share.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {BalanceLib} from "src/utils/BalanceLib.sol";
import {Error} from "src/utils/Error.sol";
import {ESCROW_INTENT_TYPEHASH, LiquidityGate, WITHDRAW_INTENT_TYPEHASH} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {SwapLib} from "src/utils/SwapLib.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

import {HotPathTest} from "./HotPath.t.sol";

contract AuthMatrixTestWallet {
    UserAccount internal immutable account;
    address internal immutable token;
    bytes4 internal immutable selfCall;
    bool internal immutable swallow;
    bytes public caught;

    constructor(
        UserAccount _account,
        address _token,
        bytes4 _selfCall,
        bool _swallow
    ) {
        account = _account;
        token = _token;
        selfCall = _selfCall;
        swallow = _swallow;
    }

    receive() external payable {
        (bool _ok, bytes memory _ret) = address(account).call(
            selfCall == UserAccount.withdraw.selector
                ? abi.encodeCall(UserAccount.withdraw, (token, 1e6, 200_000))
                : abi.encodeWithSelector(selfCall)
        );
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
    ) internal view returns (Share) {
        return Share(
            address(
                uint160(
                    uint(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                address(hub),
                                bytes32(uint(uint160(body))),
                                keccak256(
                                    _cloneCode(fundModule.shareImpl(), abi.encodePacked(_symbol, _pixels, uint16(1000)))
                                )
                            )
                        )
                    )
                )
            )
        );
    }

    function _openFund() internal {
        _fundWallet(master, 2000e6);
        bytes memory _pixels = new bytes(154);
        share = _shareOf(bytes32("AUTH"), _pixels);
        _escrow(LiquidityGate(address(hub)), address(usdc), 500e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(bytes32("AUTH"), _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);
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
        LiquidityGate.EscrowIntent memory _e = LiquidityGate.EscrowIntent({
            header: _header(_acct, backer, _nonceOf(_acct)), master: body, token: address(usdc), amount: 10e6
        });
        bytes32 _structHash =
            keccak256(abi.encode(ESCROW_INTENT_TYPEHASH, _hashHeader(_e.header), _e.master, _e.token, _e.amount));
        bytes memory _landed = _pair(backerKey, _typed(_acct, _structHash));
        hub.escrow(_e, _landed);

        (address _rogue, IAccount.Call[] memory _drain) = _rogueDrain(_acct);
        vm.prank(_rogue);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        accountModule.dispatch(IAccount(_acct), attestor, _structHash, _landed, "", _drain, new address[](0));
        assertEq(usdc.balanceOf(_rogue), 0, "a landed signature is spent: its nonce is behind the account");

        bytes memory _fresh = _pair(backerKey, _typed(_acct, _structHash));
        vm.prank(_rogue);
        accountModule.dispatch(IAccount(_acct), attestor, _structHash, _fresh, "", _drain, new address[](0));
        assertEq(usdc.balanceOf(_acct), 0, "a signature over the current nonce is the only thing that executes");
    }

    function test_a_dispatcher_cannot_replay_a_landed_fund_intent() public {
        share = _shareOf(bytes32("AUTH"), new bytes(154));
        (Fund.AllocateIntent memory _opening, bytes memory _landed) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        _openFund();
        assertEq(_nonceOf(body), 1, "the opening round spent nonce zero");
        uint _held = usdc.balanceOf(body);

        (address _rogue, IAccount.Call[] memory _drain) = _rogueDrain(body);
        vm.prank(_rogue);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        accountModule.dispatch(IAccount(body), attestor, _allocateStructHash(_opening), _landed, "", _drain, new address[](0));
        assertEq(usdc.balanceOf(body), _held, "the fund keeps everything");
    }

    function _backed() internal returns (uint units_) {
        _openFund();
        _fundWallet(backer, 1000e6);
        AccountLib.Mandate[] memory _one = new AccountLib.Mandate[](1);
        _one[0] = AccountLib.Mandate({
            master: body, skin: 0, allocationRate: 5000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
        _mandate(backer, backerKey, _one);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = Fund.Allocation({puppet: _account(backer), mandate: _one[0], amount: 400e6});
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        hub.allocate(_i, _sig);
        units_ = share.balanceOf(_account(backer));
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
            _coSig(
                _userKey,
                AccountLib.sessionDigest(
                    address(accountModule), vm.addr(_userKey), _signer, _issuedAt, _expiry, _epoch
                )
            ),
            _coSig(_signerKey, _digest)
        );
    }

    function _sellIntent(
        uint _units
    ) internal view returns (Fund.SellIntent memory i_, bytes32 digest_) {
        address _acct = accountModule.predictUserAccount(backer);
        i_ = Fund.SellIntent({header: _header(_acct, backer, _nonceOf(_acct)), master: body, share: share, units: _units});
        i_.header.deadline = vm.getBlockTimestamp() + 300;
        digest_ = _typed(
            _acct, keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(i_.header), i_.master, i_.share, i_.units))
        );
    }

    function _etchedWallet(
        string memory _name,
        bytes4 _selfCall,
        bool _swallow
    ) internal returns (address user_, uint key_, UserAccount ua_) {
        (user_, key_) = makeAddrAndKey(_name);
        ua_ = UserAccount(payable(accountModule.predictUserAccount(user_)));
        vm.etch(user_, address(new AuthMatrixTestWallet(ua_, address(usdc), _selfCall, _swallow)).code);
        vm.deal(user_, 1 ether);
        vm.prank(user_);
        hub.deposit{value: 1 ether}(NATIVE_TOKEN, 1 ether);
        _fundWallet(user_, 10e6);
        vm.prank(user_);
        ua_.requestWithdraw();
        vm.warp(vm.getBlockTimestamp() + WITHDRAW_DELAY);
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
        uint _units = _backed();
        UserAccount _ua = UserAccount(payable(_account(backer)));
        (, uint _sessionKey) = makeAddrAndKey("session");
        uint _now = vm.getBlockTimestamp();
        (Fund.SellIntent memory _i, bytes32 _d) = _sellIntent(_units / 2);
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
        assertEq(share.balanceOf(address(fundStore)), _units / 2, "the sold units wait in the queue");
        assertEq(share.balanceOf(address(_ua)), _units - _units / 2, "and left the backer");
        assertEq(_ua.nonce(), _nonce + 1, "the sell consumed exactly one nonce");
        assertEq(usdc.balanceOf(address(_ua)), _cash - FEE, "the account paid exactly the relay fee");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "to the fee receiver");
    }

    function test_revoke_sessions_retires_the_epoch_zero_grant() public {
        uint _units = _backed();
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

        uint _nonce = _ua.nonce();
        (Fund.SellIntent memory _i, bytes32 _d) = _sellIntent(_units / 2);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)));
        assertEq(_ua.nonce(), _nonce, "a refused approval consumes no nonce");

        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 1 days, 1, _d), _coSig(attestorKey, _d)));
        assertEq(share.balanceOf(address(fundStore)), _units / 2, "a grant re-signed at the new epoch is honoured");
        assertEq(_ua.nonce(), _nonce + 1, "and consumes the nonce");
    }

    function test_session_expiry_is_capped_at_thirty_days() public {
        uint _units = _backed();
        (, uint _sessionKey) = makeAddrAndKey("session");
        uint _now = vm.getBlockTimestamp();
        (Fund.SellIntent memory _i, bytes32 _d) = _sellIntent(_units / 4);
        bytes memory _attest = _coSig(attestorKey, _d);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 30 days + 1, 0, _d), _attest));
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now - 2, _now - 1, 0, _d), _attest));

        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 30 days, 0, _d), _attest));
        assertEq(share.balanceOf(address(fundStore)), _units / 4, "a grant of exactly thirty days is honoured");

        uint _expiry = _now + 1 hours;
        vm.warp(_expiry);
        (_i, _d) = _sellIntent(_units / 4);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _expiry, 0, _d), _coSig(attestorKey, _d)));
        assertEq(share.balanceOf(address(fundStore)), 2 * (_units / 4), "a grant is live through its expiry second");

        vm.warp(_expiry + 1);
        (_i, _d) = _sellIntent(_units / 4);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _expiry, 0, _d), _coSig(attestorKey, _d)));
    }

    function test_forward_dated_grant_is_refused() public {
        uint _units = _backed();
        (, uint _sessionKey) = makeAddrAndKey("session");
        uint _now = vm.getBlockTimestamp();
        (Fund.SellIntent memory _i, bytes32 _d) = _sellIntent(_units / 2);
        bytes memory _attest = _coSig(attestorKey, _d);

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now + 1, _now + 1 days, 0, _d), _attest));

        hub.sell(_i, bytes.concat(_session(backerKey, _sessionKey, _now, _now + 1 days, 0, _d), _attest));
        assertEq(share.balanceOf(address(fundStore)), _units / 2, "a grant issued at the current second is honoured");
    }

    function test_parent_session_approves_a_body_allocate() public {
        _openFund();
        UserAccount _parent = UserAccount(payable(_account(master)));
        (, uint _sessionKey) = makeAddrAndKey("master-session");
        uint _now = vm.getBlockTimestamp();

        _escrow(LiquidityGate(address(hub)), address(usdc), 100e6);
        (Fund.AllocateIntent memory _i,) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        bytes32 _d = _allocateDigest(_i);
        uint _supply = share.totalSupply();
        uint _held = share.balanceOf(body);
        uint _cash = usdc.balanceOf(body);
        uint _relay = usdc.balanceOf(feeReceiver);
        uint _parentNonce = _parent.nonce();

        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, bytes.concat(_session(bodyKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)));

        hub.allocate(_i, bytes.concat(_session(masterKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)));
        assertEq(
            share.balanceOf(body) - _held,
            Math.mulDiv(100e6 * USD - FEE * USD, _supply + 1e12, _i.valuation.value + 1e24),
            "the credit mints the master's units at the signed valuation"
        );
        assertEq(usdc.balanceOf(body), _cash + 100e6 - FEE, "the escrow lands in the body net of the round fee");
        assertEq(usdc.balanceOf(feeReceiver), _relay + FEE, "the round fee is billed once");
        assertEq(_nonceOf(body), 2, "the body consumed its second nonce");
        assertEq(_parent.nonce(), _parentNonce, "the parent's own nonce is untouched by the body's intent");

        vm.prank(master);
        _parent.revokeSessions();
        _escrow(LiquidityGate(address(hub)), address(usdc), 100e6);
        (_i,) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        _d = _allocateDigest(_i);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        hub.allocate(_i, bytes.concat(_session(masterKey, _sessionKey, _now, _now + 1 days, 0, _d), _coSig(attestorKey, _d)));

        hub.allocate(_i, bytes.concat(_session(masterKey, _sessionKey, _now, _now + 1 days, 1, _d), _coSig(attestorKey, _d)));
        assertEq(_nonceOf(body), 3, "revoking on the parent retires the body's session authority until re-granted");
    }

    function test_user_account_pair_reject_paths() public {
        uint _units = _backed();
        address _acct = _account(backer);
        (address _other, uint _otherKey) = makeAddrAndKey("other");
        (address _forger, uint _forgerKey) = makeAddrAndKey("forger");
        (address _sessionSigner, uint _sessionKey) = makeAddrAndKey("session");
        uint _now = vm.getBlockTimestamp();
        (Fund.SellIntent memory _i, bytes32 _d) = _sellIntent(_units / 2);
        bytes memory _approval = _coSig(backerKey, _d);
        bytes memory _attest = _coSig(attestorKey, _d);
        (bytes32 _r, bytes32 _vs) = vm.signCompact(attestorKey, _d);
        assertTrue(
            SignatureCheckerLib.isValidSignatureNow(attestor, _d, bytes.concat(_r, _vs)),
            "the 64-byte tail below is a genuine compact attestor signature"
        );
        bytes memory _grant = _coSig(
            backerKey,
            AccountLib.sessionDigest(address(accountModule), backer, _sessionSigner, _now, _now + 1 hours, 0)
        );
        bytes memory _inner = _coSig(_sessionKey, _d);
        assertTrue(
            UserAccount(payable(_acct)).approves(_d, abi.encode(_sessionSigner, _now, _now + 1 hours, _grant, _inner)),
            "the untampered grant the tampered rows below start from is honoured"
        );
        uint _nonce = _nonceOf(_acct);

        bytes[] memory _bad = new bytes[](14);
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
                _coSig(
                    _otherKey,
                    AccountLib.sessionDigest(address(accountModule), backer, _sessionSigner, _now, _now + 1 days, 0)
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
                _coSig(
                    backerKey,
                    AccountLib.sessionDigest(address(accountModule), backer, _sessionSigner, _now, _now + 1 days, 0)
                ),
                _coSig(_forgerKey, _d)
            ),
            _attest
        );
        _bad[7] = bytes.concat(_approval, _r, _vs);
        _bad[8] = "";
        _bad[9] = bytes.concat(abi.encode(_sessionSigner, _now, _now + 1 days, _grant, _inner), _attest);
        _bad[10] = bytes.concat(abi.encode(_sessionSigner, _now - 1, _now + 1 hours, _grant, _inner), _attest);
        _bad[11] = bytes.concat(abi.encode(_forger, _now, _now + 1 hours, _grant, _coSig(_forgerKey, _d)), _attest);
        _bad[12] = bytes.concat(
            abi.encode(
                _sessionSigner,
                _now,
                _now + 1 hours,
                _coSig(
                    backerKey,
                    AccountLib.sessionDigest(
                        makeAddr("previous-module"), backer, _sessionSigner, _now, _now + 1 hours, 0
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
                _coSig(
                    backerKey,
                    AccountLib.sessionDigest(address(accountModule), _other, _sessionSigner, _now, _now + 1 hours, 0)
                ),
                _inner
            ),
            _attest
        );
        for (uint _k; _k < _bad.length; ++_k) {
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.sell(_i, _bad[_k]);
        }
        assertEq(_bad[7].length, 129, "one byte short of a pair");
        assertEq(_nonceOf(_acct), _nonce, "no refused pair consumed the nonce");

        hub.sell(_i, bytes.concat(_approval, _attest));
        assertEq(share.balanceOf(address(fundStore)), _units / 2, "the same intent with an honest pair goes through");
        assertEq(_nonceOf(_acct), _nonce + 1, "and consumes the nonce");
    }

    function test_body_pair_reject_paths() public {
        _openFund();
        (, uint _forgerKey) = makeAddrAndKey("forger");
        _escrow(LiquidityGate(address(hub)), address(usdc), 100e6);
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
            vm.expectRevert(Error.Account__InvalidSignature.selector);
            hub.allocate(_i, _bad[_k]);
        }
        assertEq(_nonceOf(body), 1, "no refused pair consumed the body's nonce");

        assertEq(_honest, bytes.concat(_coSig(masterKey, _d), _attest), "the honest pair is the parent's wallet then the attestor");
        hub.allocate(_i, _honest);
        assertEq(_nonceOf(body), 2, "the parent's wallet with the attestor approves the body");
    }

    function _selfCallInsideDispatch(
        string memory _name,
        bytes4 _selfCall
    ) internal returns (address user_, UserAccount ua_) {
        uint _key;
        (user_, _key, ua_) = _etchedWallet(_name, _selfCall, false);
        uint _requestedAt = ua_.withdrawRequestedAt();
        assertGt(_requestedAt, 0, "the wallet has an open withdrawal request");
        (Deposit.SwapIntent memory _i, bytes memory _sig) = _nativeWithdraw(user_, _key, ua_);

        vm.expectRevert(Error.Account__Executing.selector);
        hub.withdraw(_i, _sig);
        assertEq(ua_.nonce(), 0, "the dispatch never landed");
        assertEq(ua_.epoch(), 0, "no revoke landed inside it");
        assertEq(ua_.withdrawRequestedAt(), _requestedAt, "no request landed inside it");
        assertEq(address(ua_).balance, 1 ether, "no native left the account");
        assertEq(usdc.balanceOf(address(ua_)), 10e6, "no escape-hatch withdraw landed inside it");
    }

    function test_wallet_cannot_revoke_inside_its_own_dispatch() public {
        (address _user, UserAccount _ua) =
            _selfCallInsideDispatch("wallet-revoke", UserAccount.revokeSessions.selector);
        vm.prank(_user);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), 1, "the same revoke lands outside a dispatch");
    }

    function test_wallet_cannot_request_withdraw_inside_its_own_dispatch() public {
        (address _user, UserAccount _ua) =
            _selfCallInsideDispatch("wallet-request", UserAccount.requestWithdraw.selector);
        vm.prank(_user);
        _ua.requestWithdraw();
        assertEq(_ua.withdrawRequestedAt(), vm.getBlockTimestamp(), "the same request lands outside a dispatch");
    }

    function test_wallet_cannot_withdraw_inside_its_own_dispatch() public {
        (address _user, UserAccount _ua) =
            _selfCallInsideDispatch("wallet-withdraw", UserAccount.withdraw.selector);
        vm.prank(_user);
        _ua.withdraw(address(usdc), 1e6, 200_000);
        assertEq(usdc.balanceOf(address(_ua)), 9e6, "the same withdraw lands outside a dispatch");
        assertEq(usdc.balanceOf(_user), 1e6, "paying the wallet");
        assertEq(_ua.withdrawRequestedAt(), 0, "and closing the request it spent");
    }

    function test_swallowed_self_call_keeps_records_in_execution_order() public {
        (address _user, uint _key, UserAccount _ua) =
            _etchedWallet("wallet-swallow", UserAccount.revokeSessions.selector, true);
        (Deposit.SwapIntent memory _i, bytes memory _sig) = _nativeWithdraw(_user, _key, _ua);
        bytes32 _d = _typed(
            address(_ua),
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
        vm.startPrank(owner);
        dictate.setAccess(register, owner);
        register.setRegistered(address(_ft), bytes32("FALSE"));
        dictate.removeAccess(register, owner);
        vm.stopPrank();

        _fundWallet(backer, 10e6);
        address _acct = _account(backer);
        _ft.mint(_acct, 100e18);

        LiquidityGate.EscrowIntent memory _e = LiquidityGate.EscrowIntent({
            header: _header(_acct, backer, 0), master: body, token: address(_ft), amount: 50e18
        });
        bytes memory _escrowSig = _pair(
            backerKey,
            _typed(_acct, keccak256(abi.encode(ESCROW_INTENT_TYPEHASH, _hashHeader(_e.header), _e.master, _e.token, _e.amount)))
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Account__CallReturnedFalse.selector, address(_ft)));
        hub.escrow(_e, _escrowSig);
        assertEq(escrowStore.escrowedMap(_acct, body, address(_ft)), 0, "the escrow ledger books nothing that did not arrive");

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

        address[] memory _tokens = new address[](1);
        _tokens[0] = address(_ft);
        HubGate.MandateIntent memory _m = HubGate.MandateIntent({
            header: _header(_acct, backer, 0),
            mandateList: new AccountLib.Mandate[](0),
            signatureList: new bytes[](0),
            tokenList: _tokens,
            arm: true
        });
        bytes memory _mandateSig = _pair(
            backerKey,
            _typed(
                _acct,
                keccak256(
                    abi.encode(
                        MANDATE_INTENT_TYPEHASH,
                        _hashHeader(_m.header),
                        keccak256(abi.encode(_m.mandateList)),
                        keccak256(abi.encodePacked(_m.tokenList)),
                        _m.arm
                    )
                )
            )
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Account__CallReturnedFalse.selector, address(_ft)));
        hub.mandate(_m, _mandateSig);

        assertEq(usdc.balanceOf(_acct), 10e6, "the account paid no relay fee for the refused intents");
        assertEq(_nonceOf(_acct), 0, "none of them consumed the nonce");
    }

    function test_accounts_start_at_nonce_zero_and_replays_revert() public {
        UserAccount _fresh = UserAccount(payable(_account(makeAddr("fresh"))));
        assertEq(_fresh.nonce(), 0, "a user account starts at nonce 0");
        assertEq(_fresh.epoch(), 0, "at epoch 0");
        assertEq(_fresh.withdrawRequestedAt(), 0, "with no withdrawal request");
        assertEq(FundAccount(payable(body)).nonce(), 0, "a delegated body starts at nonce 0");
        (address _module, address _bound) = FundAccount(payable(body)).bound();
        assertEq(_module, address(0), "unbound before genesis");
        assertEq(_bound, address(0), "with no parent");

        _fundWallet(master, 2000e6);
        address _parent = _account(master);
        assertEq(_nonceOf(_parent), 0, "the first deposit does not consume a nonce");
        LiquidityGate.EscrowIntent memory _e = LiquidityGate.EscrowIntent({
            header: _header(_parent, master, 0), master: body, token: address(usdc), amount: 500e6
        });
        bytes memory _escrowSig = _pair(
            masterKey,
            _typed(_parent, keccak256(abi.encode(ESCROW_INTENT_TYPEHASH, _hashHeader(_e.header), _e.master, _e.token, _e.amount)))
        );
        hub.escrow(_e, _escrowSig);
        assertEq(_nonceOf(_parent), 1, "a relayed intent consumes exactly one nonce");
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, _parent, 1, 0));
        hub.escrow(_e, _escrowSig);
        _e.header.nonce = 2;
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, _parent, 1, 2));
        hub.escrow(_e, _escrowSig);
        assertEq(escrowStore.escrowedMap(_parent, body, address(usdc)), 500e6, "the replay escrowed nothing more");

        bytes memory _pixels = new bytes(154);
        share = _shareOf(bytes32("AUTH"), _pixels);
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _parent);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(1, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, 0, 1));
        hub.createFund(bytes32("AUTH"), _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);

        (_i, _sig) = _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        hub.createFund(bytes32("AUTH"), _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);
        assertEq(_nonceOf(body), 1, "the opening allocate consumed the body's nonce 0");
        assertEq(_nonceOf(_parent), 1, "and none of the parent's");

        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, 1, 0));
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(body), 499e18, "the replayed round minted nothing more");
    }
}
