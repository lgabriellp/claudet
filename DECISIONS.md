# Architecture Decision Records

### ADR-001: Transparent Migrations on Startup

**Status:** accepted
**Date:** 2026-03-09

**Context:** claudet manages external config files (e.g., `~/.claude/settings.json`) whose format may change between versions. Users should not need to manually fix config files after upgrading.

**Decision:** All migrations must run transparently when claudet is loaded — during `interactiveFlow` startup, before any user interaction. Migration logic lives in pure helper functions (testable) and is invoked from the main entry point. Legacy formats are detected, converted, and cleaned up silently.

**Consequences:** Every config-touching helper must handle both old and new formats. Migration code must be idempotent (safe to run repeatedly). No manual migration steps or CLI commands required from users.
