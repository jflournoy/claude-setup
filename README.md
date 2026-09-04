# claude-config

Personal [Claude Code](https://docs.claude.com/en/docs/claude-code) configuration: guides,
reviewer agents, and a hook that routes edited files to the reviewer that fits them. Aimed at
reproducible statistical analysis in R, Stan and Python, where the deliverable is a published
number and the bug that matters is the one that does not crash.

**This repository is checked out as `~/.claude`.** There is no install step and no build
system — no `package.json`, no dependencies. Tests run on `node --test`, which ships with
Node.

## Install

```bash
cd ~/.claude
git init
git remote add origin git@github.com:jflournoy/claude-setup.git
git fetch origin
git checkout -b main origin/main
```

`~/.claude` already holds live runtime state and credentials, so `.gitignore` is an
**allowlist**: everything is ignored, and only authored config is re-included. Verify before
staging anything:

```bash
git check-ignore -v .credentials.json   # must print a match
git status --porcelain                  # must show only authored config
```

Then merge the `PostToolUse` block from `settings.example.json` into your own
`settings.json`, which stays untracked because it is machine-specific.

## What's here

### Guides

Loaded on demand — `CLAUDE.md` says when.

| Guide | For |
|---|---|
| `guides/bayesian-production.md` | Writing competent Stan, and making it fast enough to run daily. Every claim carries its evidence class; verified against CmdStan 2.35 and 2.38 |
| `guides/voice.md` | Writing prose a reader sees, in the author's own register |
| `guides/tdd.md`, `guides/standards.md`, `guides/workflow.md` | Test discipline, code quality, collaboration |

### Reviewer agents

Two fire automatically. `hooks/reviewer-dispatch.js` reads the edited path and names the
agent to run:

| Edited | Agent |
|---|---|
| `*.stan` | `stan-reviewer` — nan-filled matrices, parameters with no prior, dropped Jacobians, wasted cycles |
| `*.R` `*.Rmd` `*.qmd` | `r-analysis-reviewer` — joins that lose rows, type coercion, unseeded RNG, stale caches |

Four are on demand: `statistical-analysis-reviewer` (skeptical peer review before a result is
shared), `determinism-reviewer` (work the model is doing that code should), `voice-authenticator`
(prose against the voice profile), `next-priorities`.

All report findings and never edit. `CLAUDE_REVIEWER_DISPATCH=0` silences dispatch for a
session. Adding a file type is one entry in `RULES` plus a test.

### Commands

`/commit`, `/push`, `/hygiene`, `/next`, `/refactor`, `/refactor-verified`.

## Tests

```bash
node --test test/*.test.js
```

No install, no dependencies. The suite covers the dispatch table and every failure path, and
checks every agent's frontmatter — the regression test for a real bug where all eight agents
used the wrong schema, loaded silently as nothing, and no one noticed for months.

## Credit

The structure, the auto-firing reviewer pattern, and the `determinism-reviewer`,
`statistical-analysis-reviewer` and `voice-authenticator` concepts come from
[rmurphey/claude-config](https://github.com/rmurphey/claude-config). This repo began as a
fork of [rmurphey/claude-setup](https://github.com/rmurphey/claude-setup).

## License

MIT — see [LICENSE](LICENSE).
