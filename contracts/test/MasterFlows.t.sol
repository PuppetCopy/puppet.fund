// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {V2Base} from "./Base.t.sol";
import {FundGate, OPERATE_INTENT_TYPEHASH} from "src/FundGate.sol";
import {Allocate, ALLOCATE_INTENT_TYPEHASH} from "src/hub/Allocate.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";

contract MasterFlowsTest is V2Base {
    struct Fund {
        address fund;
        Puppet master;
        uint nonce;
    }

    function _allocateDigest(
        Allocate.AllocateIntent memory _i
    ) internal view returns (bytes32) {
        return _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    ALLOCATE_INTENT_TYPEHASH,
                    _hashAccount(_i.params.user, address(0)),
                    _i.blockNumber,
                    _i.deadline,
                    _i.acceptableRelayFee,
                    _i.nonce,
                    _i.chainId,
                    _hashFundParams(_i.fundParams),
                    _i.acceptableNetAssetValue,
                    _i.totalShareSupply,
                    _i.masterAmount,
                    keccak256(abi.encodePacked(_i.puppetList)),
                    keccak256(abi.encodePacked(_i.allocatedAmountList))
                )
            )
        );
    }

    // A fund is created lazily by allocate; the master stakes from its route and the
    // fund ends holding the stake minus the socialized relay fee.
    function _makeFund(
        string memory _label,
        uint _masterAmount
    ) internal returns (Fund memory f) {
        f.master = _makePuppet(_label);
        f.fund = _fundOf(address(f.master.acct));
        usdc.mint(accountModule.predictRoute(address(f.master.acct)), _masterAmount);

        Allocate.AllocateIntent memory a = Allocate.AllocateIntent({
            params: _params(f.master.user),
            fundParams: _fundParams(address(f.master.acct)),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 2e6,
            nonce: f.master.nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: 100e6,
            totalShareSupply: 0,
            masterAmount: _masterAmount,
            puppetList: new address[](0),
            allocatedAmountList: new uint[](0)
        });
        bytes32 ad = _allocateDigest(a);
        hubGate.allocate(a, new bytes[](0), new bytes[](0), _sign(f.master.key, ad), _sign(attestorKey, ad), 2e6);
        f.nonce = 2;
    }

    function _operate(
        Fund memory f,
        IAccount.Call[] memory calls,
        IAccount.SignTransfer[] memory transfers
    ) internal {
        FundGate.OperateIntent memory intent = FundGate.OperateIntent({
            params: _params(f.master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: f.nonce,
            chainId: block.chainid,
            fundParams: _fundParams(address(f.master.acct)),
            callList: calls,
            transferList: transfers
        });
        bytes32 structHash = keccak256(
            abi.encode(
                OPERATE_INTENT_TYPEHASH,
                _hashAccount(intent.params.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                _hashFundParams(intent.fundParams),
                keccak256(abi.encode(intent.callList)),
                keccak256(abi.encode(intent.transferList))
            )
        );
        bytes32 digest = _digest(fundGateDomain, structHash);
        fundGate.operate(intent, _sign(f.master.key, digest), _sign(attestorKey, digest), 0);
    }

    function test_operate_fans_out_on_fund_account() public {
        Fund memory f = _makeFund("M", 100e6);
        address venue = makeAddr("Venue");

        IAccount.Call[] memory calls = new IAccount.Call[](1);
        calls[0] = IAccount.Call({
            target: address(usdc), value: 0, gasLimit: GAS, callData: abi.encodeCall(IERC20.transfer, (venue, 30e6))
        });
        _operate(f, calls, new IAccount.SignTransfer[](0));

        assertEq(usdc.balanceOf(venue), 30e6, "venue received");
        assertEq(usdc.balanceOf(f.fund), 68e6, "fund base spent (98 staked minus 30)");
    }

    function test_operate_nonce_reuse_reverts() public {
        Fund memory f = _makeFund("M", 100e6);
        IAccount.Call[] memory calls = new IAccount.Call[](0);
        _operate(f, calls, new IAccount.SignTransfer[](0));
        vm.expectRevert();
        _operate(f, calls, new IAccount.SignTransfer[](0));
    }
}
