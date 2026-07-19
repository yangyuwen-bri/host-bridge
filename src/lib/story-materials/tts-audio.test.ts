import { describe, expect, it } from 'vitest'
import { mergeTtsWavBuffers } from './tts-audio'

function buildPcmWav(params: { sampleRate: number; pcmBytes: Buffer }): Buffer {
  const { sampleRate, pcmBytes } = params
  const wav = Buffer.alloc(44 + pcmBytes.length)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + pcmBytes.length, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(pcmBytes.length, 40)
  pcmBytes.copy(wav, 44)
  return wav
}

function corruptDataChunkSize(input: Buffer): Buffer {
  const output = Buffer.from(input)
  output.writeUInt32LE(0x7fffff00, 40)
  return output
}

function readChunk(buffer: Buffer, chunkId: string): { offset: number; size: number } | null {
  if (buffer.length < 12) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') return null
  let cursor = 12
  while (cursor + 8 <= buffer.length) {
    const id = buffer.toString('ascii', cursor, cursor + 4)
    const size = buffer.readUInt32LE(cursor + 4)
    const dataOffset = cursor + 8
    if (dataOffset + size > buffer.length) return null
    if (id === chunkId) return { offset: dataOffset, size }
    cursor = dataOffset + size + (size % 2)
  }
  return null
}

describe('mergeTtsWavBuffers', () => {
  it('normalizes a single malformed vc wav chunk into a valid wav file', () => {
    const source = buildPcmWav({
      sampleRate: 16_000,
      pcmBytes: Buffer.alloc(320, 1),
    })
    const malformed = corruptDataChunkSize(source)

    const merged = mergeTtsWavBuffers([malformed])
    const dataChunk = readChunk(merged, 'data')
    const fmtChunk = readChunk(merged, 'fmt ')

    expect(merged.toString('ascii', 0, 4)).toBe('RIFF')
    expect(merged.toString('ascii', 8, 12)).toBe('WAVE')
    expect(fmtChunk?.size).toBe(16)
    expect(dataChunk?.size).toBe(320)
    expect(merged.readUInt32LE(24)).toBe(16_000)
  })

  it('merges multiple malformed vc wav chunks into one valid wav file', () => {
    const first = corruptDataChunkSize(buildPcmWav({
      sampleRate: 16_000,
      pcmBytes: Buffer.alloc(320, 1),
    }))
    const second = corruptDataChunkSize(buildPcmWav({
      sampleRate: 16_000,
      pcmBytes: Buffer.alloc(160, 2),
    }))

    const merged = mergeTtsWavBuffers([first, second])
    const dataChunk = readChunk(merged, 'data')

    expect(merged.toString('ascii', 0, 4)).toBe('RIFF')
    expect(merged.toString('ascii', 8, 12)).toBe('WAVE')
    expect(dataChunk?.size).toBe(480)
    expect(merged.readUInt32LE(24)).toBe(16_000)
  })
})
