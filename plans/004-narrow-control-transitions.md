# 004 — Narrow shared-control transitions

- **Status**: DONE
- **Commit**: 672c074
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 5 source files

## Problem

Five shared controls use `transition-all`, including high-traffic buttons and status badges. This allows unrelated properties to animate when styling changes and can include painted properties such as shadows or future layout changes.

Current declarations:

```tsx
// src/components/ui/button.tsx:6
"... transition-all ... active:not-aria-[haspopup]:translate-y-px ..."

// src/components/ui/badge.tsx:7
"... transition-all focus-visible:border-ring focus-visible:ring-[3px] ..."

// src/components/ui/accordion.tsx:35
"... transition-all ... hover:underline focus-visible:border-ring ..."

// src/components/ui/switch.tsx:16
"... transition-all ... data-checked:bg-primary data-unchecked:bg-input ..."

// src/components/ui/tabs.tsx:58
"... transition-all ... data-active:bg-background ..."
```

## Target

Name only the properties each control actually changes:

- Button: `background-color`, `border-color`, `color`, and the existing individual `translate` press feedback; use **150ms** with `cubic-bezier(0.23, 1, 0.32, 1)`.
- Badge, accordion trigger, switch root, and tabs trigger: `transition-colors` only.
- Keep the switch thumb's existing `transition-transform` and the tabs indicator's existing `transition-opacity` unchanged.

## Repo conventions to follow

- Use Tailwind utilities in the component class strings; no new stylesheet or dependency is needed.
- `src/components/ui/select.tsx` already uses `transition-colors` for its trigger.
- The website primary CTA already names its properties with `transition-[background-color,transform]` instead of using `transition-all`.

## Steps

1. Replace the Button's `transition-all` with `transition-[background-color,border-color,color,translate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]`.
2. Replace `transition-all` with `transition-colors` in Badge, AccordionTrigger, Switch root, and TabsTrigger.
3. Leave all existing state variants, active press movement, focus-visible rings, switch-thumb transform, and tabs indicator opacity unchanged.

## Boundaries

- Do not change markup, variants, button press direction, or focus behavior.
- Do not apply transition utilities to static children or unrelated component files.
- Do not animate layout or shadow properties.

## Verification

- **Mechanical**: Run `bun run check`; formatting, lint, typecheck, tests, and both production builds must pass.
- **Feel check**: In the app, rapidly press buttons, toggle switches, open the activity accordion, and change tabs. Confirm colors/press feedback remain responsive and focus rings still appear immediately. Verify no layout or shadow tween remains.
- **Done when**: No shared control class uses `transition-all`, and the button retains only the explicit color/border/translate transition.
