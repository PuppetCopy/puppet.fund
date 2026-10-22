const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export const zipStored = (files: readonly { path: string; bytes: Uint8Array<ArrayBuffer> }[], at: Date): Blob => {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2)
  const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()
  const records: Uint8Array<ArrayBuffer>[] = []
  const directory: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const file of files) {
    const name = new TextEncoder().encode(file.path)
    const crc = crc32(file.bytes)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, file.bytes.length, true)
    local.setUint32(22, file.bytes.length, true)
    local.setUint16(26, name.length, true)
    records.push(new Uint8Array(local.buffer), name, file.bytes)
    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 0x0314, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(12, time, true)
    entry.setUint16(14, date, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, file.bytes.length, true)
    entry.setUint32(24, file.bytes.length, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(38, 0o100644 * 0x10000, true)
    entry.setUint32(42, offset, true)
    directory.push(new Uint8Array(entry.buffer), name)
    offset += 30 + name.length + file.bytes.length
  }
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, directory.reduce((size, part) => size + part.length, 0), true)
  end.setUint32(16, offset, true)
  return new Blob([...records, ...directory, new Uint8Array(end.buffer)], { type: 'application/zip' })
}
