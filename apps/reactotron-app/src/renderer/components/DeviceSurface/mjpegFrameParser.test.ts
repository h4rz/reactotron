import { createMjpegFrameParser } from "./mjpegFrameParser"
import { TextDecoder, TextEncoder } from "util"

Object.assign(globalThis, { TextDecoder, TextEncoder })

const encoder = new TextEncoder()

function part(payload: Uint8Array) {
  const header = encoder.encode(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${payload.length}\r\n\r\n`
  )
  const bytes = new Uint8Array(header.length + payload.length + 2)
  bytes.set(header)
  bytes.set(payload, header.length)
  bytes.set(encoder.encode("\r\n"), header.length + payload.length)
  return bytes
}

describe("createMjpegFrameParser", () => {
  it("extracts frames split across small network chunks", () => {
    const first = Uint8Array.of(0xff, 0xd8, 1, 2, 3, 0xff, 0xd9)
    const second = Uint8Array.of(0xff, 0xd8, 4, 5, 0xff, 0xd9)
    const stream = new Uint8Array(part(first).length + part(second).length)
    stream.set(part(first))
    stream.set(part(second), part(first).length)
    const frames: number[][] = []
    const parser = createMjpegFrameParser((frame) => frames.push(Array.from(frame)))

    for (let offset = 0; offset < stream.length; offset += 7) {
      parser.push(stream.subarray(offset, offset + 7))
    }

    expect(frames).toEqual([Array.from(first), Array.from(second)])
  })

  it("falls back to JPEG markers when multipart headers are missing", () => {
    const frame = Uint8Array.of(0xff, 0xd8, 9, 8, 7, 0xff, 0xd9)
    const frames: number[][] = []
    const parser = createMjpegFrameParser((jpeg) => frames.push(Array.from(jpeg)))

    parser.push(new Uint8Array(1100))
    parser.push(frame.subarray(0, 4))
    parser.push(frame.subarray(4))

    expect(frames).toEqual([Array.from(frame)])
  })
})
