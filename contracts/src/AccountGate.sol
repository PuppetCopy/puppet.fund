// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseGate} from "./utils/BaseGate.sol";
import {CallLib} from "./utils/CallLib.sol";
import {Error} from "./utils/Error.sol";
import {IntentLib} from "./utils/IntentLib.sol";
import {AccountLib} from "./core/AccountLib.sol";
import {IAuthority} from "./utils/interfaces/IAuthority.sol";

import {AccountModule, CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH} from "./core/module/AccountModule.sol";
import {WalletDepositModule} from "./core/module/WalletDepositModule.sol";
import {RegisterModule} from "./core/module/RegisterModule.sol";
import {PuppetAccount} from "./core/PuppetAccount.sol";
import {IAccount} from "./core/interface/IAccount.sol";

bytes32 constant RECOGNIZE_INTENT_TYPEHASH = keccak256(
    "RecognizeIntent(AccountInitParams params,bytes32 tokenId,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,uint256 amount)AccountInitParams(address user,address signer)"
);

bytes32 constant BRIDGE_INTENT_TYPEHASH = keccak256(
    "BridgeIntent(AccountInitParams params,bytes32 tokenId,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,address provider,bytes providerCallData,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,uint32 expires,uint32 fillDeadline)AccountInitParams(address user,address signer)"
);

contract AccountGate is BaseGate, EIP712 {
    struct RecognizeIntent {
        AccountLib.AccountInitParams params;
        bytes32 tokenId;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        uint amount;
    }

    struct BridgeIntent {
        AccountLib.AccountInitParams params;
        bytes32 tokenId;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        address provider;
        bytes providerCallData;
        uint inputAmount;
        uint outputAmount;
        uint destinationChainId;
        uint32 expires;
        uint32 fillDeadline;
    }

    WalletDepositModule internal immutable walletDepositModule;
    uint internal immutable hubChainId;

    constructor(
        IAuthority _authority,
        AccountModule _accountModule,
        WalletDepositModule _walletDeposit,
        RegisterModule _register,
        uint _hubChainId,
        Config memory _config
    ) BaseGate(_authority, _accountModule, _register, _config) EIP712("AccountGate", "1") {
        if (address(_walletDeposit) == address(0)) revert Error.Gate__InvalidModule();
        walletDepositModule = _walletDeposit;
        hubChainId = _hubChainId;
    }

    function deposit(
        AccountLib.AccountInitParams calldata _params,
        bytes32 _tokenId,
        uint _amount
    ) external {
        address _account = accountModule.predictPuppetAccount(_params);
        IERC20 _token = IntentLib.verifyTokenAndCap(registerModule, _tokenId, address(0), _amount);
        walletDepositModule.deposit(msg.sender, accountModule.predictRoute(_account), _token, _amount, transferGasLimit);
    }

    function depositWnt(
        AccountLib.AccountInitParams calldata _params
    ) external payable {
        address _account = accountModule.predictPuppetAccount(_params);
        IntentLib.verifyTokenAndCap(registerModule, registerModule.wntBaseTokenId(), address(0), msg.value);
        walletDepositModule.depositWnt{value: msg.value}(
            msg.sender, accountModule.predictRoute(_account), registerModule.getWnt(), transferGasLimit
        );
    }

    function createPuppetAccount(
        AccountModule.CreatePuppetAccountIntent calldata _intent,
        bytes calldata _userDeploySig,
        bytes calldata _signerProof,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.initialDepositAmount, maxRelayFeeBps);
        IERC20 _token =
            IntentLib.verifyTokenAndCap(registerModule, _intent.tokenId, address(0), _intent.initialDepositAmount);

        (PuppetAccount _account, address _route) =
            accountModule.createPuppetAccount(_intent.params, _userDeploySig, _signerProof);

        accountModule.dispatch(
            _account,
            CallLib.withFee(
                CallLib.routeDeposit(_route, _token, address(_account), _intent.initialDepositAmount, transferGasLimit),
                _token,
                feeReceiver,
                _actualRelayFee,
                transferGasLimit
            ),
            CallLib.signTransfer(_intent.tokenId, _token, _intent.initialDepositAmount, _actualRelayFee),
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH,
                        AccountLib.hashAccount(_intent.params),
                        _intent.tokenId,
                        _intent.blockNumber,
                        _intent.deadline,
                        _intent.acceptableRelayFee,
                        _intent.nonce,
                        _intent.chainId,
                        _intent.initialDepositAmount
                    )
                )
            ),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );
    }

    function recognize(
        RecognizeIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.amount == 0) revert Error.Deposit__NothingToRecord();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IERC20 _token = IntentLib.verifyTokenAndCap(registerModule, _intent.tokenId, address(0), _intent.amount);

        PuppetAccount _account = accountModule.verifyPuppetAccount(_intent.params);
        address _route = accountModule.predictRoute(address(_account));
        IntentLib.verifyRelayFeeRatio(
            _actualRelayFee, _account.signedBalanceOf(_intent.tokenId) + _intent.amount, maxRelayFeeBps
        );

        uint _routeBalance = _token.balanceOf(_route);
        if (_routeBalance < _intent.amount) revert Error.Deposit__InsufficientBalance(_routeBalance, _intent.amount);

        accountModule.dispatch(
            IAccount(address(_account)),
            CallLib.withFee(
                CallLib.routeDeposit(_route, _token, address(_account), _intent.amount, transferGasLimit),
                _token,
                feeReceiver,
                _actualRelayFee,
                transferGasLimit
            ),
            CallLib.signTransfer(_intent.tokenId, _token, _intent.amount, _actualRelayFee),
            _hashRecognize(_intent),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );

        _logEvent("Recognize", abi.encode(_intent, address(_account)));
    }

    function bridge(
        BridgeIntent calldata _intent,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        uint _actualRelayFee
    ) external {
        if (_intent.inputAmount == 0) revert Error.Deposit__NothingToBridge();
        IntentLib.verifyChainId(_intent.chainId);
        IntentLib.verifyTimeBounds(_intent.blockNumber, _intent.deadline, _blockNumber(), maxBlockDelay);
        IntentLib.verifyRelayFee(_actualRelayFee, _intent.acceptableRelayFee);
        IntentLib.verifyRelayFeeRatio(_actualRelayFee, _intent.inputAmount, maxRelayFeeBps);
        IERC20 _token = IntentLib.verifyTokenAndCap(registerModule, _intent.tokenId, address(0), _intent.inputAmount);

        if (_intent.destinationChainId != hubChainId) {
            revert Error.Deposit__InvalidDestinationChain(hubChainId, _intent.destinationChainId);
        }
        if (_intent.destinationChainId == block.chainid) {
            revert Error.Deposit__SameChainBridge(_intent.destinationChainId);
        }
        if (_intent.outputAmount == 0) revert Error.Deposit__ZeroBridgeOutput();
        if (_actualRelayFee >= _intent.inputAmount) revert Error.Deposit__RelayFeeTooHigh();

        PuppetAccount _account = accountModule.verifyPuppetAccount(_intent.params);
        address _route = accountModule.predictRoute(address(_account));
        uint _routeBalance = _token.balanceOf(_route);
        if (_routeBalance < _intent.inputAmount) {
            revert Error.Deposit__InsufficientBalance(_routeBalance, _intent.inputAmount);
        }

        uint _settler = _intent.inputAmount - _actualRelayFee;
        IAccount.Call[] memory _legs = new IAccount.Call[](_actualRelayFee > 0 ? 4 : 3);
        _legs[0] = CallLib.approveCall(_token, _intent.provider, _settler, transferGasLimit);
        _legs[1] = IAccount.Call({target: _intent.provider, value: 0, gasLimit: 0, callData: _intent.providerCallData});
        _legs[2] = CallLib.approveCall(_token, _intent.provider, 0, transferGasLimit);
        if (_actualRelayFee > 0) {
            _legs[3] = CallLib.transferCall(_token, feeReceiver, _actualRelayFee, transferGasLimit);
        }

        accountModule.dispatch(
            IAccount(address(_account)),
            CallLib.wrap(CallLib.routeExecute(_route, _legs)),
            CallLib.noTransfers(),
            _hashBridge(_intent),
            _userSignature,
            _attestorSignature,
            attestor,
            _intent.nonce
        );

        _logEvent("Bridge", abi.encode(_intent, address(_account)));
    }

    function _hashRecognize(
        RecognizeIntent calldata _intent
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECOGNIZE_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.tokenId,
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.amount
                )
            )
        );
    }

    function _hashBridge(
        BridgeIntent calldata _intent
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BRIDGE_INTENT_TYPEHASH,
                    AccountLib.hashAccount(_intent.params),
                    _intent.tokenId,
                    _intent.blockNumber,
                    _intent.deadline,
                    _intent.acceptableRelayFee,
                    _intent.nonce,
                    _intent.chainId,
                    _intent.provider,
                    keccak256(_intent.providerCallData),
                    _intent.inputAmount,
                    _intent.outputAmount,
                    _intent.destinationChainId,
                    _intent.expires,
                    _intent.fillDeadline
                )
            )
        );
    }
}
