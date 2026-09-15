// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Test} from "forge-std/src/Test.sol";

import {Chain as ChainProxy} from "src/core/Chain.sol";
import {Dictate} from "src/core/Dictate.sol";
import {EvmChain} from "src/core/EvmChain.sol";
import {Error} from "src/utils/Error.sol";
import {IChain} from "src/utils/interfaces/IChain.sol";

contract ChainTest is Test {
    address owner = makeAddr("Owner");
    Dictate dictate;
    ChainProxy chain;

    function setUp() public {
        vm.startPrank(owner);
        dictate = new Dictate(owner);
        chain = new ChainProxy(address(dictate));
        vm.stopPrank();
    }

    function test_forwardsBlockNumberOnceSetAndLocks() public {
        address impl = address(new EvmChain());
        address other = address(new EvmChain());

        vm.expectRevert(Error.Chain__NotSet.selector);
        IChain(address(chain)).blockNumber();

        vm.expectRevert(Error.Access__Unauthorized.selector);
        chain.setImplementation(impl);

        vm.startPrank(owner);
        dictate.setAccess(chain, owner);
        chain.setImplementation(impl);
        assertEq(chain.implementation(), impl);

        vm.expectRevert(Error.Chain__Locked.selector);
        chain.setImplementation(other);
        vm.stopPrank();

        vm.roll(4242);
        assertEq(IChain(address(chain)).blockNumber(), 4242);
    }
}
