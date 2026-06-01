// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Test} from "forge-std/src/Test.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {AccountLib} from "src/core/AccountLib.sol";

// Pins SDK's off-chain predictor against AccountLib's on-chain predictor.
// The SDK (sdk/src/core/createAccount.ts) computes master/puppet/deposit
// addresses by:
//   initCode    = 0x61 || runSize:u16 || 3d81600a3d39f3 || 363d3d373d3d3d363d73
//                 || impl(20) || 5af43d82803e903d91602b57fd5bf3 || args
//   bytecodeHash= keccak256(initCode)
//   address     = keccak256(0xff || deployer || salt || bytecodeHash)[-20:]
// Master/Puppet use args=packed(user,name,baseTokenId,signer) + salt=keccak256(args).
// Deposit uses    args=packed(account)                       + salt=pad-left(account,32).
// AccountLib uses Solady's predictDeterministicAddress with the same args + salt.
// CloneInitCode.t.sol already proves Solady's predict == raw CREATE2 against that
// init-code layout, so matching (args, salt, deployer, impl) here guarantees SDK
// and on-chain derivations produce the same address.
contract AccountLibPredictTest is Test {
    address constant DEPLOYER = address(0xabCDEF1234567890ABcDEF1234567890aBCDeF12);
    address constant IMPL = address(0x1234567890123456789012345678901234567890);

    function _sdkPredict(
        address _impl,
        bytes memory _args,
        bytes32 _salt,
        address _deployer
    ) internal pure returns (address) {
        bytes memory _initCode = abi.encodePacked(
            hex"61",
            bytes2(uint16(0x2d + _args.length)),
            hex"3d81600a3d39f3",
            hex"363d3d373d3d3d363d73",
            _impl,
            hex"5af43d82803e903d91602b57fd5bf3",
            _args
        );
        bytes32 _bytecodeHash = keccak256(_initCode);
        return address(uint160(uint(keccak256(abi.encodePacked(hex"ff", _deployer, _salt, _bytecodeHash)))));
    }

    function test_master_predict_matches_sdk() public pure {
        bytes memory args = abi.encodePacked(
            address(0xCaFE0000000000000000000000000000000000ca), bytes32("master-1"), keccak256("USDC")
        );
        bytes32 salt = keccak256(args);
        address viaLibClone = LibClone.predictDeterministicAddress(IMPL, args, salt, DEPLOYER);
        address viaSdk = _sdkPredict(IMPL, args, salt, DEPLOYER);
        assertEq(viaLibClone, viaSdk);
    }

    function test_puppet_predict_matches_sdk() public pure {
        bytes memory args = abi.encodePacked(
            address(0xBEeF0000000000000000000000000000000000bE), bytes32("puppet-1"), keccak256("USDC")
        );
        bytes32 salt = keccak256(args);
        address viaLibClone = LibClone.predictDeterministicAddress(IMPL, args, salt, DEPLOYER);
        address viaSdk = _sdkPredict(IMPL, args, salt, DEPLOYER);
        assertEq(viaLibClone, viaSdk);
    }

    function test_deposit_predict_matches_sdk() public pure {
        address account = address(0xdeF1acE0000000000000000000000000000000F0);
        bytes memory args = abi.encodePacked(account);
        bytes32 salt = bytes32(uint(uint160(account)));
        address viaLibClone = LibClone.predictDeterministicAddress(IMPL, args, salt, DEPLOYER);
        address viaSdk = _sdkPredict(IMPL, args, salt, DEPLOYER);
        assertEq(viaLibClone, viaSdk);
    }

    function testFuzz_master_predict_matches_sdk(
        address user,
        bytes32 name,
        bytes32 baseTokenId,
        address impl,
        address deployer
    ) public pure {
        bytes memory args = abi.encodePacked(user, name, baseTokenId);
        bytes32 salt = keccak256(args);
        address viaLibClone = LibClone.predictDeterministicAddress(impl, args, salt, deployer);
        address viaSdk = _sdkPredict(impl, args, salt, deployer);
        assertEq(viaLibClone, viaSdk);
    }

    function testFuzz_puppet_predict_matches_sdk(
        address user,
        bytes32 name,
        bytes32 baseTokenId,
        address impl,
        address deployer
    ) public pure {
        bytes memory args = abi.encodePacked(user, name, baseTokenId);
        bytes32 salt = keccak256(args);
        address viaLibClone = LibClone.predictDeterministicAddress(impl, args, salt, deployer);
        address viaSdk = _sdkPredict(impl, args, salt, deployer);
        assertEq(viaLibClone, viaSdk);
    }

    function testFuzz_deposit_predict_matches_sdk(
        address account,
        address impl,
        address deployer
    ) public pure {
        bytes memory args = abi.encodePacked(account);
        bytes32 salt = bytes32(uint(uint160(account)));
        address viaLibClone = LibClone.predictDeterministicAddress(impl, args, salt, deployer);
        address viaSdk = _sdkPredict(impl, args, salt, deployer);
        assertEq(viaLibClone, viaSdk);
    }

    function test_accountLib_master_predict_uses_expected_formula() public {
        AccountLib.AccountInitParams memory p = AccountLib.AccountInitParams({
            user: address(0xCaFE0000000000000000000000000000000000ca),
            name: bytes32("master-1"),
            baseTokenId: keccak256("USDC"),
            signer: address(uint160(uint(keccak256("session-master"))))
        });
        AccountLibHarness harness = new AccountLibHarness();
        bytes memory args = abi.encodePacked(address(harness), p.signer, p.user, p.name, p.baseTokenId);
        address expected = _sdkPredict(IMPL, args, keccak256(args), address(harness));
        assertEq(harness.predictAccount(IMPL, p), expected);
    }

    function test_accountLib_puppet_predict_uses_expected_formula() public {
        AccountLib.AccountInitParams memory p = AccountLib.AccountInitParams({
            user: address(0xBEeF0000000000000000000000000000000000bE),
            name: bytes32("puppet-1"),
            baseTokenId: keccak256("USDC"),
            signer: address(uint160(uint(keccak256("session-puppet"))))
        });
        AccountLibHarness harness = new AccountLibHarness();
        bytes memory args = abi.encodePacked(address(harness), p.signer, p.user, p.name, p.baseTokenId);
        address expected = _sdkPredict(IMPL, args, keccak256(args), address(harness));
        assertEq(harness.predictAccount(IMPL, p), expected);
    }

    function test_accountLib_deposit_predict_uses_expected_formula() public pure {
        address account = address(0xdeF1acE0000000000000000000000000000000F0);
        address factory = address(0xCAfEcAfeCAfECaFeCaFecaFecaFECafECafeCaFe);
        bytes memory args = abi.encodePacked(account);
        bytes32 salt = bytes32(uint(uint160(account)));
        address expected = _sdkPredict(IMPL, args, salt, factory);
        assertEq(AccountLib.predictTransientRoute(IMPL, factory, account), expected);
    }
}

// Thin call-through contract so AccountLib's `address(this)` deployer context
// becomes a known address during tests.
contract AccountLibHarness {
    function predictAccount(
        address _impl,
        AccountLib.AccountInitParams calldata _params
    ) external view returns (address) {
        return AccountLib.predict(_impl, address(this), _params);
    }
}
