# Security Policy

## Supported versions

Security fixes are provided for the latest release on the `main` branch.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, email the maintainers with:

- A description of the issue
- Steps to reproduce
- Impact assessment (if known)

We will acknowledge receipt within a few business days and work on a fix before public disclosure when appropriate.

## Scope notes

DevTree runs LLM validation with user-supplied API keys **or** a local Claude Code / Codex / Gemini CLI session (spawned headless; reuses your machine login, does not attach to an open TUI). API-key runs execute project-scoped agent tools (`read_files`, `grep`, `shell`). CLI backends use the CLI’s own tools with elevated auto-approval inside the opened project. Only open projects you trust, and treat API keys as secrets (they are stored locally in app settings).
