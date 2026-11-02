# 001 — Remove Quick Add shortcut motion

- **Status**: DONE
- **Commit**: 672c074
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 1 source file

## Problem

The Quick Add capture window is opened by the global `CommandOrControl+Shift+Space` shortcut (`src-tauri/src/lib.rs:242`). Its form animates in and out on the same high-frequency keyboard path. A keyboard-initiated capture action should present immediately.

Current state and close behavior (`src/features/quick-add/quick-add.tsx:14-45`):

```tsx
const EXIT_MS = 180

export function QuickAdd({ command }: { command: NativeCommand }) {
  const [visible, setVisible] = React.useState(!isTauri())
  // ...
  const transitionTimer = React.useRef<number | null>(null)

  const close = React.useCallback(() => {
    if (!isTauri() || closing.current) return
    closing.current = true
    setVisible(false)
    transitionTimer.current = window.setTimeout(() => {
      transitionTimer.current = null
      void command("hide_capture")
        .catch((failure: Error) => setError(failure.message))
        .finally(() => {
          closing.current = false
        })
    }, EXIT_MS)
  }, [command])
```

The open listener sets `visible` true before focusing the input (`src/features/quick-add/quick-add.tsx:53-63`):

```tsx
listen("sela://capture-open", () => {
  if (transitionTimer.current !== null) {
    window.clearTimeout(transitionTimer.current)
    transitionTimer.current = null
  }
  closing.current = false
  setVisible(true)
  setError(null)
  setSaved(null)
  requestAnimationFrame(() => inputRef.current?.focus())
})
```

The form's transition moves it from above the window, scales it horizontally, and fades it (`src/features/quick-add/quick-add.tsx:195-196`):

```tsx
<form
  className={`flex min-h-14 origin-top items-center gap-2 rounded-b-2xl border border-t-0 bg-background px-3 shadow-lg transition duration-200 ${visible ? "translate-y-0 scale-x-100 opacity-100" : "-translate-y-full scale-x-50 opacity-0"}`}
```

The hint also fades with `visible` (`src/features/quick-add/quick-add.tsx:324-325`):

```tsx
<p
  className={`mx-auto mt-2 w-fit rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-opacity ${visible ? "opacity-100" : "opacity-0"}`}
```

## Target

Quick Add appears and hides immediately with the native Tauri window. Remove the `visible` React state and all slide, scale, and opacity transitions from this surface. Do not leave the 180ms post-close delay after removing the animation.

Keep the existing 650ms success-message pause before closing after a reminder is saved. Rename its timer ref to reflect that it owns the success-message delay, and preserve its cleanup when the window reopens and when the component unmounts.

## Repo conventions to follow

- Use the existing `hide_capture` command; do not change its Rust contract or Tauri window behavior.
- Keep `requestAnimationFrame(() => inputRef.current?.focus())` after the capture-open event so keyboard focus remains immediate.
- Preserve existing command error handling and the success message shown after saving.

## Steps

1. In `src/features/quick-add/quick-add.tsx`, remove `EXIT_MS`, the `visible` state, and its `setVisible` calls. The native window controls whether the capture surface is shown; in non-Tauri preview mode it should remain rendered as it is today.
2. Make `close` call `command("hide_capture")` immediately, retaining the `closing` guard, error handling, and `finally` reset. Remove the timeout that existed only to finish the exit animation.
3. Remove `origin-top`, `transition`, `duration-200`, and the conditional translate/scale/opacity classes from the form. Remove the hint's `transition-opacity` and conditional opacity classes.
4. Rename `transitionTimer` to a success-message timer name and preserve the existing 650ms delay after both regular and scheduled reminder saves. Keep clearing that timer on a new capture-open event and on effect cleanup.

## Boundaries

- Do not modify `src-tauri/src/lib.rs`, `src-tauri/src/windows.rs`, command names, keyboard shortcuts, reminder persistence, or scheduling.
- Do not change the 650ms success-message duration or input focus behavior.
- Do not add dependencies or replace the capture window with a web modal.

## Verification

- **Mechanical**: Run `bun run check`; formatting, lint, typecheck, tests, and both production builds must pass.
- **Feel check**: In the Tauri app, open Quick Add repeatedly with `CommandOrControl+Shift+Space` and confirm it appears/focuses immediately, without sliding or fading. Press Escape and confirm the native window hides immediately. Save regular and scheduled reminders and confirm the success message remains visible for its existing 650ms before closing.
- **Done when**: Quick Add has no entrance/exit movement or transition, close no longer waits 180ms for animation, and the save-feedback delay and keyboard/focus flows remain unchanged.
