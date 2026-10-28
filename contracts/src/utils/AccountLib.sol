// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

bytes32 constant INTENT_HEADER_TYPEHASH =
    keccak256("IntentHeader(address account,address user,uint256 nonce,uint256 deadline,address feeToken,uint256 fee)");

bytes32 constant GENESIS_TYPEHASH = keccak256("Genesis(address account,address parent)");
bytes32 constant SESSION_TYPEHASH = keccak256(
    "Session(string statement,address user,address signer,uint256 issuedAt,uint256 expiry,uint256 epoch,address fund)"
);
string constant SESSION_STATEMENT =
    "Authorize this signer to act for my https://puppet.fund account. If a fund is named below, it belongs to my account.\n\nVerify the website address.";

bytes32 constant DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
bytes32 constant INTENT_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)");
bytes32 constant CHAINLESS_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,address verifyingContract)");

uint constant MAX_SESSION_TTL = 30 days;
uint constant MAX_SESSION_BYTES = 480;
uint constant SESSION_REVOKE_DELAY = 10 minutes;
uint constant ESCROW_RETURN_DELAY = 1 days;
bytes32 constant CREDIT_TOTAL_TYPEHASH =
    keccak256("CreditTotal(address master,uint256 chainId,address token,uint256 total,uint256 feeTotal)");

library AccountLib {
    struct Genesis {
        address parent;
        bytes key;
        bytes approval;
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
                        DOMAIN_TYPEHASH,
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

    function intentDigest(
        address _account,
        uint _nonce,
        uint _deadline,
        bytes32 _structHash
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                hex"1901",
                keccak256(
                    abi.encode(
                        INTENT_DOMAIN_TYPEHASH,
                        keccak256("Puppet"),
                        keccak256("1"),
                        block.chainid,
                        _account,
                        bytes32((_deadline << 128) | _nonce)
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
        address _parent
    ) internal pure returns (bytes32) {
        return chainlessDigest(_module, keccak256(abi.encode(GENESIS_TYPEHASH, _account, _parent)));
    }

    function creditDigest(
        address _owner,
        address _master,
        uint _chainId,
        address _token,
        uint _total,
        uint _feeTotal
    ) internal pure returns (bytes32) {
        return chainlessDigest(
            _owner, keccak256(abi.encode(CREDIT_TOTAL_TYPEHASH, _master, _chainId, _token, _total, _feeTotal))
        );
    }

    function sessionDigest(
        address _module,
        address _user,
        address _signer,
        uint _issuedAt,
        uint _expiry,
        uint _epoch,
        address _fund
    ) internal pure returns (bytes32) {
        return chainlessDigest(
            _module,
            keccak256(
                abi.encode(
                    SESSION_TYPEHASH,
                    keccak256(bytes(SESSION_STATEMENT)),
                    _user,
                    _signer,
                    _issuedAt,
                    _expiry,
                    _epoch,
                    _fund
                )
            )
        );
    }
}
