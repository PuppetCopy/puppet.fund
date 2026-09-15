const WC_URI = /^wc:[0-9a-f]{64}@2\?(?=.*symKey=[0-9a-f]{64})(?=.*relay-protocol=)/i

export const isWcLink = (uri: string): boolean => WC_URI.test(uri)

export function wcUriFromLocation(): string | null {
  if (typeof location === 'undefined') return null
  const params = new URLSearchParams(location.search)
  const encoded = params.get('uri') ?? params.get('wc')
  if (encoded && isWcLink(encoded)) return encoded
  const raw = location.href.match(/[?&](?:uri|wc)=(wc:[^#]+)/i)?.[1]
  return raw && isWcLink(raw) ? raw : null
}
