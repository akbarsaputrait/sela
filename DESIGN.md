# Sela interface direction

## Intent

A small macOS utility for getting reminders out of your head. The dashboard answers: what needs attention next, and how should Sela interrupt me? It is not a productivity dashboard or a marketing page.

## Scope of this pass

Redesign Activities, Settings, About, their shared horizontal navigation, and native menu-bar destinations. Preserve the quick-add/notch interaction, alert styles, onboarding, storage, and user preferences.

## Decisions

- **Color:** existing monochrome default, Follow System; optional saved themes stay intact. Do not add a new accent.
- **Typography:** system sans for macOS familiarity and compact legibility. Page headings 18–20px, body/labels 13–14px, auxiliary text 12px. No giant brand wordmarks, tracking-heavy uppercase, or 10px taglines.
- **Layout:** one compact horizontal toolbar. Name appears once in the toolbar; tagline belongs only in About. Main content uses 24px horizontal padding with modest section gaps.
- **Activities:** upcoming reminders ordered by due time, overdue first; no-timer reminders newest first; previous reminders latest resolved first, with deterministic tie breakers. Collapse empty sections into one calm pending-empty state. Previous stays an accordion, not an invented activity feed.
- **Settings:** label/control rows, grouped by purpose. Appearance and color theme use labelled selects. Alert delivery uses a select with one description for the selected style and a functional Preview button. Launch at Login remains an opt-in switch. Shortcut reference is a disclosure, not a long default section.
- **About:** one title, tagline, version, creator, local-data explanation, and a concise operational limitation. Development stack belongs in a disclosure.
- **Navigation:** preserve horizontal Activities / Settings / About. Native menu opens the requested tab, not a generic window. Separate New reminder from navigation and Quit. Alert preview belongs in Settings.
- **Motion:** only existing functional control/accordion transitions. No new decorative movement. Preserve notch entrance and Reduce Motion.
- **Decoration:** no gradients, icons added for atmosphere, fake metrics, photos, or extra cards. Shadcn/Base UI components remain the interaction foundation. Outlines/shadows on popovers indicate actual elevation; list sections stay flat.
- **Accessibility:** visible labels, real selected-value labels, keyboard tabs/accordions, never hover-only reminder actions, consistent error placement. Native notification appearance remains macOS-owned.

## Validation

Check light/dark at 560px minimum and 760px default window widths, populated and empty lists, long text, tab keyboard navigation, native menu destinations, and state preservation. Example records used in browser testing must be clearly labelled and never written into the user's real database.

## Reference

Based on the user's three screenshots (2026-10-29 13:07), supplied antislop-ui skill, and the current shadcn base-nova setup. The referenced `antislop.md` core file was not present at the supplied skill root; no claim of reading that unavailable file.
