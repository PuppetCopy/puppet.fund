// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console2} from "forge-std/src/console2.sol";

import {BaseScript} from "../deploy/shared/BaseScript.s.sol";

import {AccountLib, ACCOUNT_TYPEHASH} from "src/core/AccountLib.sol";
import {AccountModule} from "src/core/module/AccountModule.sol";
import {PuppetGate, WITHDRAW_INTENT_TYPEHASH, RECOGNIZE_INTENT_TYPEHASH} from "src/PuppetGate.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";

contract SiphonDeployer is BaseScript {
    address constant TARGET = 0x71b0361e3651254249852bceD247B730E03633DD;

    uint internal immutable ATTESTOR_PRIVATE_KEY = _resolveAttestorKey();

    function _resolveAttestorKey() internal view returns (uint) {
        try vm.envUint("ATTESTOR_PRIVATE_KEY") returns (uint _k) {
            return _k;
        } catch {
            require(
                vm.addr(vm.envUint("DEPLOYER_PRIVATE_KEY")) == vm.envAddress("ATTESTOR_ADDRESS"),
                "Siphon: ATTESTOR_PRIVATE_KEY missing and deployer != attestor"
            );
            return vm.envUint("DEPLOYER_PRIVATE_KEY");
        }
    }

    function run() public view {
        require(vm.addr(ATTESTOR_PRIVATE_KEY) == ATTESTOR_ADDRESS, "Siphon: ATTESTOR_PRIVATE_KEY does not match ATTESTOR_ADDRESS");

        PuppetAccount target = PuppetAccount(payable(TARGET));
        require(address(target).code.length > 0, "Siphon: target PuppetAccount not deployed on this chain");

        AccountLib.AccountInitParams memory params = AccountLib.AccountInitParams({
            user: target.getUser(),
            name: target.getName(),
            baseTokenId: target.getBaseTokenId(),
            signer: target.getSigner()
        });

        console2.log("Siphon: chain", block.chainid);
        console2.log("Siphon: target PuppetAccount", TARGET);
        console2.log("Siphon: params.user", params.user);
        console2.logBytes32(params.name);
        console2.logBytes32(params.baseTokenId);
        console2.log("Siphon: params.signer", params.signer);

        AccountModule accountModule = AccountModule(_getCoreAddress("AccountModule"));
        PuppetGate puppetGate = PuppetGate(_getChainAddress("PuppetGate"));
        address transientRoute = accountModule.predictTransientRoute(TARGET);

        // The deployer account is keyed on a single baseTokenId; resolve the registered token from it.
        IERC20 token = _resolveToken(params.baseTokenId);

        uint trBalance = token.balanceOf(transientRoute);
        uint accountBalance = token.balanceOf(TARGET);
        uint signed = target.signedBalance();

        console2.log("Siphon: token", address(token));
        console2.log("Siphon: TR balance", trBalance);
        console2.log("Siphon: account balanceOf", accountBalance);
        console2.log("Siphon: account signedBalance", signed);

        if (trBalance > 0) {
            console2.log("--- recognize calldata (run via cast send) ---");
            _emitRecognizeCalldata(puppetGate, params, trBalance);
            signed += trBalance;
        }

        uint surplus = accountBalance > signed ? accountBalance - signed : 0;
        if (surplus > 0) {
            console2.log("Siphon: unrecorded account surplus (no recognize path in symmetric model)", surplus);
        }

        if (signed > 0) {
            console2.log("--- walletWithdraw calldata (run via cast send) ---");
            _emitWalletWithdrawCalldata(puppetGate, params, signed);
        } else {
            console2.log("Siphon: nothing to withdraw");
        }

        uint trailingSurplus = token.balanceOf(TARGET);
        if (trailingSurplus > 0) {
            console2.log("Siphon: unrecorded surplus stranded on v8 (balanceOf > signedBalance)", trailingSurplus);
        }
    }

    function _resolveToken(
        bytes32 _baseTokenId
    ) internal view returns (IERC20) {
        bytes32 usdc = keccak256(bytes("USDC"));
        bytes32 weth = keccak256(bytes("WETH"));
        if (_baseTokenId == usdc) return _getChainToken("USDC");
        if (_baseTokenId == weth) return _getChainToken("WETH");
        revert("Siphon: unknown baseTokenId on this chain");
    }

    function _emitRecognizeCalldata(
        PuppetGate _puppetGate,
        AccountLib.AccountInitParams memory _params,
        uint _amount
    ) internal view {
        uint _nonce = uint(keccak256(abi.encode("SiphonDeployer", "recognize", block.timestamp, block.chainid)));

        PuppetGate.RecognizeIntent memory intent = PuppetGate.RecognizeIntent({
            params: _params,
            blockNumber: _currentBlockNumber(),
            deadline: block.timestamp + 3600,
            acceptableRelayFee: 0,
            nonce: _nonce,
            chainId: block.chainid,
            amount: _amount
        });

        bytes32 _structHash = keccak256(
            abi.encode(
                RECOGNIZE_INTENT_TYPEHASH,
                _hashAccount(intent.params),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.amount
            )
        );

        bytes32 _digest = _hashTypedData(_puppetGate, _structHash);
        bytes memory _userSig = _sign(DEPLOYER_PRIVATE_KEY, _digest);
        bytes memory _attestorSig = _sign(ATTESTOR_PRIVATE_KEY, _digest);

        bytes memory _calldata = abi.encodeCall(PuppetGate.recognize, (intent, _userSig, _attestorSig, 0));
        console2.log("to:", address(_puppetGate));
        console2.log("data:");
        console2.logBytes(_calldata);
    }

    function _emitWalletWithdrawCalldata(
        PuppetGate _puppetGate,
        AccountLib.AccountInitParams memory _params,
        uint _amount
    ) internal view {
        uint _nonce = uint(keccak256(abi.encode("SiphonDeployer", "walletWithdraw", block.timestamp, block.chainid)));

        PuppetGate.WithdrawIntent memory intent = PuppetGate.WithdrawIntent({
            params: _params,
            blockNumber: _currentBlockNumber(),
            deadline: block.timestamp + 3600,
            acceptableRelayFee: 0,
            nonce: _nonce,
            chainId: block.chainid,
            amount: _amount
        });

        bytes32 _structHash = keccak256(
            abi.encode(
                WITHDRAW_INTENT_TYPEHASH,
                _hashAccount(intent.params),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.amount
            )
        );

        bytes32 _digest = _hashTypedData(_puppetGate, _structHash);
        bytes memory _userSig = _sign(DEPLOYER_PRIVATE_KEY, _digest);
        bytes memory _attestorSig = _sign(ATTESTOR_PRIVATE_KEY, _digest);

        bytes memory _calldata = abi.encodeCall(PuppetGate.walletWithdraw, (intent, _userSig, _attestorSig, 0));
        console2.log("to:", address(_puppetGate));
        console2.log("data:");
        console2.logBytes(_calldata);
    }

    function _currentBlockNumber() internal view returns (uint) {
        try vm.envUint("INTENT_BLOCK_NUMBER") returns (uint _bn) {
            return _bn;
        } catch {
            if (block.chainid == 42161) {
                (bool ok, bytes memory data) = address(100).staticcall(abi.encodeWithSignature("arbBlockNumber()"));
                require(ok, "Siphon: arbBlockNumber call failed (set INTENT_BLOCK_NUMBER env)");
                return abi.decode(data, (uint));
            }
            return block.number;
        }
    }

    function _hashTypedData(
        PuppetGate _puppetGate,
        bytes32 _structHash
    ) internal view returns (bytes32) {
        (, string memory _name, string memory _version, uint _chainId, address _verifyingContract,,) = _puppetGate.eip712Domain();
        bytes32 _domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(_name)),
                keccak256(bytes(_version)),
                _chainId,
                _verifyingContract
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator, _structHash));
    }

    function _sign(
        uint _privateKey,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_privateKey, _digest);
        return abi.encodePacked(r, s, v);
    }

    function _hashAccount(
        AccountLib.AccountInitParams memory _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(ACCOUNT_TYPEHASH, _p.user, _p.name, _p.baseTokenId, _p.signer));
    }
}
