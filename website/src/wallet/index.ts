export { bindSession, type IConnectedWallet } from './connectedWallet.js'
export {
  approveConnection,
  clearExtensionStorage,
  type IExtensionConnection,
  PUPPET_EXTENSION_INSTALL_URL,
  PUPPET_EXTENSION_RDNS,
  puppetActiveAccount,
  puppetConnectedOrigins,
  puppetExtensionInstalled,
  puppetExtensionOutdated,
  rejectConnection
} from './extension.js'
export {
  ensureSessionKey,
  getStoredSessionKey,
  type ISessionKey,
  lastStoredSession,
  revokeSessionKey
} from './sessionKey.js'
export { refreshWallet, setWallet, walletQuery } from './state.js'
export {
  connection,
  connectors,
  connectWallet,
  disconnect,
  homePublicClient,
  publicClientMap,
  WALLETCONNECT_PROJECT_ID,
  wagmi
} from './wallet.js'
