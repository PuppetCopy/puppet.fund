// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IAccount} from "../utils/interfaces/IAccount.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {FundAccount} from "./FundAccount.sol";
import {UserAccount} from "./UserAccount.sol";
import {Access} from "../utils/auth/Access.sol";
import {Error} from "../utils/Error.sol";
import {AccountLib} from "../utils/AccountLib.sol";
import {IChain} from "../utils/interfaces/IChain.sol";
import {BalanceLib} from "../utils/BalanceLib.sol";

contract AccountModule is Access {
    event AccountCall(
        address indexed account,
        address indexed source,
        uint modulePrevBlock,
        uint accountPrevBlock,
        uint blockTimestamp,
        bytes32 digest,
        bytes signature,
        bytes executionData,
        IAccount.Call[] callList,
        bytes[] resultList,
        BalanceLib.Balance[] balanceList
    );

    IChain public immutable chain;
    address public immutable userImpl;
    address public immutable bodyImpl;
    bytes32 public immutable bodyHash;

    struct Tip {
        uint64 blockNumber;
        bytes24 digest;
    }

    uint public lastCallBlock;
    mapping(address account => Tip) public accountTipMap;

    constructor(
        address _authority,
        IChain _chain,
        address _userImpl,
        address _bodyImpl
    ) Access(_authority) {
        if (address(_chain) == address(0)) revert Error.Chain__NotSet();
        if (_userImpl == address(0) || _bodyImpl == address(0)) revert Error.Account__InvalidImpl();
        chain = _chain;
        userImpl = _userImpl;
        bodyImpl = _bodyImpl;
        bodyHash = keccak256(abi.encodePacked(hex"ef0100", _bodyImpl));
    }

    function predictUserAccount(
        address _user
    ) public view returns (address) {
        return LibClone.predictDeterministicAddress(
            userImpl, abi.encodePacked(address(this), _user), bytes32(0), address(this)
        );
    }

    function createUserAccount(
        address _user
    ) public returns (address account_) {
        if (_user == address(0)) revert Error.Account__InvalidUser();
        account_ = predictUserAccount(_user);
        if (account_.code.length == 0) {
            LibClone.cloneDeterministic(userImpl, abi.encodePacked(address(this), _user), bytes32(0));
            _emit(
                account_,
                bytes32(0),
                "",
                abi.encode(this.createUserAccount.selector, _user),
                new IAccount.Call[](0),
                new bytes[](0),
                new address[](0)
            );
        }
    }

    function createAccount(
        address _account,
        address _parent,
        bytes calldata _keySignature,
        bytes calldata _approval
    ) external auth {
        if (_account.codehash != bodyHash) revert Error.Account__NotDelegated(_account);
        address _user = UserAccount(payable(_parent)).user();
        if (_parent != predictUserAccount(_user)) revert Error.Account__InvalidUser();
        bytes32 _digest = FundAccount(payable(_account)).genesis(_parent, _keySignature);
        (address _signer, uint _issuedAt, uint _expiry, uint _epoch, bytes memory _grant) =
            abi.decode(_approval, (address, uint, uint, uint, bytes));
        if (
            !SignatureCheckerLib.isValidSignatureNow(
                _user, AccountLib.sessionDigest(address(this), _user, _signer, _issuedAt, _expiry, _epoch, _account), _grant
            )
        ) revert Error.Account__InvalidSignature();
        _emit(
            _account,
            _digest,
            _keySignature,
            abi.encode(this.createAccount.selector, _parent),
            new IAccount.Call[](0),
            new bytes[](0),
            new address[](0)
        );
    }

    function dispatch(
        IAccount _account,
        address _attestor,
        bytes32 _structHash,
        uint _deadline,
        bytes calldata _coSig,
        bytes calldata _executionData,
        IAccount.Call[] calldata _callList,
        address[] memory _tokenList
    ) external auth returns (bytes32 digest_) {
        bytes[] memory _resultList;
        (digest_, _resultList) = _account.execute(_attestor, _structHash, _deadline, _coSig, _callList);
        _emit(address(_account), digest_, _coSig, _executionData, _callList, _resultList, _tokenList);
    }

    function recordSelf(
        bytes calldata _executionData,
        address[] memory _tokenList
    ) external {
        if (msg.sender != predictUserAccount(UserAccount(payable(msg.sender)).user())) {
            revert Error.Account__UnauthorizedCaller();
        }
        _emit(msg.sender, bytes32(0), "", _executionData, new IAccount.Call[](0), new bytes[](0), _tokenList);
    }

    function record(
        address _account,
        bytes32 _digest,
        bytes calldata _executionData,
        address[] memory _tokenList
    ) external auth {
        _emit(_account, _digest, "", _executionData, new IAccount.Call[](0), new bytes[](0), _tokenList);
    }

    function _emit(
        address _account,
        bytes32 _digest,
        bytes memory _coSig,
        bytes memory _executionData,
        IAccount.Call[] memory _callList,
        bytes[] memory _resultList,
        address[] memory _tokenList
    ) internal {
        BalanceLib.Balance[] memory _balanceList = new BalanceLib.Balance[](_tokenList.length);
        for (uint _i; _i < _tokenList.length; ++_i) {
            _balanceList[_i] =
                BalanceLib.Balance({token: _tokenList[_i], amount: BalanceLib.balanceOf(_tokenList[_i], _account)});
        }
        uint _block = chain.blockNumber();
        Tip storage _tip = accountTipMap[_account];
        bytes memory _data = abi.encode(
            lastCallBlock,
            uint(_tip.blockNumber),
            block.timestamp,
            _digest,
            _coSig,
            _executionData,
            _callList,
            _resultList,
            _balanceList
        );
        lastCallBlock = _block;
        _tip.blockNumber = uint64(_block);
        _tip.digest = bytes24(keccak256(abi.encodePacked(_tip.digest, msg.sender, _data)));

        bytes32 _topic = AccountCall.selector;
        address _source = msg.sender;
        assembly ("memory-safe") {
            log3(add(_data, 0x20), mload(_data), _topic, shr(96, shl(96, _account)), _source)
        }
    }
}
