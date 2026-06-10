// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {SlotLib} from "./SlotLib.sol";

bytes32 constant MANDATE_TYPEHASH =
    keccak256("Mandate(address puppet,address fund,address baseToken,bytes32 bodyHash)");

library RuleLib {
    bytes32 internal constant SUBSCRIBE_RULE_TYPEHASH =
        keccak256("SubscribeRule(address fund,bytes body,bytes mandate)");

    struct Rule {
        address fund;
        bytes body;
        bytes mandate;
    }

    function hashRule(
        Rule calldata _rule
    ) internal pure returns (bytes32) {
        return
            keccak256(abi.encode(SUBSCRIBE_RULE_TYPEHASH, _rule.fund, keccak256(_rule.body), keccak256(_rule.mandate)));
    }

    function hashRules(
        Rule[] calldata _rules
    ) internal pure returns (bytes32) {
        uint _n = _rules.length;
        bytes32[] memory _hashes = new bytes32[](_n);
        for (uint _i; _i < _n; ++_i) {
            _hashes[_i] = hashRule(_rules[_i]);
        }
        return keccak256(abi.encodePacked(_hashes));
    }

    function mandate(
        bytes32 _routerDomainSeparator,
        address _puppet,
        address _fund,
        IERC20 _baseToken,
        bytes calldata _body
    ) internal pure returns (bytes32 bodyHash_, bytes32 digest_) {
        bodyHash_ = keccak256(_body);
        digest_ = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _routerDomainSeparator,
                keccak256(abi.encode(MANDATE_TYPEHASH, _puppet, _fund, address(_baseToken), bodyHash_))
            )
        );
    }

    function throttlePeriod(
        bytes calldata _body
    ) internal pure returns (uint) {
        return SlotLib.readUint(_body, 0);
    }

    function rateLimit(
        bytes calldata _body
    ) internal pure returns (uint) {
        return SlotLib.readUint(_body, 1);
    }
}
