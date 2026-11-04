import { useCallback, useSyncExternalStore } from "react"
import type { InvokeArgs } from "@tauri-apps/api/core"

import { nativeStore } from "./native-store"

export type NativeCommand = <T = void>(
  name: string,
  args?: InvokeArgs
) => Promise<T>

export function useNativeCommand() {
  return useCallback(
    <T>(name: string, args?: InvokeArgs) => nativeStore.command<T>(name, args),
    []
  )
}

export function useNativeState() {
  const state = useSyncExternalStore(
    nativeStore.subscribe,
    nativeStore.getSnapshot
  )
  const command = useNativeCommand()
  return {
    ...state,
    command,
    refresh: () => nativeStore.refresh(),
    clearRequestedDashboardTab: nativeStore.clearRequestedDashboardTab,
    clearError: () => nativeStore.clearError(),
  }
}

export type NativeState = ReturnType<typeof useNativeState>
