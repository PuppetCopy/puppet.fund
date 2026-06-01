export function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n
}
