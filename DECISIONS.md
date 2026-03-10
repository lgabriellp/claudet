# Architecture Decision Records

### ADR-001: Transparent Migrations on Startup

**Status:** accepted
**Date:** 2026-03-09

**Context:** claudet manages external config files (e.g., `~/.claude/settings.json`) whose format may change between versions. Users should not need to manually fix config files after upgrading.

**Decision:** All migrations must run transparently when claudet is loaded — during `interactiveFlow` startup, before any user interaction. Migration logic lives in pure helper functions (testable) and is invoked from the main entry point. Legacy formats are detected, converted, and cleaned up silently.

**Consequences:** Every config-touching helper must handle both old and new formats. Migration code must be idempotent (safe to run repeatedly). No manual migration steps or CLI commands required from users.

### ADR-002: Managed Context Docs under `~/.claude/claudet/`

**Status:** accepted
**Date:** 2026-03-10

**Context:** claudet's methodology docs (`planning-guide.md`, `worktree-workflow.md`) and CLAUDE.md instructions live at `~/.claude/` root as manually-placed files. They're tightly coupled to claudet but not versioned with it — when claudet updates, docs can become stale.

**Decision:** Store canonical doc templates in claudet source (`src/templates/`), install/update them to `~/.claude/claudet/` using hash-based staleness detection, and manage a marked section of `~/.claude/CLAUDE.md` between `<!-- claudet:start -->` / `<!-- claudet:end -->` markers. Legacy root-level docs are migrated transparently on startup (ADR-001 pattern). A `claudet context` subcommand provides manual control.

**Consequences:** claudet becomes the source of truth for its own methodology docs. User content in CLAUDE.md outside markers is never touched. Template updates propagate automatically on next startup. Legacy files are renamed to `.migrated-to-claudet` to prevent confusion.
