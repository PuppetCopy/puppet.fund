// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {FundStore} from "src/core/FundStore.sol";

contract MockWallet1271 {
    uint public mode;
    FundStore public store;
    address public master;
    address public account;

    function set(
        uint _mode,
        FundStore _store,
        address _master,
        address _account
    ) external {
        mode = _mode;
        store = _store;
        master = _master;
        account = _account;
    }

    function isValidSignature(
        bytes32,
        bytes calldata
    ) external view returns (bytes4) {
        if (mode == 1) return 0xffffffff;
        if (mode == 2) {
            uint _burn;
            while (gasleft() > 0) {
                ++_burn;
            }
        }
        if (mode == 3 && store.getHolding(master, account).allocatedAt == block.timestamp) return 0xffffffff;
        return 0x1626ba7e;
    }
}
