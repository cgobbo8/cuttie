import { inflateRawSync } from 'node:zlib'

/** The files of a .zip, read back from its central directory */
export function unzip(archive: Buffer): Record<string, string> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = archive.readUInt16LE(end + 10)
  let at = archive.readUInt32LE(end + 16)
  const files: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    const packedSize = archive.readUInt32LE(at + 20)
    const nameLength = archive.readUInt16LE(at + 28)
    const offset = archive.readUInt32LE(at + 42)
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf-8')
    const localName = archive.readUInt16LE(offset + 26)
    const data = archive.subarray(offset + 30 + localName, offset + 30 + localName + packedSize)
    files[name] = inflateRawSync(data).toString('utf-8')
    at += 46 + nameLength
  }
  return files
}
