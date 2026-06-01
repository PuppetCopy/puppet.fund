// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Dictate} from "src/core/Dictate.sol";
import {AccountModule} from "src/core/module/AccountModule.sol";

function grantGate(
    Dictate _dictate,
    AccountModule _gate,
    address _user
) {
    _dictate.setPermission(_gate, AccountModule.dispatch.selector, _user);
    _dictate.setPermission(_gate, AccountModule.dispatchMandate.selector, _user);
    _dictate.setPermission(_gate, AccountModule.createPuppetAccount.selector, _user);
    _dictate.setPermission(_gate, AccountModule.createMasterAccount.selector, _user);
}
