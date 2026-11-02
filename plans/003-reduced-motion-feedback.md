# 003 — Preserve gentle reduced-motion feedback

- **Status**: DONE
- **Commit**: 672c074
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 2 CSS files

## Problem

Both app and website globally collapse every animation and transition to `0.01ms`, effectively removing all motion feedback rather than replacing spatial movement with a gentler equivalent.

App rule (`src/index.css:363-371`):

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

The website has the same blanket duration overrides (`website/src/styles.css:476-499`), despite also having per-animation handling for the hero word and decorative wave.

## Target

Keep scroll behavior immediate and suppress looping motion, but let entry/exit animations communicate state with a short opacity fade. Neutralize `tw-animate-css` translation, scale, and rotation variables under reduced motion; set `--tw-enter-opacity` and `--tw-exit-opacity` to `0`; use **150ms** and `cubic-bezier(0.23, 1, 0.32, 1)` for those fades. Disable accordion height keyframes under reduced motion instead of allowing layout movement. Remove the button's active translation and switch-thumb transform transition in this mode, while preserving color feedback.

For the website, preserve its existing reduced-motion handling for the rotating hero text and dot wave; make the large desktop-camera transform switch immediate; retain only the preview alert's opacity-only **150ms** exit; and remove the CTA's hover translation while keeping its background-color feedback.

## Repo conventions to follow

- Both CSS entry files already use `@media (prefers-reduced-motion: reduce)`.
- `tw-animate-css` drives modal, menu, select, tooltip, and alert entry/exit classes; use its `--tw-enter-*` and `--tw-exit-*` variables rather than adding animation dependencies.
- The landing preview's `.desktop-alert` already has a component-specific opacity-only fallback; retain it.

## Steps

1. In `src/index.css`, remove the global near-zero animation and transition durations while keeping `scroll-behavior: auto` and a single iteration for loops.
2. In the app reduced-motion block, target class names containing `animate-in`/`animate-out`: neutralize translate, scale, and rotation variables, force opacity endpoints, and set the animation to 150ms with the exact ease-out curve above. Disable `animate-accordion-down` and `animate-accordion-up` keyframes, button active translation, and switch-thumb transitions under reduced motion.
3. In `website/src/styles.css`, remove the global near-zero duration overrides while preserving the existing explicit dot-wave/word animation shutdown.
4. Under reduced motion, disable the desktop camera transform transition, remove the primary-link hover/active translate, and keep its background-color feedback. Keep `.desktop-alert` opacity-only as currently implemented.
5. Verify that normal-motion styles are unchanged and that reduced-motion style variants still produce the same content and controls.

## Boundaries

- Do not change normal-motion durations, paths, or easing.
- Do not alter content, control semantics, or page layouts.
- Do not remove opacity/color feedback where it communicates state.
- Do not add dependencies or globally disable animations/transitions.

## Verification

- **Mechanical**: Run `bun run check`; formatting, lint, typecheck, tests, and app/website builds must pass.
- **Feel check**: Emulate `prefers-reduced-motion: reduce` in DevTools on both app and landing page. Confirm modal/menu/alert entry remains an opacity-only 150ms fade, accordion height changes are immediate, and no camera/CTA movement occurs. Confirm normal-motion behavior remains unchanged.
- **Done when**: No global `0.01ms` animation/transition override remains; reduced-motion surfaces retain opacity/color feedback without directional movement.
