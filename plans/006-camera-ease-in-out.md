# 006 — Use ease-in-out for the preview camera

- **Status**: DONE
- **Commit**: 672c074
- **Severity**: LOW
- **Category**: Easing & duration
- **Estimated scope**: 1 CSS declaration

## Problem

The landing playground moves a camera across the desktop scene when switching alert styles, but currently uses a strong ease-out curve (`website/src/styles.css:206-214`):

```css
.desktop-camera {
  transform-origin: 0 0;
  transform: translate(0, 0) scale(1);
  transition: transform 650ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

This is a large on-screen move between views, where the motion standard calls for ease-in-out rather than the enter/exit ease-out curve.

## Target

Keep the **650ms** explanatory camera travel duration and transform-only property, but change the curve to the exact ease-in-out curve `cubic-bezier(0.77, 0, 0.175, 1)`. The longer duration is retained because the camera moves and scales across the full explanatory scene; verify the feel rather than shortening it by guesswork.

## Repo conventions to follow

- `website/src/styles.css` owns the landing-page camera transform.
- The existing reduced-motion rule disables the camera transition; keep that behavior.
- Use the exact curve from the animation standards, not a similar hand-picked curve.

## Steps

1. Change only the `transition` easing on `.desktop-camera` in `website/src/styles.css` to `cubic-bezier(0.77, 0, 0.175, 1)`.
2. Leave the `transform-origin`, camera transforms, and 650ms duration unchanged.

## Boundaries

- Do not alter the fullscreen/notch/native camera positions or responsive container-query transforms.
- Do not add new animation tokens, libraries, or markup.

## Verification

- **Mechanical**: Run `bun run check`; formatting, lint, typecheck, tests, and both builds must pass.
- **Feel check**: On the landing page, switch among Full screen, From the notch, and macOS notification. Confirm the camera accelerates and decelerates smoothly without changing the frame endpoints. Toggle reduced motion and confirm the camera switches instantly.
- **Done when**: Only the camera curve changes; the move remains interruptible and the reduced-motion path remains instantaneous.
