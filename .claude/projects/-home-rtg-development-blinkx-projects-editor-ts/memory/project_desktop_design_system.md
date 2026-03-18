---
name: Desktop app design system refresh
description: EditorTS desktop app uses a charcoal/blue/orange design system with Syne/DM Sans/JetBrains Mono fonts. UX-only changes are safe in styles.css and AppShell.tsx. Do NOT touch RPC/backend logic in App.tsx.
type: project
---

The desktop app (packages/desktop) went through a design refresh with a specific palette and typography system.

**Key files for visual/UX work:**
- packages/desktop/src/styles.css — all desktop-specific styles
- packages/desktop/src/AppShell.tsx — SolidJS sidebar + main content shell
- packages/starter-shared/src/ai-ui.css — shared AI panel styles (used by desktop AND web)
- packages/starter-shared/src/AiPanels.tsx — shared SolidJS AI workspace components

**Why:** User explicitly stated to focus only on UX and never break RPC/backend functionality. App.tsx contains business logic and should not be touched for visual work.

**How to apply:** When doing design/CSS/layout changes, edit only the files above. Validate with `bun run build`. 3 pre-existing test failures in core/src/core/aiChat.ts are unrelated to UI.
