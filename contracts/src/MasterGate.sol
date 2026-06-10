// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseGate} from "./utils/BaseGate.sol";
import {CallLib} from "./utils/CallLib.sol";
import {IntentLib} from "./utils/IntentLib.sol";
import {AccountLib} from "./core/AccountLib.sol";
import {IAuthority} from "./utils/interfaces/IAuthority.sol";

import {AccountModule} from "./core/module/AccountModule.sol";
import {RegisterModule} from "./core/module/RegisterModule.sol";
import {FundAccount} from "./core/FundAccount.sol";
import {IAccount} from "./core/interface/IAccount.sol";

bytes32 constant OPERATE_INTENT_TYPEHASH = keccak256(
    "OperateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bytes32 callListHash,bytes32 transferListHash)AccountInitParams(address user,address signer)"
);

bytes32 constant CREATE_FUND_ACCOUNT_INTENT_TYPEHASH = keccak256(
    "CreateFundAccountIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,bytes32 tokenId,uint256 sweepAmount)AccountInitParams(address user,address signer)"
);

contract MasterGate is BaseGate, EIP712 {
    struct OperateIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        IAccount.Call[] callList;
        IAccount.SignTransfer[] transferList;
    }

    struct CreateFundAccountIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        bytes32 tokenId;
        uint sweepAmount;
    }

    constructor(
        IAuthority _authority,
        AccountModule _accountModule,
        RegisterModule _register,
        Config memory _config
    ) BaseGate(_authority, _accountModule, _register, _config) EIP712("MasterGate", "1") {}

    function createFundAccount(
        CreateFundAccountIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.sweepAmount, maxRelayFeeBps);
        IERC20 _token = IntentLib.verifyTokenAndCap(registerModule, _intent.tokenId, address(0), _intent.sweepAmount);

        (FundAccount _account, address _route) =
            accountModule.createFundAccount(address(accountModule.verifyPuppetAccount(_intent.params)));

        accountModule.dispatch(
            IAccount(address(_account)),
            CallLib.withFee(
                CallLib.routeDeposit(_route, _token, address(_account), _intent.sweepAmount, transferGasLimit),
                _token,
                feeReceiver,
                _actualRelayFee,
                transferGasLimit
            ),
            CallLib.noTransfers(),
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        CREATE_FUND_ACCOUNT_INTENT_TYPEHASH,
                        AccountLib.hashAccount(_intent.params),
                        _intent.blockNumber,
                        _intent.deadline,
                        _intent.acceptableRelayFee,
                        _intent.nonce,
                        _intent.chainId,
                        _intent.tokenId,
                        _intent.sweepAmount
                    )
                )
            ),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );
    }

    function operate(
        OperateIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external payable returns (bytes[] memory result_) {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);

        FundAccount _account =
            accountModule.verifyFundAccount(address(accountModule.verifyPuppetAccount(_intent.params)));

        (,, result_) = accountModule.dispatch{value: msg.value}(
            IAccount(address(_account)),
            _intent.callList,
            _intent.transferList,
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        OPERATE_INTENT_TYPEHASH,
                        AccountLib.hashAccount(_intent.params),
                        _intent.blockNumber,
                        _intent.deadline,
                        _intent.acceptableRelayFee,
                        _intent.nonce,
                        _intent.chainId,
                        keccak256(abi.encode(_intent.callList)),
                        keccak256(abi.encode(_intent.transferList))
                    )
                )
            ),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );

        _logEvent("Operate", abi.encode(_intent, address(_account), msg.sender, result_));
    }
}
