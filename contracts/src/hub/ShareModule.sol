// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {LibClone} from "solady/utils/LibClone.sol";

import {ShareToken} from "./ShareToken.sol";
import {ShareLib} from "./ShareLib.sol";
import {AccountModule} from "../core/module/AccountModule.sol";
import {Error} from "../utils/Error.sol";
import {Access} from "../utils/auth/Access.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";

contract ShareModule is Access {
    AccountModule public immutable accountModule;
    address public immutable shareTokenImpl;

    constructor(
        IAuthority _authority,
        AccountModule _accountModule,
        address _shareTokenImpl
    ) Access(_authority) {
        if (address(_accountModule) == address(0) || _shareTokenImpl == address(0)) revert Error.Share__InvalidImpl();
        accountModule = _accountModule;
        shareTokenImpl = _shareTokenImpl;
    }

    function predictFund(
        ShareLib.ShareInitParams calldata _shareParams
    ) public view returns (address) {
        return accountModule.predictFundAccount(_shareParams.master);
    }

    function predict(
        ShareLib.ShareInitParams calldata _shareParams
    ) public view returns (address) {
        address _fund = predictFund(_shareParams);
        return LibClone.predictDeterministicAddress(
            shareTokenImpl, _cloneArgs(_fund, _shareParams), bytes32(uint(uint160(_fund))), address(this)
        );
    }

    function verifyShareToken(
        ShareLib.ShareInitParams calldata _shareParams
    ) external view returns (address shareToken_) {
        shareToken_ = predict(_shareParams);
        if (shareToken_.code.length == 0) revert Error.Share__NotCreated();
    }

    function createShareToken(
        ShareLib.ShareInitParams calldata _shareParams
    ) external auth {
        address _fund = predictFund(_shareParams);
        address _shareToken =
            LibClone.cloneDeterministic(shareTokenImpl, _cloneArgs(_fund, _shareParams), bytes32(uint(uint160(_fund))));
        _logEvent("CreateShareToken", abi.encode(_fund, _shareToken, _shareParams.baseTokenId, _shareParams.name));
    }

    function mint(
        ShareToken _shareToken,
        address _to,
        uint _amount
    ) external auth {
        _shareToken.mint(_to, _amount);
    }

    function mintMany(
        ShareToken _shareToken,
        address[] calldata _toList,
        uint[] calldata _amountList
    ) external auth {
        _shareToken.mintMany(_toList, _amountList);
    }

    function burn(
        ShareToken _shareToken,
        address _from,
        uint _amount
    ) external auth {
        _shareToken.burn(_from, _amount);
    }

    function transferFrom(
        ShareToken _shareToken,
        address _from,
        address _to,
        uint _amount
    ) external auth {
        _shareToken.transferFrom(_from, _to, _amount);
    }

    function _cloneArgs(
        address _fund,
        ShareLib.ShareInitParams calldata _shareParams
    ) internal view returns (bytes memory) {
        return abi.encodePacked(_fund, address(this), _shareParams.baseTokenId, _shareParams.name);
    }
}
