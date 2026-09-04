# CLAUDE.md — Global AI Guidelines

> **Note to Claude:** This file lives at `~/.claude/CLAUDE.md` and is loaded in **every**
> project. It holds rules that apply to all work. For task-specific guidance, consult the guides listed at the bottom (TDD, standards, Bayesian modeling, writing voice). Load them based on what you're working on—don't assume you need everything.

## Critical Rules (Always Apply)

**These rules are non-negotiable and apply to all work.**

## Running commands

**CRITICAL: Never include comments in bash command blocks. Run commands without inline or preceding comments.**

Doing so makes it hard to approve or deny commands in settings.json

### NO SILENT FALLBACKS — THIS IS A HARD RULE

Silent fallbacks are among the most dangerous patterns in software. They mask bugs, produce incorrect results quietly, and make debugging nearly impossible.

- **Never write code that silently falls back to a different code path when the primary path fails.**
- If data is missing → **error loudly** with a clear, actionable message.
- If a file is not found → **stop and tell the user** what file was expected and where.
- If a parameter is wrong → **throw an error**, do not substitute a default silently.
- If a model is not available → **fail**, do not substitute a different model silently.
- **Try-catch used to silently swallow errors is forbidden** unless the user has explicitly asked for fallback behavior over your explicit objection.
- **Optional parameters that silently change behavior are forbidden.** If a parameter controls which code path runs, its absence must cause an error or explicit warning — not silent substitution.

The only acceptable fallback pattern is one where:
1. The user has explicitly requested it in this conversation, AND
2. You have raised your objection to it on the record, AND
3. The fallback produces a **visible, logged warning** every time it fires.

### TEST INTEGRITY — NEVER MAKE A TEST PASS BY WEAKENING IT

**Never change a test solely to make it pass.** A failing test is information. Suppressing it
destroys the information and leaves the bug.

When a test fails after a change:

1. **Stop and report it.** Say which test, and what the failure actually says.
2. **Explain why it is failing** — did the change break behavior, or did it correctly change
   behavior the test still encodes?
3. **Ask which it is.** That judgment is the user's, not yours.

**Allowed without asking:** adding tests for new behavior; renaming or reorganizing tests
without changing what they assert; fixing a test that is itself provably wrong, saying so.

**Forbidden without explicit approval:** changing an expected value; loosening an assertion;
adding a tolerance to make a comparison pass; marking a test skipped, pending, or `.only`
elsewhere; deleting a failing test; wrapping a failing call so the error is swallowed.

This applies with full force when the number is the deliverable. A weakened assertion in
analysis code is a published wrong result with a green check mark next to it.

### ENFORCEMENT BEATS DOCUMENTATION

A rule with no mechanism behind it does not happen — it just looks like it does. If a rule
here matters, prefer a hook, a test, or a script that enforces it over a paragraph asking for
it. And **the enforcement mechanism is production code**: it gets a test like anything else.
An unverified gate is worse than no gate, because people stop checking the thing themselves.

### ALWAYS use `date` command for dates

Never assume or guess dates. Always run `date "+%Y-%m-%d"` when you need the current date for documentation, commits, or any other purpose.

### AI Integrity Principles

**Always provide honest, objective recommendations based on technical merit, not user bias.**

- **Never agree with users by default** - evaluate each suggestion independently
- **Challenge bad ideas directly** - if something is technically wrong, say so clearly
- **Recommend best practices** even if they contradict user preferences
- **Explain trade-offs honestly** - don't hide downsides of approaches
- **Prioritize code quality** over convenience when they conflict
- **Question requirements** that seem technically unsound
- **Suggest alternatives** when user's first approach has issues
- **Disagree when necessary** — silence is complicity. If you spot a bug, design flaw, security issue, or bad pattern, name it.

Examples of honest responses:
- "That approach would work but has significant performance implications..."
- "I'd recommend against that pattern because..."
- "While that's possible, a better approach would be..."
- "That's technically feasible but violates [principle] because..."
- "I'm concerned about [issue]. Let me explain why this won't work as written..."

## Commands

- `/commit` — atomic commits with quality checks
- `/push` — push, after checking CI is not already red
- `/hygiene` — project health: detects R, Python or Node and uses that project's runner
- `/next` — priorities, via the `next-priorities` agent
- `/refactor` — refactoring analysis for code a human reads
- `/refactor-verified` — refactoring analysis for code nobody reads, where checks replace review

Claude Code now covers natively what the rest of this repo's commands used to do:
transcripts and `--resume` replace session capture, the memory system replaces learning
capture, `TodoWrite` and `gh` replace todo management, `/loop` and `/schedule` replace
monitoring, and `/code-review` and `/simplify` replace the quality commands. They were
removed rather than maintained in parallel.

See [~/.claude/guides/workflow.md](~/.claude/guides/workflow.md) for full collaboration guidelines.

## When to Consult Each Guide

### 🔴 Load for Feature/Bug Work

- [~/.claude/guides/tdd.md](~/.claude/guides/tdd.md) — When implementing features, fixing bugs, or refactoring
  - Defines how to write tests first, then code
  - Required for any non-trivial code change

### 📋 Load for General Development

- [~/.claude/guides/standards.md](~/.claude/guides/standards.md) — Code quality expectations, testing strategy
  - Consult when: running tests, committing code, reviewing architecture
  - Covers: complexity limits, test standards, markdown validation, architecture principles

### 📊 Load for Statistical / Modeling Work

- [~/.claude/guides/bayesian-production.md](~/.claude/guides/bayesian-production.md) — When working
  on Bayesian models, Stan code, MCMC diagnostics, or time-series inference
  - Covers: Kalman filters, Pathfinder, reparameterization, correlation-matrix priors,
    regularized horseshoe, warm-starting, R̂/ESS thresholds
  - Stan snippets are compile-checked; the R (cmdstanr) and Python (cmdstanpy) calls differ

## Review Agents

Two fire automatically. A `PostToolUse` hook (`hooks/reviewer-dispatch.js`) routes an
edited file to its reviewer:

| Edited | Agent |
|---|---|
| `*.stan` | `stan-reviewer` — silent-wrong-answer bugs, geometry, wasted cycles |
| `*.R` `*.Rmd` `*.qmd` | `r-analysis-reviewer` — joins, coercion, non-determinism, claims |

Three are on demand — ask for them by name:

- `statistical-analysis-reviewer` — skeptical peer review of a finished analysis, before it
  is shared. Design, assumptions, inference, and whether the conclusion is supported.
- `determinism-reviewer` — finds work done by model reasoning that tested code could do.
- `voice-authenticator` — checks prose against [~/.claude/guides/voice.md](~/.claude/guides/voice.md).

All of them report findings and never edit. Silence them for a session with
`CLAUDE_REVIEWER_DISPATCH=0`. Adding a file type is one entry in `RULES` plus a test.

### ✍️ Load for Reader-Facing Prose

- [~/.claude/guides/voice.md](~/.claude/guides/voice.md) — Before writing or editing any prose a reader will see
  - Report `.qmd` files, figure captions, README and docs pages, supplements
  - Defines the register dial (paper / commentary / conversational) and the rules for each