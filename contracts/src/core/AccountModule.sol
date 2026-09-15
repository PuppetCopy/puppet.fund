// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {ECDSA} from "solady/utils/ECDSA.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {IAccount} from "../utils/interfaces/IAccount.sol";
import {Account} from "./Account.sol";
import {DepositRoute} from "./DepositRoute.sol";
import {Access} from "../utils/auth/Access.sol";
import {Error} from "../utils/Error.sol";
import {AccountLib} from "../utils/AccountLib.sol";
import {IntentLib} from "../utils/IntentLib.sol";
import {IChain} from "../utils/interfaces/IChain.sol";

contract AccountModule is Access {
    event AccountCall(
        address indexed account,
        address indexed source,
        bytes32 digest,
        uint modulePrevBlock,
        uint accountPrevBlock,
        uint blockTimestamp,
        bytes signature,
        bytes executionData,
        IAccount.Call[] callList,
        bytes[] resultList
    );

    IChain public immutable chain;
    address public immutable accountImpl;
    bytes32 public immutable designatorHash;
    address public immutable routeImpl;
    uint public immutable resetPeriod;

    uint public lastAttestedAt;
    uint public lastCallBlock;
    mapping(address account => address user) internal userMap;
    mapping(address account => uint) public accountBlockMap;
    mapping(bytes32 digest => bool consumed) internal consumedMap;

    constructor(
        address _authority,
        IChain _chain,
        address _accountImpl,
        address _routeImpl,
        uint _resetPeriod
    ) Access(_authority) {
        if (address(_chain) == address(0)) revert Error.Chain__NotSet();
        if (_accountImpl == address(0) || _routeImpl == address(0)) revert Error.Account__InvalidImpl();
        if (_resetPeriod == 0) revert Error.Account__InvalidResetPeriod();
        chain = _chain;
        accountImpl = _accountImpl;
        designatorHash = keccak256(abi.encodePacked(hex"ef0100", _accountImpl));
        routeImpl = _routeImpl;
        resetPeriod = _resetPeriod;
        lastAttestedAt = block.timestamp;
    }

    function userOf(
        address _account
    ) public view returns (address) {
        if (_account.codehash != designatorHash) revert Error.Account__NotDelegated(_account);
        return userMap[_account];
    }

    function predictDepositRoute(
        address _user
    ) public view returns (address) {
        return LibClone.predictDeterministicAddress(
            routeImpl, abi.encodePacked(_user, address(this)), bytes32(0), address(this)
        );
    }

    uint constant MAX_SESSION_TTL = 30 days;

    function createAccount(
        address _account,
        address _user,
        address _signer,
        uint _expiry,
        bytes calldata _keySignature,
        bytes calldata _userSignature
    ) external auth {
        if (block.timestamp > _expiry) revert Error.Account__SessionExpired(_expiry, block.timestamp);
        if (_expiry > block.timestamp + MAX_SESSION_TTL) revert Error.Account__SessionTooLong(_expiry, MAX_SESSION_TTL);
        if (_user == address(0) || _signer == address(0)) revert Error.Account__InvalidUser();
        if (_account.codehash != designatorHash) revert Error.Account__NotDelegated(_account);
        if (
            ECDSA.tryRecoverCalldata(AccountLib.sessionDigest(address(this), _user, _signer, _expiry), _userSignature)
                != _user
        ) {
            revert Error.Account__InvalidSignature();
        }
        userMap[_account] = _user;
        LibClone.cloneDeterministic(routeImpl, abi.encodePacked(_user, address(this)), bytes32(0));
        bytes32 _digest = Account(payable(_account)).genesis(_user, _signer, _keySignature);
        _emit(
            _account,
            _digest,
            _keySignature,
            abi.encode(this.createAccount.selector, _user, _signer),
            new IAccount.Call[](0),
            new bytes[](0)
        );
    }

    function dispatch(
        IAccount _account,
        address _attestor,
        bytes32 _digest,
        bytes calldata _signature,
        bytes calldata _executionData,
        IAccount.Call[] calldata _callList
    ) external payable auth {
        lastAttestedAt = block.timestamp;
        bytes[] memory _resultList = _account.execute{value: msg.value}(_attestor, _digest, _signature, _callList);
        _emit(address(_account), _digest, _signature, _executionData, _callList, _resultList);
    }

    function forcedWithdrawal(
        address _account,
        address _token,
        uint _amount,
        address _to
    ) external {
        address _user = userOf(_account);
        if (_user != msg.sender) revert Error.Account__UnauthorizedCaller();
        uint _quietSince = lastAttestedAt + resetPeriod;
        if (block.timestamp < _quietSince) revert Error.Account__AttestorAlive(_quietSince);
        (IAccount.Call[] memory _callList, bytes[] memory _resultList) =
            Account(payable(_account)).forcedWithdrawal(predictDepositRoute(_user), _token, _amount, _to);
        _emit(
            _account,
            bytes32(0),
            "",
            abi.encode(this.forcedWithdrawal.selector, _token, _amount, _to),
            _callList,
            _resultList
        );
    }

    function record(address _account, bytes32 _digest, bytes calldata _executionData) external auth {
        _emit(_account, _digest, "", _executionData, new IAccount.Call[](0), new bytes[](0));
    }

    function markConsumed(
        bytes32 _digest
    ) external auth {
        if (consumedMap[_digest]) revert Error.Account__DigestConsumed(_digest);
        consumedMap[_digest] = true;
    }

    function _emit(
        address _account,
        bytes32 _digest,
        bytes memory _signature,
        bytes memory _executionData,
        IAccount.Call[] memory _callList,
        bytes[] memory _resultList
    ) internal {
        uint _block = chain.blockNumber();
        uint _modulePrevBlock = lastCallBlock;
        uint _accountPrevBlock = accountBlockMap[_account];
        lastCallBlock = _block;
        accountBlockMap[_account] = _block;

        emit AccountCall(
            _account,
            msg.sender,
            _digest,
            _modulePrevBlock,
            _accountPrevBlock,
            block.timestamp,
            _signature,
            _executionData,
            _callList,
            _resultList
        );
    }
}
