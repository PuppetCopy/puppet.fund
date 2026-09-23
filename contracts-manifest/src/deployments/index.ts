import dictateAbi from '../abi/puppetDictate.js'
import registerAbi from '../abi/puppetRegister.js'
import accountmoduleAbi from '../abi/puppetAccountModule.js'
import chainAbi from '../abi/puppetChain.js'
import depositAbi from '../abi/puppetDeposit.js'
import spokegateAbi from '../abi/puppetSpokeGate.js'
import useraccountAbi from '../abi/puppetUserAccount.js'
import fundaccountAbi from '../abi/puppetFundAccount.js'
import escrowstoreAbi from '../abi/puppetEscrowStore.js'
import mandatestoreAbi from '../abi/puppetMandateStore.js'
import hubgateAbi from '../abi/puppetHubGate.js'
import fundstoreAbi from '../abi/puppetFundStore.js'
import fundAbi from '../abi/puppetFund.js'
import shareAbi from '../abi/puppetShare.js'

export default {
  'Dictate:42161': { address: '0x870E29Fa6a63371e7e95E0B421a7A362fBCca6d8', block: 507470007, abi: dictateAbi },
  'Dictate:10': { address: '0x870E29Fa6a63371e7e95E0B421a7A362fBCca6d8', block: 157200950, abi: dictateAbi },
  'Register:42161': { address: '0xF0CfD1c49E6D47556628776a750Bf92Dd135a1E8', block: 507470011, abi: registerAbi },
  'Register:10': { address: '0xF0CfD1c49E6D47556628776a750Bf92Dd135a1E8', block: 157200951, abi: registerAbi },
  'AccountModule:42161': { address: '0x2067602390B94685968038a2F4289778AA2F4607', block: 507470025, abi: accountmoduleAbi },
  'AccountModule:10': { address: '0x2067602390B94685968038a2F4289778AA2F4607', block: 157200955, abi: accountmoduleAbi },
  'Chain:42161': { address: '0x3351b6446c1fddB86918b4284ef9Be4A1fd9955a', block: 507470015, abi: chainAbi },
  'Chain:10': { address: '0x3351b6446c1fddB86918b4284ef9Be4A1fd9955a', block: 157200952, abi: chainAbi },
  'ChainImpl:42161': { address: '0x92bA65a2570C59F62CD9ceA825FC382E0122ce12', block: 507470042, abi: chainAbi },
  'ChainImpl:10': { address: '0x964653f84C774e7a33fC0Ddf20C58aaee9ef1a9a', block: 157200963, abi: chainAbi },
  'Deposit:42161': { address: '0xE6E5cE82314d0cc00cd071Ad3bbB1411B87DCEEb', block: 507470054, abi: depositAbi },
  'Deposit:10': { address: '0xE6E5cE82314d0cc00cd071Ad3bbB1411B87DCEEb', block: 157200967, abi: depositAbi },
  'SpokeGateImpl:42161': { address: '0xDdC1B07fcd7Bf0d2FfF70CA4E934450993E1a105', block: 507470036, abi: spokegateAbi },
  'SpokeGate:42161': { address: '0xB3748B40B3FD7746067835240237f32048d584C5', block: 507470056, abi: spokegateAbi },
  'DepositImpl:42161': { address: '0x393A2718A4846D3ba1d8B937399f3e5fe08244e3', block: 507470029, abi: depositAbi },
  'DepositImpl:10': { address: '0xd71b8e0a02cBFA0c87a7F1bD3a8bcd88AB8E8b51', block: 157200956, abi: depositAbi },
  'UserAccount:42161': { address: '0xDceF10C8c6325E3Fa767Fef0E204DaCBc4029fF0', block: 507470018, abi: useraccountAbi },
  'UserAccount:10': { address: '0xDceF10C8c6325E3Fa767Fef0E204DaCBc4029fF0', block: 157200953, abi: useraccountAbi },
  'FundAccount:42161': { address: '0xE1921fB0A25051E6EEbaEE8F9a2AdbB50aAf955D', block: 507470022, abi: fundaccountAbi },
  'FundAccount:10': { address: '0xE1921fB0A25051E6EEbaEE8F9a2AdbB50aAf955D', block: 157200954, abi: fundaccountAbi },
  'EscrowStore:42161': { address: '0xd46Dc3875E69E873fc158a8456A6471Eef91e567', block: 507470033, abi: escrowstoreAbi },
  'EscrowStore:10': { address: '0xd46Dc3875E69E873fc158a8456A6471Eef91e567', block: 157200959, abi: escrowstoreAbi }
} as const

export const hub = {
  'MandateStore': { address: '0xF2DCC68894124e475A7182a0FfD7c764399E5bD8', block: 157200957, abi: mandatestoreAbi },
  'HubGateImpl': { address: '0x23e05d56E0a26b582968E9Bb2D3b3d85CbF85e2B', block: 157200962, abi: hubgateAbi },
  'HubGate': { address: '0x69c7449857043030ed33Af2764c62164843811af', block: 157200968, abi: hubgateAbi },
  'FundStore': { address: '0xA0C49dBc61bbe9aDB06Ea7722D944EdB6835cad1', block: 157200958, abi: fundstoreAbi },
  'FundImpl': { address: '0x062880f1954DB691ac03bEbba888946dbb961880', block: 157200961, abi: fundAbi },
  'Fund': { address: '0x97e319F22792A99C8530DdA67c9eE1A928C5921B', block: 157200974, abi: fundAbi },
  'Share': { address: '0x36aD9d8104eC5748E021634d6C384d10896551B3', block: 157200960, abi: shareAbi }
} as const
