// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {V2Base} from "./Base.t.sol";
import {MasterGate, OPERATE_INTENT_TYPEHASH, CREATE_FUND_ACCOUNT_INTENT_TYPEHASH} from "src/MasterGate.sol";
import {IAccount} from "src/core/interface/IAccount.sol";

contract MasterFlowsTest is V2Base {
    struct Fund {
        address fund;
        Puppet master;
        uint nonce;
    }

    // Cross-chain entry: stage capital at the fund's deterministic route, then
    // MasterGate.createFundAccount deploys account+route and sweeps the passthrough in.
    function _makeFund(
        string memory _label,
        uint _sweep
    ) internal returns (Fund memory f) {
        f.master = _makePuppet(_label);
        f.fund = accountModule.predictFundAccount(address(f.master.acct));
        usdc.mint(accountModule.predictRoute(f.fund), _sweep);

        MasterGate.CreateFundAccountIntent memory intent = MasterGate.CreateFundAccountIntent({
            params: _params(f.master.user),
            tokenId: USDC_ID,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: 0,
            chainId: block.chainid,
            sweepAmount: _sweep
        });
        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_FUND_ACCOUNT_INTENT_TYPEHASH,
                _hashAccount(intent.params.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.tokenId,
                intent.sweepAmount
            )
        );
        bytes32 digest = _digest(masterGateDomain, structHash);
        masterGate.createFundAccount(intent, _sign(f.master.key, digest), _sign(attestorKey, digest), 0);
        f.nonce = 1;
    }

    function test_createFundAccount_deploys_and_sweeps_passthrough() public {
        Fund memory f = _makeFund("M", 100e6);
        assertGt(f.fund.code.length, 0, "fund deployed");
        assertEq(usdc.balanceOf(f.fund), 100e6, "swept to account");
        assertEq(usdc.balanceOf(accountModule.predictRoute(f.fund)), 0, "route drained");
    }

    function test_createFundAccount_charges_fee_from_swept_base() public {
        Puppet memory master = _makePuppet("M2");
        address fund = accountModule.predictFundAccount(address(master.acct));
        usdc.mint(accountModule.predictRoute(fund), 100e6);

        MasterGate.CreateFundAccountIntent memory intent = MasterGate.CreateFundAccountIntent({
            params: _params(master.user),
            tokenId: USDC_ID,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 3e6,
            nonce: 0,
            chainId: block.chainid,
            sweepAmount: 100e6
        });
        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_FUND_ACCOUNT_INTENT_TYPEHASH,
                _hashAccount(intent.params.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.tokenId,
                intent.sweepAmount
            )
        );
        bytes32 digest = _digest(masterGateDomain, structHash);
        masterGate.createFundAccount(intent, _sign(master.key, digest), _sign(attestorKey, digest), 3e6);

        assertEq(usdc.balanceOf(fund), 97e6, "fund holds swept minus fee");
        assertEq(usdc.balanceOf(feeReceiver), 3e6, "fee from swept base");
    }

    function _operate(
        Fund memory f,
        IAccount.Call[] memory calls,
        IAccount.SignTransfer[] memory transfers
    ) internal {
        MasterGate.OperateIntent memory intent = MasterGate.OperateIntent({
            params: _params(f.master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: f.nonce,
            chainId: block.chainid,
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
                keccak256(abi.encode(intent.callList)),
                keccak256(abi.encode(intent.transferList))
            )
        );
        bytes32 digest = _digest(masterGateDomain, structHash);
        masterGate.operate(intent, _sign(f.master.key, digest), _sign(attestorKey, digest), 0);
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
        assertEq(usdc.balanceOf(f.fund), 70e6, "fund unsigned base spent");
    }

    function test_operate_nonce_reuse_reverts() public {
        Fund memory f = _makeFund("M", 100e6);
        IAccount.Call[] memory calls = new IAccount.Call[](0);
        _operate(f, calls, new IAccount.SignTransfer[](0));
        vm.expectRevert();
        _operate(f, calls, new IAccount.SignTransfer[](0));
    }
}
