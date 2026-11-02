# Animation Plans

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Remove Quick Add shortcut motion](001-remove-quick-add-shortcut-motion.md) | HIGH | DONE |
| 002 | [Animate alert-preview dismissal](002-landing-alert-preview-exit.md) | MEDIUM | DONE |
| 003 | [Preserve reduced-motion feedback](003-reduced-motion-feedback.md) | MEDIUM | DONE |
| 004 | [Narrow shared-control transitions](004-narrow-control-transitions.md) | MEDIUM | DONE |
| 005 | [Make the landing dot wave static](005-static-dot-wave.md) | MEDIUM | DONE |
| 006 | [Use ease-in-out for the preview camera](006-camera-ease-in-out.md) | LOW | DONE |

## Recommended execution order

1. **001 — Remove Quick Add shortcut motion**: high-frequency keyboard path; no dependencies. (DONE)
2. **002 — Animate alert-preview dismissal**: follows the existing style-specific entrance paths; depends on 001's high-priority shortcut fix being complete. (DONE)
3. **003 — Preserve reduced-motion feedback**: make cross-cutting fallbacks after the individual motions have been corrected. (DONE)
4. **004 — Narrow shared-control transitions**: replace unbounded property transitions with explicit color/translate feedback. (DONE)
5. **005 — Make the landing dot wave static**: stop continuous decorative painting; no dependencies. (DONE)
6. **006 — Use ease-in-out for the preview camera**: adjust the large explanatory camera move after the higher-priority motion fixes. (DONE)

Update the status here when a plan is implemented and verified.
