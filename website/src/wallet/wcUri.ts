const WC_URI = /^wc:[0-9a-f]{64}@2\?(?=.*symKey=[0-9a-f]{64})(?=.*relay-protocol=)/i

export const isWcLink = (uri: string): boolean => WC_URI.test(uri)

export const wcLinkOf = (text: string): string | null => {
  const trimmed = text.trim()
  if (isWcLink(trimmed)) return trimmed
  const encoded = trimmed.match(/[?&](?:uri|wc)=(wc%3A[^&#\s]+)/i)?.[1]
  if (encoded === undefined) return null
  try {
    const decoded = decodeURIComponent(encoded)
    return isWcLink(decoded) ? decoded : null
  } catch {
    return null
  }
}

export function wcUriFromLocation(): string | null {
  if (typeof location === 'undefined') return null
  const params = new URLSearchParams(location.search)
  const encoded = params.get('uri') ?? params.get('wc')
  if (encoded && isWcLink(encoded)) return encoded
  const raw = location.href.match(/[?&](?:uri|wc)=(wc:[^#]+)/i)?.[1]
  return raw && isWcLink(raw) ? raw : null
}
