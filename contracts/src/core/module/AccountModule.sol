// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAccount} from "../interface/IAccount.sol";
import {AccountLib} from "../AccountLib.sol";
import {PuppetAccount} from "../PuppetAccount.sol";
import {MasterAccount} from "../MasterAccount.sol";
import {Attest} from "../Attest.sol";
import {Permission} from "../../utils/auth/Permission.sol";
import {Error} from "../../utils/Error.sol";
import {NonceLib} from "../../utils/NonceLib.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";

bytes32 constant CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH = keccak256(
    "CreatePuppetAccountIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,uint256 initialDepositAmount)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant CREATE_MASTER_ACCOUNT_INTENT_TYPEHASH = keccak256(
    "CreateMasterAccountIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,uint256 initialDepositAmount)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

contract AccountModule is Permission {
    struct CreatePuppetAccountIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        uint initialDepositAmount;
    }

    struct CreateMasterAccountIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        uint initialDepositAmount;
    }

    uint internal constant _NONCE_SCOPE = uint32(bytes4(keccak256("PuppetAccount")));

    Attest public immutable attest;
    address public immutable puppetAccountImpl;
    address public immutable transientRouteImpl;
    address public immutable masterAccountImpl;

    constructor(
        IAuthority _authority,
        Attest _attest,
        address _puppetAccountImpl,
        address _transientRouteImpl,
        address _masterAccountImpl
    ) Permission(_authority) {
        if (
            address(_attest) == address(0) || _puppetAccountImpl == address(0) || _transientRouteImpl == address(0)
                || _masterAccountImpl == address(0)
        ) {
            revert Error.Register__InvalidImpl();
        }
        attest = _attest;
        puppetAccountImpl = _puppetAccountImpl;
        transientRouteImpl = _transientRouteImpl;
        masterAccountImpl = _masterAccountImpl;
    }

    function predictPuppetAccount(
        AccountLib.AccountInitParams calldata _params
    ) external view returns (address) {
        return AccountLib.predict(puppetAccountImpl, address(attest), _params);
    }

    function verifyPuppetAccount(
        AccountLib.AccountInitParams calldata _params
    ) external view returns (PuppetAccount) {
        return PuppetAccount(payable(AccountLib.verify(puppetAccountImpl, address(attest), _params)));
    }

    function predictMasterAccount(
        AccountLib.AccountInitParams calldata _params
    ) external view returns (address) {
        return AccountLib.predict(masterAccountImpl, address(attest), _params);
    }

    function verifyMasterAccount(
        AccountLib.AccountInitParams calldata _params
    ) external view returns (MasterAccount) {
        return MasterAccount(payable(AccountLib.verify(masterAccountImpl, address(attest), _params)));
    }

    function predictTransientRoute(
        address _account
    ) external view returns (address) {
        return AccountLib.predictTransientRoute(transientRouteImpl, address(this), _account);
    }

    function isNonceConsumed(
        address _account,
        uint _nonce
    ) external view returns (bool) {
        return NonceLib.isConsumedBy(_NONCE_SCOPE, _nonce, _account);
    }

    function createPuppetAccount(
        AccountLib.AccountInitParams calldata _params,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof
    ) external auth returns (PuppetAccount account_, address transientRoute_) {
        (address _account, address _transientRoute) =
            AccountLib.create(puppetAccountImpl, transientRouteImpl, address(attest), _params, _userDeploySig, _signerProof);
        account_ = PuppetAccount(payable(_account));
        transientRoute_ = _transientRoute;
        _logEvent("DeployPuppetAccount", abi.encode(_params, _account, _transientRoute));
    }

    function createMasterAccount(
        AccountLib.AccountInitParams calldata _params,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof
    ) external auth returns (MasterAccount account_, address transientRoute_) {
        (address _account, address _transientRoute) =
            AccountLib.create(masterAccountImpl, transientRouteImpl, address(attest), _params, _userDeploySig, _signerProof);
        account_ = MasterAccount(payable(_account));
        transientRoute_ = _transientRoute;
        _logEvent("DeployMasterAccount", abi.encode(_params, _account, _transientRoute));
    }

    function dispatch(
        IAccount _account,
        IAccount.Call[] calldata _callList,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _nonce,
        IERC20 _baseToken,
        uint _amountIn,
        uint _amountOut,
        uint _relayFee,
        address _feeReceiver,
        uint _transferGasLimit
    ) external payable auth returns (uint signedPostBalance_, uint postBalance_, bytes[] memory results_) {
        NonceLib.consumeBy(_NONCE_SCOPE, _nonce, address(_account));

        (signedPostBalance_, postBalance_, results_) = attest.execute{value: msg.value}(
            _account,
            _callList,
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _baseToken,
            _amountIn,
            _amountOut,
            _relayFee,
            _feeReceiver,
            _transferGasLimit
        );

        _logEvent(
            "AccountCall",
            abi.encode(
                block.chainid,
                address(_account),
                _nonce,
                address(_baseToken),
                _amountIn,
                _amountOut,
                _relayFee,
                _feeReceiver,
                signedPostBalance_,
                postBalance_
            )
        );
    }

    function dispatchMandate(
        IAccount _puppet,
        bytes32 _mandateDigest,
        bytes calldata _mandate,
        IAccount.Call[] calldata _callList,
        IERC20 _baseToken,
        uint _amountOut,
        uint _transferGasLimit
    ) external auth returns (uint signedPostBalance_, uint postBalance_, bytes[] memory results_) {
        (signedPostBalance_, postBalance_, results_) =
            attest.executeMandate(_puppet, _callList, _mandateDigest, _mandate, _baseToken, _amountOut, _transferGasLimit);
        _logEvent(
            "MandateCall",
            abi.encode(
                block.chainid,
                address(_puppet),
                _mandateDigest,
                address(_baseToken),
                _amountOut,
                signedPostBalance_,
                postBalance_
            )
        );
    }
}
