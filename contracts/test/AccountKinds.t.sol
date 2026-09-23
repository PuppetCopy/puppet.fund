// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Vm} from "forge-std/src/Vm.sol";

import {
    HubGate,
    MANDATE_INTENT_TYPEHASH,
    PRICE_TYPEHASH,
    REDEEM_INTENT_TYPEHASH,
    SELL_INTENT_TYPEHASH
} from "src/HubGate.sol";
import {OPERATE_INTENT_TYPEHASH, SpokeGate} from "src/SpokeGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Deposit} from "src/core/Deposit.sol";
import {Fund} from "src/core/Fund.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {Share} from "src/core/Share.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib, MAX_SESSION_TTL} from "src/utils/AccountLib.sol";
import {BalanceLib} from "src/utils/BalanceLib.sol";
import {Error} from "src/utils/Error.sol";
import {
    DEPOSIT_ACROSS_INTENT_TYPEHASH,
    ESCROW_INTENT_TYPEHASH,
    FUND_SWAP_INTENT_TYPEHASH,
    WITHDRAW_INTENT_TYPEHASH,
    LiquidityGate
} from "src/utils/LiquidityGate.sol";
import {SwapLib} from "src/utils/SwapLib.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

import {HotPathTest} from "./HotPath.t.sol";

contract AccountKindsTestFakeBody {
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

    function nonce() external pure returns (uint) {
        return 0;
    }

    function execute(
        address,
        bytes32,
        bytes calldata,
        IAccount.Call[] calldata
    ) external pure returns (bytes[] memory) {
        return new bytes[](0);
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

contract AccountKindsTest is HotPathTest {
    function _openFund() internal {
        _fundWallet(master, 2000e6);
        bytes32 _symbol = bytes32("KND");
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
                                    _cloneCode(fundModule.shareImpl(), abi.encodePacked(_symbol, _pixels, uint16(1000)))
                                )
                            )
                        )
                    )
                )
            )
        );
        _escrow(LiquidityGate(address(hub)), address(usdc), 500e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);
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
                keccak256(
                    abi.encode(
                        OPERATE_INTENT_TYPEHASH,
                        _hashHeader(intent_.header),
                        keccak256(abi.encode(_callList)),
                        keccak256(abi.encodePacked(intent_.tokenList))
                    )
                )
            )
        );
    }

    function _allocateFor(
        address _acct,
        uint _nonce,
        Fund.Credit memory _c
    ) internal returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        address _body = body;
        body = _acct;
        (intent_, coSig_) = _allocateIntent(_nonce, 0, _c, new Fund.Allocation[](0));
        body = _body;
    }

    function _redeemFor(
        address _acct,
        uint _nonce,
        uint _retire,
        uint _drain
    ) internal view returns (Fund.RedeemIntent memory intent_, bytes memory coSig_) {
        AccountLib.IntentHeader memory _h = _header(_acct, master, _nonce);
        _h.feeToken = address(0);
        _h.fee = FEE * USD;
        intent_ = Fund.RedeemIntent({
            header: _h,
            share: share,
            valuation: _valuation(usdc.balanceOf(body)),
            price: Fund.Price({token: address(usdc), amount: 1e6, value: 1e6 * USD}),
            retire: _retire,
            drain: _drain
        });
        coSig_ = _pair(
            masterKey,
            _typed(
                _acct,
                keccak256(
                    abi.encode(
                        REDEEM_INTENT_TYPEHASH,
                        _hashHeader(_h),
                        intent_.share,
                        _valuationHash(intent_.valuation),
                        keccak256(abi.encode(PRICE_TYPEHASH, address(usdc), 1e6, 1e6 * USD)),
                        _retire,
                        _drain
                    )
                )
            )
        );
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
            _coSig(
                _walletKey,
                AccountLib.sessionDigest(address(accountModule), master, _signer, _issuedAt, _expiry, _epoch)
            ),
            _coSig(_signerKey, _digest)
        );
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
        assertEq(usdc.balanceOf(_parent), 1499e6 - 200e6);
        assertEq(usdc.balanceOf(feeReceiver), _relayed + 2 * FEE);
        assertEq(_nonceOf(_parent), 3);
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
        assertEq(usdc.balanceOf(_parent), 1499e6 - 800e6);
        assertEq(usdc.balanceOf(address(swapProvider)), 2 * (400e6 - FEE));
        assertEq(_nonceOf(_parent), 3);
    }

    function test_escrow_admits_only_a_user_account_on_hub_and_spoke() public {
        _openFund();
        address _parent = _account(master);
        address _elsewhere = makeAddr("other-master");
        uint _nonce = _nonceOf(body);
        LiquidityGate.EscrowIntent memory _i = LiquidityGate.EscrowIntent({
            header: _header(body, master, _nonce), master: _elsewhere, token: address(usdc), amount: 100e6
        });
        bytes memory _sig = _pair(
            masterKey,
            _typed(
                body,
                keccak256(
                    abi.encode(ESCROW_INTENT_TYPEHASH, _hashHeader(_i.header), _elsewhere, address(usdc), uint(100e6))
                )
            )
        );
        bytes memory _mismatch = abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body);
        vm.expectRevert(_mismatch);
        hub.escrow(_i, _sig);
        vm.expectRevert(_mismatch);
        spoke.escrow(_i, _sig);
        assertEq(escrowStore.escrowedMap(body, _elsewhere, address(usdc)), 0, "a body escrows nothing on the hub");
        assertEq(spokeEscrowStore.escrowedMap(body, _elsewhere, address(usdc)), 0, "nor on the spoke");
        assertEq(usdc.balanceOf(body), 499e6);
        assertEq(_nonceOf(body), _nonce);

        _escrow(LiquidityGate(address(hub)), address(usdc), 100e6);
        _escrow(LiquidityGate(address(spoke)), address(usdc), 100e6);
        assertEq(escrowStore.escrowedMap(_parent, body, address(usdc)), 600e6, "the user account escrows on the hub");
        assertEq(spokeEscrowStore.escrowedMap(_parent, body, address(usdc)), 100e6, "and on the spoke");
        assertEq(usdc.balanceOf(_parent), 1499e6 - 200e6 - 2 * FEE);
    }

    function test_mandate_admits_only_a_user_account() public {
        _openFund();
        AccountLib.Mandate[] memory _one = new AccountLib.Mandate[](1);
        _one[0] = AccountLib.Mandate({
            master: makeAddr("other-master"),
            skin: 0,
            allocationRate: 5000,
            cooldownPeriod: 0,
            expiry: block.timestamp + 365 days
        });
        bytes[] memory _sigs = new bytes[](1);
        _sigs[0] = _coSig(masterKey, this.digestOf(body, _one[0]));
        address[] memory _tokens = new address[](1);
        _tokens[0] = address(usdc);
        HubGate.MandateIntent memory _i = HubGate.MandateIntent({
            header: _header(body, master, _nonceOf(body)),
            mandateList: _one,
            signatureList: _sigs,
            tokenList: _tokens,
            arm: true
        });
        bytes memory _sig = _pair(
            masterKey,
            _typed(
                body,
                keccak256(
                    abi.encode(
                        MANDATE_INTENT_TYPEHASH,
                        _hashHeader(_i.header),
                        keccak256(abi.encode(_one)),
                        keccak256(abi.encodePacked(_tokens)),
                        true
                    )
                )
            )
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
        hub.mandate(_i, _sig);
        assertEq(mandateStore.mandateMap(body, _one[0].master), bytes32(0), "a body cannot become a puppet");
        assertEq(usdc.allowance(body, address(fundModule)), 0, "so the fund module can never pull its capital");

        _fundWallet(backer, 10e6);
        address _puppet = _account(backer);
        _one[0].master = body;
        _mandate(backer, backerKey, _one);
        assertEq(mandateStore.mandateMap(_puppet, body), this.digestOf(_puppet, _one[0]), "the user account mandates");
        assertEq(usdc.allowance(_puppet, address(fundModule)), type(uint).max);
        assertEq(_nonceOf(_puppet), 1);
    }

    function test_sell_admits_only_a_user_account() public {
        _openFund();
        _fundWallet(backer, 1000e6);
        AccountLib.Mandate[] memory _one = new AccountLib.Mandate[](1);
        _one[0] = AccountLib.Mandate({
            master: body, skin: 0, allocationRate: 5000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
        _mandate(backer, backerKey, _one);
        address _puppet = _account(backer);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = Fund.Allocation({puppet: _puppet, mandate: _one[0], amount: 400e6});
        (Fund.AllocateIntent memory _round, bytes memory _roundSig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        hub.allocate(_round, _roundSig);
        assertEq(share.balanceOf(body), 499e18);
        assertEq(share.balanceOf(_puppet), 399e18);

        Fund.SellIntent memory _i = Fund.SellIntent({
            header: _header(body, master, _nonceOf(body)), master: body, share: share, units: 499e18
        });
        bytes memory _sig = _pair(
            masterKey,
            _typed(
                body,
                keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(_i.header), body, share, uint(499e18)))
            )
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, body));
        hub.sell(_i, _sig);
        assertEq(share.balanceOf(body), 499e18, "the master exits only through redeem");
        assertEq(share.balanceOf(address(fundStore)), 0);

        _sell(backer, backerKey, 399e18);
        assertEq(share.balanceOf(_puppet), 0, "the user account sells");
        assertEq(share.balanceOf(address(fundStore)), 399e18);
        assertEq(fundStore.getQueue(body).weight, 399e18);
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
        assertEq(usdc.balanceOf(_parent), 1499e6);
        assertEq(outToken.balanceOf(_parent), 0);
        assertEq(_nonceOf(_parent), _nonce);

        _fundSwapCall(LiquidityGate(address(hub)), master, masterKey, body, 200e6);
        _fundSwapCall(LiquidityGate(address(spoke)), master, masterKey, body, 200e6);
        assertEq(outToken.balanceOf(body), 2e18, "the body swaps on hub and spoke");
        assertEq(usdc.balanceOf(body), 499e6 - 400e6);
        assertEq(_nonceOf(body), 3);
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
        assertEq(usdc.balanceOf(_parent), 1499e6);
        assertEq(_nonceOf(_parent), _nonce);

        _operate(_callList);
        assertEq(usdc.balanceOf(_venue), 50e6, "the body operates");
        assertEq(usdc.balanceOf(body), 499e6 - 50e6 - FEE);
        assertEq(_nonceOf(body), 2);
    }

    function test_createFund_and_allocate_admit_only_a_body() public {
        address _parent = _account(master);
        (Fund.AllocateIntent memory _open, bytes memory _openSig) =
            _allocateFor(_parent, 0, _credit(block.chainid, address(usdc), 500e6));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), _parent, _parent);
        bytes memory _refused = abi.encodeWithSelector(Error.Account__NotDelegated.selector, _parent);
        vm.expectRevert(_refused);
        hub.createFund(
            bytes32("KND"), new bytes(154), _coSig(masterKey, _genesis), _coSig(masterKey, _genesis), _open, _openSig
        );

        _openFund();
        (address _module, address _bound) = FundAccount(payable(body)).bound();
        assertEq(_module, address(accountModule), "createFund binds the delegated body");
        assertEq(_bound, _parent);

        _escrow(LiquidityGate(address(hub)), address(usdc), 100e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateFor(_parent, _nonceOf(_parent), _credit(block.chainid, address(usdc), 100e6));
        vm.expectRevert(_refused);
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_parent), 0, "a user account mints no units for itself");
        assertEq(escrowStore.fulfilledMap(_parent, body, address(usdc)), 500e6);

        (_i, _sig) = _allocateIntent(
            _nonceOf(body), usdc.balanceOf(body), _credit(block.chainid, address(usdc), 100e6), new Fund.Allocation[](0)
        );
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(body), 598e18, "the body allocates");
        assertEq(usdc.balanceOf(body), 598e6);
        assertEq(escrowStore.fulfilledMap(_parent, body, address(usdc)), 600e6);
    }

    function test_redeem_admits_only_a_body() public {
        _openFund();
        address _parent = _account(master);
        (Fund.RedeemIntent memory _i, bytes memory _sig) = _redeemFor(_parent, _nonceOf(_parent), 249.5e18, 249.5e18);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NotDelegated.selector, _parent));
        hub.redeem(_i, _sig);
        assertEq(share.balanceOf(body), 499e18);
        assertEq(fundStore.retiredMap(body), 0);

        uint _relayed = usdc.balanceOf(feeReceiver);
        (_i, _sig) = _redeemFor(body, _nonceOf(body), 249.5e18, 249.5e18);
        hub.redeem(_i, _sig);
        assertEq(share.totalSupply(), 249.5e18, "the body retires and drains half its units");
        assertEq(share.balanceOf(body), 249.5e18);
        assertEq(share.balanceOf(address(fundStore)), 0);
        assertEq(fundStore.retiredMap(body), 0);
        assertEq(usdc.balanceOf(body), 499e6 - 249.5e6);
        assertEq(usdc.balanceOf(_parent), 1499e6 + 249.5e6 - FEE, "the drained cash lands in the owner account");
        assertEq(usdc.balanceOf(feeReceiver), _relayed + FEE);
        assertEq(_nonceOf(body), 2);
    }

    function test_every_body_entry_refuses_a_contract_posing_as_a_bound_body() public {
        address _victim = _account(master);
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
                _allocateFor(_poser, 0, _credit(block.chainid, address(usdc), 100e6));
            (Fund.RedeemIntent memory _red, bytes memory _redSig) = _redeemFor(_poser, 0, 0, 1);
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
            hub.allocate(_alloc, _allocSig);
            vm.expectRevert(_refused);
            hub.redeem(_red, _redSig);
            vm.expectRevert(_k < 2 ? _refused : abi.encodeWithSelector(Error.Account__AlreadyCreated.selector));
            hub.createFund(bytes32("FAKE"), new bytes(154), "", "", _alloc, _allocSig);
        }
        assertEq(vm.getRecordedLogs().length, 0, "no AccountCall, nor any other log, was written");
        for (uint _k; _k < 3; ++_k) {
            (uint64 _block, bytes24 _tip) = accountModule.accountTipMap(_posers[_k]);
            assertEq(_block, 0, "the poser has no chronicle tip");
            assertEq(_tip, bytes24(0));
        }
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
            parent: _owner, key: _coSig(_freshKey, _genesis), approval: _coSig(masterKey, _genesis)
        });
        AccountLib.Genesis memory _foreign = AccountLib.Genesis({
            parent: _stranger, key: _coSig(_freshKey, _strangerGenesis), approval: _coSig(backerKey, _strangerGenesis)
        });
        (SpokeGate.OperateIntent memory _i, bytes memory _sig) = _operateIntent(_fresh, master, masterKey, 0, _callList);
        (SpokeGate.OperateIntent memory _late, bytes memory _lateSig) =
            _operateIntent(_fresh, master, masterKey, 1, _callList);
        (Fund.AllocateIntent memory _a, bytes memory _aSig) =
            _allocateFor(_fresh, 0, _credit(block.chainid, address(usdc), 10e6));
        bytes memory _mismatch = abi.encodeWithSelector(Error.Account__HeaderMismatch.selector, _fresh);

        vm.expectRevert(_mismatch);
        hub.allocate(_a, _aSig);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.operate(
            _i, _sig, AccountLib.Genesis({parent: _owner, key: _coSig(bodyKey, _genesis), approval: _signed.approval})
        );
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.operate(
            _i, _sig, AccountLib.Genesis({parent: _owner, key: _signed.key, approval: _coSig(backerKey, _genesis)})
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
        _fund.execute(attestor, _digest, _pair(masterKey, _digest), _drain);
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
        IAccount(_ua).execute(attestor, _digest, _pair(masterKey, _digest), _drain);
        assertEq(_token.balanceOf(_ua), 100e6, "an outside verifier cannot move user account funds");
        assertEq(_token.balanceOf(master), 0);
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
        (,,, bytes memory _grant,) = abi.decode(_live, (address, uint, uint, bytes, bytes));
        assertFalse(
            _ua.approves(_digest, abi.encode(_signer, _now, _now + 1 days, _grant, _coSig(backerKey, _digest))),
            "the inner signature must come from the granted signer"
        );
        assertFalse(_ua.approves(keccak256("another intent"), _live), "and cover the digest");

        vm.prank(backer);
        vm.expectRevert(Error.Account__UnauthorizedCaller.selector);
        _ua.revokeSessions();
        vm.prank(master);
        _ua.revokeSessions();
        assertEq(_ua.epoch(), 1);
        assertFalse(_ua.approves(_digest, _live), "a revoked-epoch grant is refused");
        assertTrue(
            _ua.approves(_digest, _sessionBlob(masterKey, _signerKey, _now, _now + 1 days, 1, _digest)),
            "a grant at the new epoch approves"
        );
        assertTrue(_ua.approves(_digest, _coSig(masterKey, _digest)), "the wallet outlives revocation");
    }
}
