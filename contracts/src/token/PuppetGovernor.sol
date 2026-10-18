// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorTimelockControl} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {
    GovernorVotesQuorumFraction
} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

contract PuppetGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    constructor(
        IVotes _token,
        TimelockController _timelock,
        uint48 _votingDelay,
        uint32 _votingPeriod,
        uint _proposalThreshold,
        uint _quorumNumerator
    )
        Governor("Puppet")
        GovernorSettings(_votingDelay, _votingPeriod, _proposalThreshold)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(_quorumNumerator)
        GovernorTimelockControl(_timelock)
    {}

    function state(
        uint _proposalId
    ) public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
        return super.state(_proposalId);
    }

    function proposalNeedsQueuing(
        uint _proposalId
    ) public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.proposalNeedsQueuing(_proposalId);
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint) {
        return super.proposalThreshold();
    }

    function _voteSucceeded(
        uint _proposalId
    ) internal view override(Governor, GovernorCountingSimple) returns (bool) {
        (uint _against, uint _for,) = proposalVotes(_proposalId);
        return _for > 0 && _for * 3 >= (_for + _against) * 2;
    }

    function _queueOperations(
        uint _proposalId,
        address[] memory _targets,
        uint[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(_proposalId, _targets, _values, _calldatas, _descriptionHash);
    }

    function _executeOperations(
        uint _proposalId,
        address[] memory _targets,
        uint[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(_proposalId, _targets, _values, _calldatas, _descriptionHash);
    }

    function _cancel(
        address[] memory _targets,
        uint[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint) {
        return super._cancel(_targets, _values, _calldatas, _descriptionHash);
    }

    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }
}
