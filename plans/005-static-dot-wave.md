# 005 — Make the landing dot wave static

- **Status**: DONE
- **Commit**: 672c074
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 CSS file

## Problem

The landing hero continuously animates SVG `stroke-dashoffset` on two wide decorative paths (`website/src/styles.css:160-179`):

```css
.dot-wave-line {
  stroke: currentColor;
  stroke-dasharray: 0 14;
  stroke-linecap: round;
  stroke-width: 1.5;
  animation: dot-flow 18s linear infinite;
  vector-effect: non-scaling-stroke;
}

.dot-wave-line-secondary {
  opacity: 0.5;
  stroke-dasharray: 0 17;
  animation-duration: 24s;
  animation-direction: reverse;
}

@keyframes dot-flow {
  to {
    stroke-dashoffset: -56;
  }
}
```

This is perpetual decoration rather than state feedback, and `stroke-dashoffset` repaints instead of staying compositor-only.

## Target

Keep the SVG wave's current static appearance but remove its continuous motion. Preserve both paths, opacity, stroke styling, and reduced-motion support without keeping dead animation rules.

## Repo conventions to follow

- The landing page uses CSS animation only where the visual has an explanatory purpose; the alert playground's state changes use CSS transitions.
- Keep this as plain CSS; do not add an animation library.

## Steps

1. In `website/src/styles.css`, remove the `dot-flow` animation declarations from both wave paths.
2. Remove the now-unused `@keyframes dot-flow` block and the `.dot-wave-line` reduced-motion override, which becomes redundant.
3. Leave the SVG geometry and static dot-wave styling unchanged.

## Boundaries

- Do not remove the wave graphic itself or adjust its size, opacity, mask, or color.
- Do not change hero headline timing or the desktop preview camera.

## Verification

- **Mechanical**: Run `bun run check`; formatting, lint, typecheck, tests, and both production builds must pass.
- **Feel check**: Load the landing page and confirm the wave remains visible but no longer moves; check reduced-motion and normal preferences both leave it static.
- **Done when**: No `dot-flow` keyframes or `stroke-dashoffset` animation remains, and the static wave is visually unchanged.
