# 002 — Animate alert-preview dismissal

- **Status**: DONE
- **Commit**: 672c074
- **Severity**: MEDIUM
- **Category**: Missed opportunities
- **Estimated scope**: 3 source files

## Problem

The landing-page playground animates alerts into the simulated desktop, but removes them instantly when the visitor closes the preview. This breaks the spatial path shown by the entrance and makes the preview feel less like a real alert surface.

The parent updates `dismissed` immediately (`website/src/page.tsx:84-87, 122-127`):

```tsx
function AlertPlayground() {
  const [style, setStyle] = useState<AlertStyle>("fullscreen")
  const [dismissed, setDismissed] = useState(false)
  const [replay, setReplay] = useState(0)
  // ...
  <DesktopScene
    style={style}
    dismissed={dismissed}
    replay={replay}
    onDismiss={() => setDismissed(true)}
  />
}
```

The alert is unmounted as soon as `dismissed` becomes true (`website/src/desktop-scene.tsx:65-86`):

```tsx
{!dismissed && (
  <div
    key={`${style}-${replay}`}
    className={`desktop-alert desktop-alert-${style} ${style === "fullscreen" ? "animate-in duration-300 fade-in slide-in-from-bottom-2" : style === "notch" ? "animate-in duration-200 slide-in-from-top-full" : ""}`}
  >
    {/* alert preview */}
    <button type="button" className="desktop-dismiss" onClick={onDismiss}>
      Close preview
    </button>
  </div>
)}
```

The native-notification entrance travels from the right (`website/src/styles.css:406, 439-449`):

```css
.desktop-alert-native {
  animation: desktop-banner-enter 300ms ease-out both;
}

@keyframes desktop-banner-enter {
  from { opacity: 0; translate: 110% 0; }
  to { opacity: 1; translate: 0 0; }
}
```

## Target

Replace the preview alert's restart-from-zero entry keyframes with retargetable CSS transitions, then keep it mounted while it exits along the reverse entry path. A style change during dismissal must retarget to the newly selected preview rather than finish a stale exit.

Use `opacity` plus CSS individual `translate`, with the strong ease-out curve `cubic-bezier(0.23, 1, 0.32, 1)`. Preserve current entry durations (fullscreen/native **300ms**, notch **200ms**); use **200ms** for dismissal:

- Fullscreen starts at `translate: 0 8px` and exits to `translate: 0 8px` (entry currently uses `slide-in-from-bottom-2`).
- Notch starts at `translate: 0 -100%` and exits to `translate: 0 -100%` (entry currently uses `slide-in-from-top-full`).
- Native banner starts at `translate: 110% 0` and exits to `translate: 110% 0` (the current keyframe enters from the right by 110%).

Use `@starting-style` for entry and transitions for both directions. Under `prefers-reduced-motion: reduce`, remove directional translation and retain only an **opacity 150ms** transition. The current global 0.01ms reduced-motion rule has `!important`; give this component's reduced-motion rule sufficient specificity/importance to override it.

## Repo conventions to follow

- The landing preview already uses CSS for predetermined movement and a transform-only camera transition in `website/src/styles.css`.
- Keep the preview's existing `style` and `replay` behavior; selecting another style must immediately cancel an in-progress dismissal and replay the selected alert.
- Do not add a motion library or dependency.

## Steps

1. In `website/src/page.tsx`, distinguish “closing” from “dismissed”. A style selection resets both states and increments `replay`, canceling any stale exit.
2. In `website/src/desktop-scene.tsx`, keep the alert mounted while closing; set `data-closing` and call completion only for the alert's own opacity `transitionend` event.
3. In `website/src/styles.css`, replace the Tailwind `animate-in` classes and `desktop-banner-enter` keyframe with style-specific `@starting-style` entries and CSS transitions on `translate` and `opacity`. Keep current entry durations (300ms fullscreen/native, 200ms notch), use 200ms for exit, and reverse each entry vector.
4. Add the reduced-motion rule described above; use opacity-only 150ms feedback with no translation.

## Boundaries

- Do not change the native desktop app's alert animation or Quick Add behavior.
- Do not change alert-preview copy, style-tab semantics, ARIA labels/live-region content, or the camera transition.
- Do not add arbitrary delays to the style tabs; a new style selection must interrupt a pending close.

## Verification

- **Mechanical**: Run `bun run check`; formatting, lint, typecheck, tests, and both production builds must pass.
- **Feel check**: On the landing page, choose each of the three alert styles and close the preview. Confirm each exits through the same edge it entered (fullscreen down, notch up, native banner right), without a jump if the style is changed during the exit. Slow the transition to 10% in DevTools and inspect the exit path.
- **Accessibility**: Emulate `prefers-reduced-motion: reduce`; confirm all three exits fade without directional movement and still expose the updated “Preview closed” status.
- **Done when**: The alert stays mounted until its exit completes, style changes cancel a pending close, and reduced-motion users receive opacity-only feedback.
