// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Governor as GovernorBase} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorSuperQuorum} from "@openzeppelin/contracts/governance/extensions/GovernorSuperQuorum.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {
    GovernorVotesQuorumFraction
} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {
    GovernorVotesSuperQuorumFraction
} from "@openzeppelin/contracts/governance/extensions/GovernorVotesSuperQuorumFraction.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

contract Governor is
    GovernorBase,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorVotesSuperQuorumFraction
{
    constructor(
        IVotes _token,
        uint48 _votingDelay,
        uint32 _votingPeriod,
        uint _proposalThreshold,
        uint _quorum
    )
        GovernorBase("Puppet")
        GovernorSettings(_votingDelay, _votingPeriod, _proposalThreshold)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(_quorum)
        GovernorVotesSuperQuorumFraction(_quorum)
    {}

    function quorumDenominator() public pure override returns (uint) {
        return 100_000_000;
    }

    function proposalThreshold() public view override(GovernorBase, GovernorSettings) returns (uint) {
        return super.proposalThreshold();
    }

    function proposalVotes(
        uint _proposalId
    ) public view override(GovernorCountingSimple, GovernorSuperQuorum) returns (uint, uint, uint) {
        return super.proposalVotes(_proposalId);
    }

    function state(
        uint _proposalId
    ) public view override(GovernorBase, GovernorVotesSuperQuorumFraction) returns (ProposalState) {
        return super.state(_proposalId);
    }

    function _updateQuorumNumerator(
        uint _newQuorumNumerator
    ) internal override(GovernorVotesQuorumFraction, GovernorVotesSuperQuorumFraction) {
        super._updateQuorumNumerator(_newQuorumNumerator);
    }

    function _voteSucceeded(
        uint _proposalId
    ) internal view override(GovernorBase, GovernorCountingSimple) returns (bool) {
        (uint _against, uint _for,) = proposalVotes(_proposalId);
        return _for > 0 && _for * 3 >= (_for + _against) * 2;
    }
}
