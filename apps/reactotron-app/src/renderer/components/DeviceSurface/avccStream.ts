export type AvccChunk = {
  type: "description" | "keyframe" | "delta" | "seed"
  payload: Uint8Array
}

const CHUNK_TYPES: Record<number, AvccChunk["type"] | undefined> = {
  1: "description",
  2: "keyframe",
  3: "delta",
  4: "seed",
}

/** Parse serve-sim's length-prefixed AVCC stream using reusable storage. */
export class AvccStreamParser {
  private buffer = new Uint8Array(64 * 1024)
  private length = 0

  push(bytes: Uint8Array): AvccChunk[] {
    if (this.length + bytes.length > this.buffer.length) {
      let capacity = this.buffer.length
      while (capacity < this.length + bytes.length) capacity *= 2
      const grown = new Uint8Array(capacity)
      grown.set(this.buffer.subarray(0, this.length))
      this.buffer = grown
    }
    this.buffer.set(bytes, this.length)
    this.length += bytes.length

    const chunks: AvccChunk[] = []
    let offset = 0
    while (this.length - offset >= 4) {
      const frameLength = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset + offset,
        4
      ).getUint32(0, false)
      if (this.length - offset - 4 < frameLength) break
      if (frameLength >= 1) {
        const type = CHUNK_TYPES[this.buffer[offset + 4]]
        if (type) {
          // The buffer is compacted below, so decoded chunks must own their bytes.
          chunks.push({
            type,
            payload: this.buffer.slice(offset + 5, offset + 4 + frameLength),
          })
        }
      }
      offset += 4 + frameLength
    }

    if (offset > 0) {
      this.buffer.copyWithin(0, offset, this.length)
      this.length -= offset
    }
    return chunks
  }
}

/** Build the WebCodecs codec identifier from an AVCDecoderConfigurationRecord. */
export function avcCodecString(description: Uint8Array) {
  if (description.length < 4) return "avc1.42E01E"
  const hex = (byte: number) => byte.toString(16).padStart(2, "0")
  return `avc1.${hex(description[1])}${hex(description[2])}${hex(description[3])}`
}
