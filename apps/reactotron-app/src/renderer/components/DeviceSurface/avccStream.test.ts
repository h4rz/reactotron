import { AvccStreamParser, avcCodecString } from "./avccStream"

function envelope(tag: number, payload: Uint8Array) {
  const bytes = new Uint8Array(5 + payload.length)
  new DataView(bytes.buffer).setUint32(0, payload.length + 1, false)
  bytes[4] = tag
  bytes.set(payload, 5)
  return bytes
}

describe("AvccStreamParser", () => {
  it("extracts envelopes split across network chunks", () => {
    const description = envelope(1, Uint8Array.of(1, 100, 0, 40))
    const keyframe = envelope(2, Uint8Array.of(5, 6, 7))
    const stream = new Uint8Array(description.length + keyframe.length)
    stream.set(description)
    stream.set(keyframe, description.length)
    const parser = new AvccStreamParser()
    const chunks = []

    for (let offset = 0; offset < stream.length; offset += 3) {
      chunks.push(...parser.push(stream.subarray(offset, offset + 3)))
    }

    expect(chunks.map(({ type, payload }) => [type, Array.from(payload)])).toEqual([
      ["description", [1, 100, 0, 40]],
      ["keyframe", [5, 6, 7]],
    ])
  })
})

describe("avcCodecString", () => {
  it("uses the profile, compatibility, and level bytes", () => {
    expect(avcCodecString(Uint8Array.of(1, 0x64, 0, 0x28))).toBe("avc1.640028")
  })
})
