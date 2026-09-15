// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

bytes32 constant INTENT_HEADER_TYPEHASH =
    keccak256("IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)");
bytes32 constant MANDATE_TYPEHASH = keccak256(
    "Mandate(address master,uint256 skin,uint256 allocationRate,uint256 cooldownPeriod,uint256 expiry,bytes32[] tokenIdList)"
);

bytes32 constant GENESIS_TYPEHASH = keccak256("Genesis(address account,address user,address signer)");
bytes32 constant SESSION_TYPEHASH =
    keccak256("Session(string statement,address user,address signer,uint256 expiry)");
string constant SESSION_STATEMENT =
    "Authorize this signer to act for my https://puppet.fund account.\n\nVerify the website address.";

bytes32 constant CHAINLESS_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,address verifyingContract)");

library AccountLib {
    struct Mandate {
        address master;
        uint skin;
        uint allocationRate;
        uint cooldownPeriod;
        uint expiry;
        bytes32[] tokenIdList;
    }

    struct Backing {
        address puppet;
        uint matchable;
        uint stake;
        Mandate mandate;
    }

    struct Genesis {
        address signer;
        uint expiry;
        bytes key;
        bytes user;
    }

    struct IntentHeader {
        address account;
        address user;
        uint nonce;
        uint deadline;
        address feeToken;
        uint fee;
    }

    function typedDigest(
        uint _chainId,
        address _account,
        bytes32 _structHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                hex"1901",
                keccak256(
                    abi.encode(
                        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                        keccak256("Puppet"),
                        keccak256("1"),
                        _chainId,
                        _account
                    )
                ),
                _structHash
            )
        );
    }

    function chainlessDigest(
        address _account,
        bytes32 _structHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                hex"1901",
                keccak256(abi.encode(CHAINLESS_DOMAIN_TYPEHASH, keccak256("Puppet"), keccak256("1"), _account)),
                _structHash
            )
        );
    }

    function mandateDigest(
        address _puppet,
        Mandate calldata _m
    ) internal pure returns (bytes32) {
        return chainlessDigest(
            _puppet,
            keccak256(
                abi.encode(
                    MANDATE_TYPEHASH,
                    _m.master,
                    _m.skin,
                    _m.allocationRate,
                    _m.cooldownPeriod,
                    _m.expiry,
                    keccak256(abi.encodePacked(_m.tokenIdList))
                )
            )
        );
    }

    function listsToken(
        Mandate calldata _m,
        bytes32 _tokenId
    ) internal pure returns (bool) {
        uint _len = _m.tokenIdList.length;
        for (uint _i; _i < _len; ++_i) {
            if (_m.tokenIdList[_i] == _tokenId) return true;
        }
        return false;
    }

    function hashHeader(
        IntentHeader calldata _h
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(INTENT_HEADER_TYPEHASH, _h.account, _h.user, _h.nonce, _h.deadline, _h.feeToken, _h.fee)
            );
    }

    function genesisDigest(
        address _module,
        address _account,
        address _user,
        address _signer
    ) internal pure returns (bytes32) {
        return chainlessDigest(_module, keccak256(abi.encode(GENESIS_TYPEHASH, _account, _user, _signer)));
    }

    function sessionDigest(
        address _module,
        address _user,
        address _signer,
        uint _expiry
    ) internal pure returns (bytes32) {
        return chainlessDigest(
            _module,
            keccak256(abi.encode(SESSION_TYPEHASH, keccak256(bytes(SESSION_STATEMENT)), _user, _signer, _expiry))
        );
    }
}
