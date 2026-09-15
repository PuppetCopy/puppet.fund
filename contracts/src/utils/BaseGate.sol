// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Error} from "./Error.sol";
import {AccountLib} from "./AccountLib.sol";
import {BalanceLib} from "./BalanceLib.sol";
import {CallLib} from "./CallLib.sol";
import {IntentLib, RATE_PRECISION} from "./IntentLib.sol";
import {IAccount} from "./interfaces/IAccount.sol";
import {AccountModule} from "../core/AccountModule.sol";
import {Register} from "../core/Register.sol";

abstract contract BaseGate {
    struct Config {
        address attestor;
        address feeReceiver;
        uint transferGasLimit;
        uint maxIntentTtl;
        uint maxRelayFeeBps;
        uint performanceFee;
        uint maxCohortSize;
    }

    AccountModule internal immutable accountModule;
    Register internal immutable registerModule;

    address internal immutable attestor;
    address internal immutable feeReceiver;
    uint internal immutable transferGasLimit;
    uint internal immutable maxIntentTtl;
    uint internal immutable maxRelayFeeBps;
    uint internal immutable performanceFee;
    uint internal immutable maxCohortSize;

    constructor(
        AccountModule _accountModule,
        Register _register,
        Config memory _config
    ) {
        if (
            address(_accountModule) == address(0) || address(_register) == address(0) || _config.attestor == address(0)
                || _config.feeReceiver == address(0)
        ) {
            revert Error.Gate__InvalidModule();
        }
        if (_config.maxRelayFeeBps >= RATE_PRECISION) {
            revert Error.Gate__InvalidRelayFeeBps(_config.maxRelayFeeBps);
        }
        if (_config.performanceFee >= RATE_PRECISION) {
            revert Error.Gate__InvalidPerformanceFee(_config.performanceFee);
        }
        if (_config.maxCohortSize == 0) revert Error.Gate__InvalidCohortCap();
        accountModule = _accountModule;
        registerModule = _register;
        attestor = _config.attestor;
        feeReceiver = _config.feeReceiver;
        transferGasLimit = _config.transferGasLimit;
        maxIntentTtl = _config.maxIntentTtl;
        maxRelayFeeBps = _config.maxRelayFeeBps;
        performanceFee = _config.performanceFee;
        maxCohortSize = _config.maxCohortSize;
    }

    function getConfig() external view returns (Config memory) {
        return Config({
            attestor: attestor,
            feeReceiver: feeReceiver,
            transferGasLimit: transferGasLimit,
            maxIntentTtl: maxIntentTtl,
            maxRelayFeeBps: maxRelayFeeBps,
            performanceFee: performanceFee,
            maxCohortSize: maxCohortSize
        });
    }

    function _deriveAccount(
        address _account,
        address _owner,
        AccountLib.Genesis calldata _genesis
    ) internal {
        address _user = accountModule.userOf(_account);
        if (_user == address(0)) {
            if (_genesis.signer == attestor) revert Error.Account__InvalidUser();
            accountModule.createAccount(_account, _owner, _genesis.signer, _genesis.expiry, _genesis.key, _genesis.user);
        } else if (_user != _owner) {
            revert Error.Account__HeaderMismatch(_account);
        }
    }

    function _existingAccount(
        address _account,
        address _owner
    ) internal view {
        address _user = accountModule.userOf(_account);
        if (_user == address(0) || _user != _owner) revert Error.Account__HeaderMismatch(_account);
    }

    function _authorize(
        AccountLib.IntentHeader calldata _header,
        bytes32 _structHash
    ) internal view returns (bytes32 digest_) {
        digest_ = AccountLib.typedDigest(block.chainid, _header.account, _structHash);
        IntentLib.verifyIntent(_header, maxIntentTtl);
    }

    function _feeLeg(
        AccountLib.IntentHeader calldata _header
    ) internal view returns (IAccount.Call memory) {
        return CallLib.pay(_header.feeToken, feeReceiver, _header.fee, transferGasLimit);
    }
}
