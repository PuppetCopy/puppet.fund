import dictateAbi from '../abi/puppetDictate.js'
import registerAbi from '../abi/puppetRegister.js'
import accountmoduleAbi from '../abi/puppetAccountModule.js'
import coregateAbi from '../abi/puppetCoreGate.js'
import chainAbi from '../abi/puppetChain.js'
import accountAbi from '../abi/puppetAccount.js'
import depositrouteAbi from '../abi/puppetDepositRoute.js'
import depositAbi from '../abi/puppetDeposit.js'
import hubgateAbi from '../abi/puppetHubGate.js'
import bondstoreAbi from '../abi/puppetBondStore.js'

export default {
  'Dictate:42161': { address: '0x08538b8108c61917463d3A820044F5ed28C67770', block: 505016439, abi: dictateAbi },
  'Dictate:143': { address: '0x08538b8108c61917463d3A820044F5ed28C67770', block: 104698102, abi: dictateAbi },
  'Register:42161': { address: '0xDBAD0f71AaE399f125b9c7412863FBd3787daC87', block: 505016443, abi: registerAbi },
  'Register:143': { address: '0xDBAD0f71AaE399f125b9c7412863FBd3787daC87', block: 104698103, abi: registerAbi },
  'AccountModule:42161': { address: '0xA49Fe604a5C8bCe5763b6A149c27Db7eF1A9B49B', block: 505016456, abi: accountmoduleAbi },
  'AccountModule:143': { address: '0xA49Fe604a5C8bCe5763b6A149c27Db7eF1A9B49B', block: 104698113, abi: accountmoduleAbi },
  'CoreGateImpl:42161': { address: '0xC889cD138344cDb5DE634fC1F3bC72Cc3b86bacf', block: 505016467, abi: coregateAbi },
  'CoreGateImpl:143': { address: '0x437536de70dC038d3C5c3Afe65bd74Eb9e5460f1', block: 104698115, abi: coregateAbi },
  'CoreGate:42161': { address: '0xB3A571a085F7b5d42552A0512Bb29006b4CC3E03', block: 505016491, abi: coregateAbi },
  'CoreGate:143': { address: '0xB3A571a085F7b5d42552A0512Bb29006b4CC3E03', block: 104698132, abi: coregateAbi },
  'Chain:42161': { address: '0xd9Cc54C025D653bA1b03981F83b8bd0A2B3701eD', block: 505016447, abi: chainAbi },
  'Chain:143': { address: '0xd9Cc54C025D653bA1b03981F83b8bd0A2B3701eD', block: 104698105, abi: chainAbi },
  'Account:42161': { address: '0x3982f64c2b38d99E5596A3a188aBcbB76A40E8fB', block: 505016450, abi: accountAbi },
  'Account:143': { address: '0x3982f64c2b38d99E5596A3a188aBcbB76A40E8fB', block: 104698111, abi: accountAbi },
  'DepositRoute:42161': { address: '0xa7CB7de35edf00Cfa082255f1f9243b0322f5289', block: 505016453, abi: depositrouteAbi },
  'DepositRoute:143': { address: '0xa7CB7de35edf00Cfa082255f1f9243b0322f5289', block: 104698112, abi: depositrouteAbi },
  'ChainImpl:42161': { address: '0x26a53C1165837207a8D75D6c011f70F1508e18de', block: 505016477, abi: chainAbi },
  'ChainImpl:143': { address: '0xA6a34542c973022e85B1637258c4c1C5895D1635', block: 104698124, abi: chainAbi },
  'Deposit:42161': { address: '0xEBa984bBEf3397A8CfEB67BbC1DC35649F83a79C', block: 505016464, abi: depositAbi },
  'Deposit:143': { address: '0x720BB35661b70818fE007e6716898Ac7978D143d', block: 104698114, abi: depositAbi }
} as const

export const hub = {
  'HubGateImpl': { address: '0x97a16d86D0BEaBD9A2E3C59b3807B249beb88b90', block: 104698123, abi: hubgateAbi },
  'HubGate': { address: '0x81F08bCe6d665153E777b4cB10a881852899f371', block: 104698149, abi: hubgateAbi },
  'BondStore': { address: '0x3fEe75B8F8327B1E0F11886BDaD35C0147B28638', block: 104698117, abi: bondstoreAbi }
} as const
