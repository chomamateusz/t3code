# handoff/stack-20261109-6

Sources of what `0.1.8-local.stack.20261109.6` (desktop build r15, Linux build r12) adds over
`0.1.8-local.stack.20261109.5` (r14 / r11), for the `local/stack` patch series.

`.6` was built from `716dcbbfdd9087dfe798985737b41688718710b2`, which is the `.5` source
`7b7c82aae24550bd170ef30436e3b4de2906ccd5` plus exactly the two commits in `patches/`. Both change only
`apps/web` and `docs/user/thread-sidebar.md`; server, desktop and contracts code equal `.5`. Upstream base of both
sources: `965ddc1d6caec14ad5adead211fcb4e3f1f6b030`. The patches were made with
`git format-patch 7b7c82aae2..716dcbbfdd` and apply in order on `7b7c82aae2`.

`.6` is installed on all five machines (read back 2026-11-10). It contains nothing else: in particular no
"send the whole queue" change, which is not part of the stack.

## The two patches

1. `0001-squash-Filter-the-sidebar-with-a-project-row.patch` (`975e154c36`): belongs to the same feature as
   series patch `0007-Filter-the-sidebar-with-a-project-row.patch` (one patch per feature). Project icon order as a
   per-device preference (Name default, Latest activity, Manual with a sortable list in Settings → Labs), sectioned
   icon tooltip with the badge legend, one mode switch instead of the `⋯` menu.
2. `0002-Show-full-thread-cards-in-the-grouped-sidebar.patch` (`716dcbbfdd`): a feature of its own. The grouped
   sidebar renders the normal card, Alt-click on a header collapses or expands all, a collapsed header shows the
   project badge, headers follow the icon order. After it the sidebar no longer renders the folder row variants, so
   the Snooze that series patch `0009-Snooze-threads-from-grouped-sidebar-rows.patch` adds to those variants cannot
   be reached; whether 0009 stays is the owner's decision.

Their commit bodies are complete behaviour inventories.

## What the series tooling has to change with them

`stack/ci/fork-markers.json` on `local/stack` names two strings that patch 1 removes on purpose:

- `Show only selected` (the old menu label): the mode switch menu now says `Show selected`.
- `Show project badge legend` (the removed command palette action): the legend lives in the icon tooltip, for
  example `Number: threads needing you`.

Strings that exist only with these patches and were used as bundle markers of the `.6` builds: `Project icon order`,
`Showing selected projects`, `data-thread-badge`. Strings that must be absent: `Show only selected`,
`Show project badge legend`, `Two-line folder rows`.

## Not in `.6`

Three later web-only commits (cards indented under project headers, mark read / unread on cards) run on one
machine as a frontend override and are still being extended (reordering inside a group). They will be handed over
the same way once reviewed.
