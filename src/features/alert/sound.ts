import type { SoundChoice } from "@/app/native-store"

export function isWavFileName(name: string) {
  return /\.wav$/i.test(name)
}

const SOUND_PATHS: Record<Exclude<SoundChoice, "tone" | "custom">, string> = {
  remove: "/sounds/remove.wav",
  announce: "/sounds/announce.wav",
  back: "/sounds/back.wav",
}

export async function playAlertSound(
  choice: SoundChoice,
  customSoundId: string | null,
  command: <T>(name: string, args?: Record<string, unknown>) => Promise<T>
) {
  const context = new AudioContext()
  try {
    await context.resume()
    if (choice === "tone") {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = 660
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3)
      oscillator.connect(gain).connect(context.destination)
      oscillator.onended = () => void context.close().catch(() => {})
      oscillator.start()
      oscillator.stop(context.currentTime + 0.3)
      return
    }
    let bytes: ArrayBuffer
    if (choice === "custom") {
      if (!customSoundId) throw new Error("Upload a WAV file first.")
      const data = await command<number[]>("get_custom_sound", {
        id: customSoundId,
      })
      bytes = Uint8Array.from(data).buffer
    } else {
      const response = await fetch(SOUND_PATHS[choice])
      if (!response.ok) throw new Error("That sound could not be loaded.")
      bytes = await response.arrayBuffer()
    }
    const audio = await context.decodeAudioData(bytes)
    const source = context.createBufferSource()
    source.buffer = audio
    source.connect(context.destination)
    source.onended = () => void context.close().catch(() => {})
    source.start()
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  }
}
