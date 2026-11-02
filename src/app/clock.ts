import { useSyncExternalStore } from "react"

let currentTime = Date.now()
let interval: number | undefined
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (interval === undefined) {
    interval = window.setInterval(() => {
      currentTime = Date.now()
      listeners.forEach((notify) => notify())
    }, 1_000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && interval !== undefined) {
      window.clearInterval(interval)
      interval = undefined
    }
  }
}

function getSnapshot() {
  return currentTime
}

export function useCurrentTime() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
