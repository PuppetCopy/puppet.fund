export const WC_STORAGE_PREFIX = 'wc/'

const wcKey = (key: string): string => WC_STORAGE_PREFIX + key

export const wcKeys = (): string[] => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(WC_STORAGE_PREFIX)) keys.push(key.slice(WC_STORAGE_PREFIX.length))
  }
  return keys
}

export const readWc = (key: string): unknown => {
  const raw = localStorage.getItem(wcKey(key))
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const sessionWrites = new Set<() => void>()

export const onSessionWrite = (listener: () => void): void => {
  sessionWrites.add(listener)
}

const announce = (key: string): void => {
  if (key.endsWith('//session')) for (const listener of sessionWrites) listener()
}

export const writeWc = (key: string, value: unknown): void => {
  localStorage.setItem(wcKey(key), JSON.stringify(value))
  announce(key)
}

export const wcRecordsOf = (store: string): unknown[] => {
  const key = wcKeys().find(each => each.endsWith(`//${store}`))
  const value = key === undefined ? undefined : readWc(key)
  return Array.isArray(value) ? value : []
}

export const wcStorage = {
  getKeys: async (): Promise<string[]> => wcKeys(),
  getEntries: async <T,>(): Promise<[string, T][]> => wcKeys().map(key => [key, readWc(key) as T]),
  getItem: async <T,>(key: string): Promise<T | undefined> => readWc(key) as T | undefined,
  setItem: async <T,>(key: string, value: T): Promise<void> => writeWc(key, value),
  removeItem: async (key: string): Promise<void> => {
    localStorage.removeItem(wcKey(key))
    announce(key)
  }
}

export const isOutboundSession = (session: { controller: string; self: { publicKey: string } }): boolean => session.controller !== session.self.publicKey

