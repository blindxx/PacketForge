# Project Overview
PacketForge is a deterministic network CLI simulation engine designed for CCNA-style learning labs.

# Engine Architecture Rules
The `engine` package is responsible for:
- CLI session state machine
- command parsing and routing
- mode stack behavior
- action logs
- deterministic snapshots

UI logic must not appear inside the `engine` package.

# Review Priorities
Prioritize review feedback on:
- correctness issues
- deterministic state behavior
- mode stack transitions
- snapshot safety
- serialization correctness

# Review Scope Limits
Avoid suggesting:
- unrelated refactors
- architectural redesigns
- stylistic changes
- cross-phase feature expansions

# Development Philosophy
PacketForge development is organized into small deterministic phases. Review feedback should respect the scope and goals of the current phase.
