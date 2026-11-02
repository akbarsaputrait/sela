import { afterEach, describe, expect, it, vi } from "vitest"

import { isWavFileName, playAlertSound } from "./sound"

afterEach(() => vi.unstubAllGlobals())

describe("alert sound playback", () => {
  it("accepts only WAV file names", () => {
    expect(isWavFileName("reminder.wav")).toBe(true)
    expect(isWavFileName("REMINDER.WAV")).toBe(true)
    expect(isWavFileName("reminder.mp3")).toBe(false)
    expect(isWavFileName("reminder.wav.mp3")).toBe(false)
  })
  it("loads the selected bundled WAV", async () => {
    const start = vi.fn()
    const decodeAudioData = vi.fn().mockResolvedValue({})
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    })
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal(
      "AudioContext",
      class {
        destination = {}
        resume = vi.fn().mockResolvedValue(undefined)
        close = vi.fn().mockResolvedValue(undefined)
        decodeAudioData = decodeAudioData
        createBufferSource() {
          return { buffer: null, connect: vi.fn(), onended: null, start }
        }
      }
    )
    const command = vi.fn()
    await playAlertSound("announce", null, command)
    expect(fetch).toHaveBeenCalledWith("/sounds/announce.wav")
    expect(decodeAudioData).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
    expect(command).not.toHaveBeenCalled()
  })

  it("loads custom WAV bytes by saved id", async () => {
    const decodeAudioData = vi.fn().mockResolvedValue({})
    vi.stubGlobal(
      "AudioContext",
      class {
        destination = {}
        resume = vi.fn().mockResolvedValue(undefined)
        close = vi.fn().mockResolvedValue(undefined)
        decodeAudioData = decodeAudioData
        createBufferSource() {
          return {
            buffer: null,
            connect: vi.fn(),
            onended: null,
            start: vi.fn(),
          }
        }
      }
    )
    const command = vi.fn().mockResolvedValue([1, 2, 3])
    await playAlertSound("custom", "test-id", command)
    expect(command).toHaveBeenCalledWith("get_custom_sound", { id: "test-id" })
    expect(new Uint8Array(decodeAudioData.mock.calls[0][0])).toEqual(
      new Uint8Array([1, 2, 3])
    )
  })
})
