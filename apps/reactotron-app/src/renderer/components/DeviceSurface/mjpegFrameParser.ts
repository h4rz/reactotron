export type MjpegFrameParser = {
  push: (chunk: Uint8Array) => void
}

const INITIAL_BUFFER_SIZE = 64 * 1024
const HEADER_WINDOW = 1024

/**
 * Incrementally parse an MJPEG response without rebuilding the accumulated
 * frame on every network chunk.
 */
export function createMjpegFrameParser(emit: (frame: Uint8Array) => void): MjpegFrameParser {
  let buffer = new Uint8Array(INITIAL_BUFFER_SIZE)
  let length = 0
  let start = 0
  let markerScanFrom = 0
  const decoder = new TextDecoder("latin1")

  const append = (chunk: Uint8Array) => {
    if (length + chunk.length > buffer.length) {
      if (start > 0) {
        buffer.copyWithin(0, start, length)
        length -= start
        start = 0
      }

      if (length + chunk.length > buffer.length) {
        let capacity = buffer.length
        while (capacity < length + chunk.length) capacity *= 2
        const grown = new Uint8Array(capacity)
        grown.set(buffer.subarray(0, length))
        buffer = grown
      }
    }

    buffer.set(chunk, length)
    length += chunk.length
  }

  const findHeaderEnd = (from: number) => {
    const end = Math.min(length - 4, from + HEADER_WINDOW)
    for (let index = from; index <= end; index += 1) {
      if (
        buffer[index] === 0x0d &&
        buffer[index + 1] === 0x0a &&
        buffer[index + 2] === 0x0d &&
        buffer[index + 3] === 0x0a
      ) {
        return index
      }
    }
    return -1
  }

  const readContentLength = (from: number, to: number) => {
    const match = /content-length:\s*(\d+)/i.exec(decoder.decode(buffer.subarray(from, to)))
    return match ? Number(match[1]) : null
  }

  const findJpeg = (from: number): { start: number; end: number } | null => {
    let jpegStart = -1
    for (let index = from; index < length - 1; index += 1) {
      if (buffer[index] === 0xff && buffer[index + 1] === 0xd8) {
        jpegStart = index
        break
      }
    }
    if (jpegStart === -1) return null

    for (let index = Math.max(jpegStart + 2, markerScanFrom); index < length - 1; index += 1) {
      if (buffer[index] === 0xff && buffer[index + 1] === 0xd9) {
        markerScanFrom = 0
        return { start: jpegStart, end: index + 2 }
      }
    }

    markerScanFrom = Math.max(jpegStart + 2, length - 1)
    return null
  }

  const drain = () => {
    while (start < length) {
      const headerEnd = findHeaderEnd(start)
      if (headerEnd >= 0) {
        const frameLength = readContentLength(start, headerEnd)
        if (frameLength != null && frameLength > 0) {
          const frameStart = headerEnd + 4
          const frameEnd = frameStart + frameLength
          if (length < frameEnd) break
          emit(buffer.subarray(frameStart, frameEnd))
          start = frameEnd
          continue
        }
      } else if (length - start <= HEADER_WINDOW) {
        break
      }

      const frame = findJpeg(start)
      if (!frame) break
      emit(buffer.subarray(frame.start, frame.end))
      start = frame.end
    }

    if (start > 0) {
      if (start < length) buffer.copyWithin(0, start, length)
      length -= start
      markerScanFrom = markerScanFrom > start ? markerScanFrom - start : 0
      start = 0
    }
  }

  return {
    push(chunk) {
      if (chunk.length === 0) return
      append(chunk)
      drain()
    },
  }
}
