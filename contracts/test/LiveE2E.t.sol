// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/src/Test.sol";

import {
    ALLOCATE_INTENT_TYPEHASH,
    CREDIT_TYPEHASH,
    HubGate,
    MANDATE_INTENT_TYPEHASH,
    PRICE_TYPEHASH,
    REDEEM_INTENT_TYPEHASH,
    SELL_INTENT_TYPEHASH,
    VALUATION_TYPEHASH
} from "src/HubGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {Deposit} from "src/core/Deposit.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {Fund} from "src/core/Fund.sol";
import {FundStore} from "src/core/FundStore.sol";
import {Share} from "src/core/Share.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

contract LiveE2ETest is Test {
    uint constant FEE = 1e6;
    uint constant USD = 1e24;

    IERC20 usdc;
    HubGate hub;
    Fund fundModule;
    AccountModule accountModule;
    Deposit depositModule;
    FundStore fundStore;
    EscrowStore escrowStore;

    address attestor;
    uint attestorKey;
    address master;
    uint masterKey;
    address body;
    uint bodyKey;
    address backer;
    uint backerKey;
    Share share;

    function setUp() public {
        vm.skip(!vm.envOr("LIVE_E2E", false));
        vm.createSelectFork("optimism");
        string memory _deployed = vm.readFile("deployments.toml");
        usdc = IERC20(vm.parseTomlAddress(vm.readFile("const.toml"), ".TOKEN_ADDRESS.optimism.USDC.address"));
        hub = HubGate(vm.parseTomlAddress(_deployed, ".chain.optimism.HubGate"));
        fundModule = Fund(vm.parseTomlAddress(_deployed, ".chain.optimism.Fund"));
        accountModule = AccountModule(vm.parseTomlAddress(_deployed, ".chain.optimism.AccountModule"));
        depositModule = Deposit(payable(vm.parseTomlAddress(_deployed, ".chain.optimism.Deposit")));
        fundStore = FundStore(payable(vm.parseTomlAddress(_deployed, ".chain.optimism.FundStore")));
        escrowStore = EscrowStore(payable(vm.parseTomlAddress(_deployed, ".chain.optimism.EscrowStore")));

        attestorKey = vm.envUint("ATTESTOR_PRIVATE_KEY");
        attestor = vm.addr(attestorKey);
        assertEq(hub.getConfig().attestor, attestor, "the live gate must accept this attestor");

        (master, masterKey) = makeAddrAndKey("live-master");
        (body, bodyKey) = makeAddrAndKey("live-body");
        (backer, backerKey) = makeAddrAndKey("live-backer");

        vm.signAndAttachDelegation(accountModule.bodyImpl(), bodyKey);
    }

    function test_live_opens_a_fund_backs_it_and_pays_out() public {
        _fundWallet(master, 2000e6);
        _fundWallet(backer, 1000e6);

        bytes32 _symbol = bytes32("LIVE");
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
                                keccak256(_cloneCode(fundModule.shareImpl(), abi.encodePacked(_symbol, _pixels, uint16(1000))))
                            )
                        )
                    )
                )
            )
        );

        address _parent = _account(master);
        deal(address(usdc), master, 500e6);
        vm.startPrank(master);
        usdc.approve(address(depositModule), 500e6);
        hub.depositEscrow(body, address(usdc), 500e6);
        vm.stopPrank();
        assertEq(escrowStore.escrowedMap(_parent, body, address(usdc)), 500e6, "the wallet escrows into the live store in one call");

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);

        assertEq(share.symbol(), "LIVE", "the live share carries the fund symbol");
        assertEq(share.performanceFee(), 1000, "the live share carries the fund fee");
        assertEq(escrowStore.fulfilledMap(_parent, body, address(usdc)), 500e6, "the opening round released the live escrow");
        assertEq(hub.maxCohortSize(), 50, "the cohort cap lives on the hub gate");
        assertGt(share.balanceOf(body), 0, "the opening round mints for the master");
        assertEq(usdc.balanceOf(body), 500e6 - FEE, "escrow landed in the fund net of the fee");

        AccountLib.Mandate memory _m = AccountLib.Mandate({
            master: body,
            skin: 0,
            allocationRate: 5000,
            cooldownPeriod: 0,
            expiry: block.timestamp + 365 days
        });
        AccountLib.Mandate[] memory _one = new AccountLib.Mandate[](1);
        _one[0] = _m;
        _mandate(_one);

        deal(address(usdc), master, 50e6);
        vm.startPrank(master);
        usdc.approve(address(depositModule), 50e6);
        hub.depositEscrow(body, address(usdc), 50e6);
        vm.stopPrank();
        uint _masterUnits = share.balanceOf(body);

        vm.warp(vm.getBlockTimestamp() + 1);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = Fund.Allocation({puppet: _account(backer), mandate: _m, amount: 400e6});
        (Fund.AllocateIntent memory _i2, bytes memory _sig2) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _credit(50e6), _rows);
        hub.allocate(_i2, _sig2);

        uint _backerUnits = share.balanceOf(_account(backer));
        assertGt(_backerUnits, 0, "the backer holds units after the live round");
        assertGt(share.balanceOf(body), _masterUnits, "the direct escrow was credited as the master leg");
        assertEq(escrowStore.fulfilledMap(_parent, body, address(usdc)), 550e6, "and released through the live escrow ledger");

        _sell(_backerUnits);
        assertEq(share.balanceOf(address(fundStore)), _backerUnits, "sold units wait in the queue");

        uint _before = usdc.balanceOf(_account(backer));
        vm.warp(vm.getBlockTimestamp() + 1);
        _redeem(0, _backerUnits);
        hub.claim(body, share, _account(backer));
        assertGt(usdc.balanceOf(_account(backer)), _before, "the backer is paid out on live contracts");
        assertEq(share.balanceOf(address(fundStore)), 0, "the queue is empty again");
    }

    function _account(
        address _user
    ) internal returns (address) {
        return accountModule.createUserAccount(_user);
    }

    function _fundWallet(
        address _user,
        uint _amount
    ) internal {
        deal(address(usdc), _user, _amount);
        vm.startPrank(_user);
        IERC20(address(usdc)).approve(address(depositModule), _amount);
        hub.deposit(address(usdc), _amount);
        vm.stopPrank();
    }

    function _nonceOf(
        address _acct
    ) internal view returns (uint) {
        return UserAccount(payable(_acct)).nonce();
    }

    function _header(
        address _acct,
        address _user,
        uint _nonce
    ) internal view returns (AccountLib.IntentHeader memory) {
        return AccountLib.IntentHeader({
            account: _acct,
            user: _user,
            nonce: _nonce,
            deadline: block.timestamp + 300,
            feeToken: address(usdc),
            fee: FEE
        });
    }

    function _fundHeader(
        uint _nonce
    ) internal view returns (AccountLib.IntentHeader memory header_) {
        header_ = _header(body, master, _nonce);
        header_.feeToken = address(0);
        header_.fee = FEE * USD;
    }

    function _coSig(
        uint _key,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        (uint8 _v, bytes32 _r, bytes32 _s) = vm.sign(_key, _digest);
        return abi.encodePacked(_r, _s, _v);
    }

    function _pair(
        uint _key,
        bytes32 _digest
    ) internal view returns (bytes memory) {
        return bytes.concat(_coSig(_key, _digest), _coSig(attestorKey, _digest));
    }

    function _typed(
        address _acct,
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return AccountLib.intentDigest(_acct, _acct.code.length == 0 ? 0 : IAccount(_acct).nonce(), _structHash);
    }

    function _valuation(
        uint _value
    ) internal view returns (Fund.Valuation memory) {
        return Fund.Valuation({
            value: _value * USD,
            assetList: new Fund.Asset[](0),
            positionList: new Fund.Position[](0)
        });
    }

    function _valuationHash(
        Fund.Valuation memory _v
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                VALUATION_TYPEHASH,
                _v.value,
                keccak256(abi.encode(_v.assetList)),
                keccak256(abi.encode(_v.positionList))
            )
        );
    }

    function _credit(
        uint _amount
    ) internal view returns (Fund.Credit memory) {
        return Fund.Credit({chainId: block.chainid, token: address(usdc), amount: _amount});
    }

    function _allocateIntent(
        uint _nonce,
        uint _value,
        Fund.Credit memory _credits,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        intent_ = Fund.AllocateIntent({
            header: _fundHeader(_nonce),
            share: share,
            valuation: _valuation(_value),
            price: Fund.Price({token: address(usdc), amount: 1e6, value: 1e6 * USD}),
            credit: _credits,
            allocationList: _rows
        });
        coSig_ = _pair(
            masterKey,
            _typed(
                body,
                keccak256(
                    abi.encode(
                        ALLOCATE_INTENT_TYPEHASH,
                        keccak256(
                            abi.encode(
                                keccak256(
                                    "IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                                ),
                                intent_.header.account,
                                intent_.header.user,
                                intent_.header.nonce,
                                intent_.header.deadline,
                                intent_.header.feeToken,
                                intent_.header.fee
                            )
                        ),
                        intent_.share,
                        _valuationHash(intent_.valuation),
                        keccak256(
                            abi.encode(
                                PRICE_TYPEHASH, intent_.price.token, intent_.price.amount, intent_.price.value
                            )
                        ),
                        keccak256(abi.encode(CREDIT_TYPEHASH, _credits.chainId, _credits.token, _credits.amount)),
                        keccak256(abi.encode(_rows))
                    )
                )
            )
        );
    }

    function _hashHeader(
        AccountLib.IntentHeader memory _h
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)"
                ),
                _h.account,
                _h.user,
                _h.nonce,
                _h.deadline,
                _h.feeToken,
                _h.fee
            )
        );
    }

    function digestOf(
        address _puppet,
        AccountLib.Mandate calldata _m
    ) external pure returns (bytes32) {
        return AccountLib.mandateDigest(_puppet, _m);
    }

    function _mandate(
        AccountLib.Mandate[] memory _list
    ) internal {
        address _acct = _account(backer);
        bytes[] memory _sigs = new bytes[](_list.length);
        for (uint _j; _j < _list.length; ++_j) {
            _sigs[_j] = _coSig(backerKey, this.digestOf(_acct, _list[_j]));
        }
        address[] memory _tokens = new address[](1);
        _tokens[0] = address(usdc);
        HubGate.MandateIntent memory _i = HubGate.MandateIntent({
            header: _header(_acct, backer, _nonceOf(_acct)),
            mandateList: _list,
            signatureList: _sigs,
            tokenList: _tokens,
            arm: true
        });
        hub.mandate(
            _i,
            _pair(
                backerKey,
                _typed(
                    _acct,
                    keccak256(
                        abi.encode(
                            MANDATE_INTENT_TYPEHASH,
                            _hashHeader(_i.header),
                            keccak256(abi.encode(_list)),
                            keccak256(abi.encodePacked(_tokens)),
                            _i.arm
                        )
                    )
                )
            )
        );
    }

    function _sell(
        uint _units
    ) internal {
        address _acct = _account(backer);
        Fund.SellIntent memory _i =
            Fund.SellIntent({header: _header(_acct, backer, _nonceOf(_acct)), share: share, master: body, units: _units});
        hub.sell(
            _i,
            _pair(
                backerKey,
                _typed(
                    _acct,
                    keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(_i.header), _i.master, _i.share, _i.units))
                )
            )
        );
    }

    function _redeem(
        uint _retire,
        uint _drain
    ) internal {
        Fund.RedeemIntent memory _i = Fund.RedeemIntent({
            header: _fundHeader(_nonceOf(body)),
            share: share,
            valuation: _valuation(usdc.balanceOf(body)),
            retire: _retire,
            drain: _drain,
            price: Fund.Price({token: address(usdc), amount: 1e6, value: 1e6 * USD})
        });
        hub.redeem(
            _i,
            _pair(
                masterKey,
                _typed(
                    body,
                    keccak256(
                        abi.encode(
                            REDEEM_INTENT_TYPEHASH,
                            _hashHeader(_i.header),
                            _i.share,
                            _valuationHash(_i.valuation),
                            keccak256(abi.encode(PRICE_TYPEHASH, _i.price.token, _i.price.amount, _i.price.value)),
                            _i.retire,
                            _i.drain
                        )
                    )
                )
            )
        );
    }

    function _cloneCode(
        address _impl,
        bytes memory _args
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            hex"61", uint16(_args.length + 0x2d), hex"3d81600a3d39f3363d3d373d3d3d363d73", _impl, hex"5af43d82803e903d91602b57fd5bf3", _args
        );
    }
}
