import governoraccountAbi from '../abi/puppetGovernorAccount.js'
import chainAbi from '../abi/puppetChain.js'
import useraccountAbi from '../abi/puppetUserAccount.js'
import fundaccountAbi from '../abi/puppetFundAccount.js'
import accountmoduleAbi from '../abi/puppetAccountModule.js'
import depositAbi from '../abi/puppetDeposit.js'
import mandatestoreAbi from '../abi/puppetMandateStore.js'
import fundstoreAbi from '../abi/puppetFundStore.js'
import escrowstoreAbi from '../abi/puppetEscrowStore.js'
import sharetokenAbi from '../abi/puppetShareToken.js'
import fundAbi from '../abi/puppetFund.js'
import redeemAbi from '../abi/puppetRedeem.js'
import hubgateAbi from '../abi/puppetHubGate.js'
import spokegateAbi from '../abi/puppetSpokeGate.js'

export default {
  'GovernorAccount:10': { address: '0xbf91AAf97505c116EfFee4A0bAE6320A3863b9C3', block: 158502890, abi: governoraccountAbi },
  'GovernorAccount:42161': { address: '0xbf91AAf97505c116EfFee4A0bAE6320A3863b9C3', block: 516985675, abi: governoraccountAbi },
  'GovernorAccount:137': { address: '0xbf91AAf97505c116EfFee4A0bAE6320A3863b9C3', block: 95932917, abi: governoraccountAbi },
  'GovernorAccount:4663': { address: '0xbf91AAf97505c116EfFee4A0bAE6320A3863b9C3', block: 94466750, abi: governoraccountAbi },
  'Chain:10': { address: '0x9dD64b4f85D2bd46563FAB4CDcfBFE56B19BfE2E', block: 158502891, abi: chainAbi },
  'Chain:42161': { address: '0x9dD64b4f85D2bd46563FAB4CDcfBFE56B19BfE2E', block: 516985679, abi: chainAbi },
  'Chain:137': { address: '0x9dD64b4f85D2bd46563FAB4CDcfBFE56B19BfE2E', block: 95932918, abi: chainAbi },
  'Chain:4663': { address: '0x9dD64b4f85D2bd46563FAB4CDcfBFE56B19BfE2E', block: 94466756, abi: chainAbi },
  'UserAccount:10': { address: '0xB0d6DEe4050E7708884440a84DC45Ac8e6950A3f', block: 158502892, abi: useraccountAbi },
  'UserAccount:42161': { address: '0xB0d6DEe4050E7708884440a84DC45Ac8e6950A3f', block: 516985681, abi: useraccountAbi },
  'UserAccount:137': { address: '0xB0d6DEe4050E7708884440a84DC45Ac8e6950A3f', block: 95932920, abi: useraccountAbi },
  'UserAccount:4663': { address: '0xB0d6DEe4050E7708884440a84DC45Ac8e6950A3f', block: 94466764, abi: useraccountAbi },
  'FundAccount:10': { address: '0x7fd09F46c3e44c20024B1AB4e4CDB26833AA6c70', block: 158502893, abi: fundaccountAbi },
  'FundAccount:42161': { address: '0x7fd09F46c3e44c20024B1AB4e4CDB26833AA6c70', block: 516985684, abi: fundaccountAbi },
  'FundAccount:137': { address: '0x7fd09F46c3e44c20024B1AB4e4CDB26833AA6c70', block: 95932922, abi: fundaccountAbi },
  'FundAccount:4663': { address: '0x7fd09F46c3e44c20024B1AB4e4CDB26833AA6c70', block: 94466770, abi: fundaccountAbi },
  'AccountModule:10': { address: '0x877aeeBe465f70f06BA1506d90F2f864a0A1b217', block: 158502894, abi: accountmoduleAbi },
  'AccountModule:42161': { address: '0x877aeeBe465f70f06BA1506d90F2f864a0A1b217', block: 516985688, abi: accountmoduleAbi },
  'AccountModule:137': { address: '0x877aeeBe465f70f06BA1506d90F2f864a0A1b217', block: 95932924, abi: accountmoduleAbi },
  'AccountModule:4663': { address: '0x877aeeBe465f70f06BA1506d90F2f864a0A1b217', block: 94466775, abi: accountmoduleAbi },
  'Deposit:10': { address: '0x09dD9728D5198f5f854dc7b33425E5a393Aeb0F9', block: 158502896, abi: depositAbi },
  'Deposit:42161': { address: '0x09dD9728D5198f5f854dc7b33425E5a393Aeb0F9', block: 516985696, abi: depositAbi },
  'Deposit:137': { address: '0x09dD9728D5198f5f854dc7b33425E5a393Aeb0F9', block: 95932926, abi: depositAbi },
  'Deposit:4663': { address: '0x09dD9728D5198f5f854dc7b33425E5a393Aeb0F9', block: 94466786, abi: depositAbi },
  'MandateStore:10': { address: '0xAda170371f64e48FE85C857a155ec58590C8DcE4', block: 158502898, abi: mandatestoreAbi },
  'FundStore:10': { address: '0x6D2108EEF0518c72fbbA1E160C8385631CF85bE7', block: 158502899, abi: fundstoreAbi },
  'EscrowStore:10': { address: '0xE1CBA5A687B4554047ee7355DDd47fD9872Cc807', block: 158502900, abi: escrowstoreAbi },
  'EscrowStore:42161': { address: '0xE1CBA5A687B4554047ee7355DDd47fD9872Cc807', block: 516985702, abi: escrowstoreAbi },
  'EscrowStore:137': { address: '0xE1CBA5A687B4554047ee7355DDd47fD9872Cc807', block: 95932929, abi: escrowstoreAbi },
  'EscrowStore:4663': { address: '0xE1CBA5A687B4554047ee7355DDd47fD9872Cc807', block: 94466800, abi: escrowstoreAbi },
  'ShareToken:10': { address: '0x8E2B7AFb391d642465c31f20eA7a0DAF52209404', block: 158502901, abi: sharetokenAbi },
  'Fund:10': { address: '0xbf47Da57c58FfCbf505d9E1976eF145f7aCe6b91', block: 158502903, abi: fundAbi },
  'Redeem:10': { address: '0xD33eF2A46EE040316Bc569c56Ba683114AB61E8f', block: 158502905, abi: redeemAbi },
  'HubGate:10': { address: '0x70D191De6c10b781E2ba133B0637A015DD53554E', block: 158502907, abi: hubgateAbi },
  'SpokeGate:42161': { address: '0xd38d7e278C18d7b33e8a9ca7cFce6e2A85fC4af6', block: 516985709, abi: spokegateAbi },
  'SpokeGate:137': { address: '0xd38d7e278C18d7b33e8a9ca7cFce6e2A85fC4af6', block: 95932932, abi: spokegateAbi },
  'SpokeGate:4663': { address: '0xd38d7e278C18d7b33e8a9ca7cFce6e2A85fC4af6', block: 94466810, abi: spokegateAbi }
} as const
