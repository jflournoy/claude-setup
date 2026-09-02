# Repo Audit — claude-setup

**Date:** 2026-09-02
**Scope:** Whole-repo review for staleness and enhancement, plus a correctness pass on
`CLAUDE_bayesian-production-tricks.md`.
**Method:** Every claim was checked mechanically — `git check-ignore`, `stanc` compilation,
CmdStan runs, installed library source, and the live session's own agent/skill roster.
Nothing here was inferred from reading prose alone.
**Status:** All findings resolved. Tests 124 pass / 0 fail, ESLint clean, remark clean.

---

## Summary

Three defects were silently destroying work or silently doing nothing, which is notable in a
repo whose top rule is "NO SILENT FALLBACKS":

- Two of the largest guides had never been in git, and `git status` was hiding that.
- The entire `.claude/agents/` layer failed to load — all eight agents.
- A prompt hook returned `exit 127` on every prompt.

A fourth was found while fixing the others: the husky quality gates had never run, for any
commit, since the fork.

---

## 1. Global gitignore was hiding this repo's product

`~/.config/git/ignore` contains `CLAUDE.md`, `CLAUDE_*.md`, `.claude/`, `.history/`. That is
correct for work repos — it keeps AI config out of client code — and exactly backwards here.

Already-tracked files are unaffected by gitignore, so `CLAUDE.md` and the three original
guides stayed tracked and nothing looked wrong. Everything added since was invisible:

| File | Size | Status before |
|---|---|---|
| `CLAUDE_voice.md` | 49 KB | untracked, hidden from `git status` |
| `CLAUDE_bayesian-production-tricks.md` | 10 KB | untracked, hidden from `git status` |
| `.claude/hooks/` | 3 scripts | untracked, hidden |
| `.claude/CLAUDE.md` | — | untracked, hidden |

`CLAUDE_voice.md` is a writing profile distilled from nine of your own pieces and existed in
exactly one place: this disk. No commit, no remote, no warning.

**Resolved.** Negation block added to the repo `.gitignore` — repo rules outrank the global
file — placed before the deliberate `.claude/settings.json` exclusion, which still applies.
Verified with `git check-ignore -v`. Both guides are now committed.

**Recurrence:** this will happen in any repo that should version AI config. The global rule is
doing real work elsewhere, so keep it; just remember `git status` will not warn you.

## 2. `UserPromptSubmit` hook was broken on every prompt

`.claude/settings.json` pointed at `.claude/hooks/vexp-hint.sh`, which did not exist — vexp's
installer wrote it to `.codex/` instead. Every prompt fired the hook and got `exit 127`.

**Resolved.** Script installed at the registered path, made executable, verified to exit 0.

## 3. The agent layer was dead — all eight agents

Direct evidence: not one of the eight agents in `.claude/agents/` appeared in the session's
available agent list. Only built-ins were there.

The frontmatter used a schema Claude Code does not recognise — `agent-type` is not a field,
and `allowed-tools` is the *slash-command* key, not the agent one:

```yaml
---
agent-type: general-purpose
allowed-tools: [Read, Grep]
description: ...
last-updated: 2025-08-17
---
```

`name` and `description` are the two required fields. Every file was missing `name`. Two
files — `test-coverage-advisor.md` and `usage-estimator.md` — additionally had the closing
fence glued onto the last key (`last-updated: 2025-08-17---`), so the YAML block never
terminated.

The cascade: `/next` and `/retrospective` are thin wrappers whose entire body instructs Claude
to "use the next-priorities agent" / "use the session-insights agent". With the agents
unloadable, Claude would improvise rather than error — a silent fallback.

**Resolved.** All eight rewritten to `name` / `description` / `tools`. `LS` dropped from
`repo-quality-auditor` (not a current tool; `Glob` and `Bash` cover it). Bodies untouched, and
`agent-audit.yml`'s awk frontmatter strip still works — better than before, since two blocks
were previously unterminated.

## 4. `CLAUDE.md` drift

Eight commands were documented that had no file: `causal-design`, `clean-state`, `condense`,
`continue`, `fix-permissions`, `markdown-lint`, `render-report`, `timeline`. The header note
named three guides that also did not exist ("report rendering, Quarto, HPC architecture").

More consequential, the inverse: `CLAUDE_voice.md` and `CLAUDE_bayesian-production-tricks.md`
were registered nowhere. `CLAUDE.md` instructs Claude to load guides from the list at the
bottom, and neither was on it — so **neither was ever loaded**, despite the Bayesian guide's
own header calling itself "a reference for Claude".

**Resolved.**

- Both guides registered under new "Statistical / Modeling Work" and "Reader-Facing Prose"
  sections; header note corrected.
- `/markdown-lint` built, since the capability already existed as `npm run markdown:lint`.
- The other seven references removed. `/continue`, `/condense` and `/clean-state` describe
  session-state management that Claude Code now handles natively via compaction.
  `/render-report`, `/causal-design`, `/timeline` and `/fix-permissions` were never written —
  removed from the list rather than left as promises. Build them later if wanted.
- `/push-detailed`, referenced by `push.md` and equally nonexistent, replaced with the plain
  git commands it described.

## 5. The husky quality gates had never run

Husky v9 activates by setting `core.hooksPath` during `npm install`. In this clone
`core.hooksPath` was unset and `.git/hooks/` held only vexp's three generated scripts. So
`.husky/pre-commit` (lint, tests, atomic-commit warning) and `.husky/pre-push` (CI status
gate) had **never fired for any of the 11 post-fork commits**.

They also could not simply be switched on. Setting `core.hooksPath=.husky` makes git ignore
`.git/hooks/` entirely, which would stop vexp's index maintenance — and vexp does not detect
the override: `vexp-core hooks check` still reports all three hooks ✓ with
`core.hooksPath=.husky` set and no `.husky/` directory present. Enabling husky would have
broken vexp silently while both tools reported health.

**Resolved.** `.husky/` removed along with the `prepare` script and the husky devDependency.
Everything `pre-commit` did already runs in `.github/workflows/quality.yml` and is available
as `npm run commit:check`. The one genuinely unique check — "is CI already red before I
push?" — moved into the `/push` command, where it executes. `test/ci-monitoring.test.js`
retargeted accordingly; it had been asserting that a hook *file existed*, which is precisely
the thing that was not sufficient.

This matches the philosophy `push.md` already stated: local commands handle git operations,
CI/CD handles quality validation.

## 6. Dependencies, tests, lint

`node_modules/` had never been installed here, so two tests failed on missing `remark`/
`eslint` binaries. Installed with `npm ci --ignore-scripts` (deliberately skipping husky's
`prepare`, per item 5).

- **Tests:** 124 pass, 0 fail, 1 skipped.
- **`test/markdown-validation.test.js`** wrote `test-markdown.md` into the repo root; now uses
  `fs.mkdtempSync(os.tmpdir())` with recursive cleanup.
- **ESLint:** was 12 errors, now clean. Most were quote style. Two were not:
  - `scripts/feature-check.js:253` — `[\+\-]` had useless escapes.
  - `scripts/feature-check.js:203` — a bare `catch (error)` that fell back to a different diff
    strategy **with no output at all**. A textbook silent fallback, in the repo that forbids
    them. Now emits `console.warn` naming the error and the strategy change before falling
    back.
- **remark:** clean.

## 7. Smaller items

- `.vexp/` added to `.gitignore` — it was showing as untracked on every `git status` while
  `.vscode/settings.json` already hid it from the editor, so the two disagreed.
- `vexp-verify.sh` (a `Stop`-event completion gate) existed but was never registered.
  Registered in `settings.json`. Verified it exits 0 promptly when given hook stdin — run bare
  against an open terminal it blocks on `read`, which is expected for a stdin-driven hook, not
  a defect.
- `.claude/commands/README.md` was being loaded as a `/README` slash command, since every
  `.md` in that directory becomes one. Moved to `docs/COMMAND_STRUCTURE.md`.
- `package.json` attribution updated from the upstream fork (`rmurphey`) to `jflournoy`;
  description updated to match what the repo now is.

---

## Bayesian guide — what was wrong

Delivered as a rewrite of the guide itself; no audit trail left in the file. Ten substantive
errors, found by compiling every snippet under CmdStan 2.38.0 and checking every API claim
against installed library source.

**Code that did not work**

- `sigma_ar ~ half_normal(0.1)` — Stan has no `half_normal`; `stanc` rejects it.
- The Cholesky snippet declared `matrix[K,K] L` and filled only the lower triangle. Stan does
  not validate unconstrained transformed parameters, so it ran clean while writing `nan` into
  every upper-triangle cell — 4500 in a 600-draw K=6 fit.
- The same snippet declared K² parameters with priors on K(K−1)/2 of them. The remainder were
  improper: `z_corr_raw[1,1]` reached R̂ = 2.1 with a posterior mean of 1.4e+12.
- The warm-start snippet passed Stan output CSVs to `inits`, which takes only JSON/Rdump paths
  or dicts. The Pathfinder snippet passed a `CmdStanPathfinder` object, also not accepted.

**Claims that were false**

- "`normal(0, 0.5)` encodes LKJ(4)-equivalent shrinkage." Measured at K=10 over 4000 draws:
  sd(r) = 0.364 against LKJ(4)'s 0.243 — wider than LKJ(1)'s 0.302, i.e. wider than uniform
  over correlation matrices. The matching scale is K-dependent, so no fixed number works.
- "Prophet uses MAP + Laplace by default." It is MAP only; its docstring says so. The
  confusion is lexical — Prophet's `np.random.laplace` draws changepoints from the Laplace
  *distribution*.
- The rationale for hand-rolling the Cholesky transform. Stan's `cholesky_factor_corr` uses
  the same tanh + stick-breaking map, so there is no geometric gain. The exception comes from
  the density, not the transform. Measured: the built-in threw 26 warmup exceptions at K=10
  and still finished with 0 divergences, R̂ 1.00, ESS ~1700–2300.
- R̂ 1.05 → 1.01 (Vehtari et al. 2021); Tail-ESS was missing; "fix low ESS by thinning" is
  backwards.

**Also updated:** horseshoe → regularized horseshoe, ADVI → Pathfinder as the default fast
approximation, LOO flagged as the wrong tool for time series, R (cmdstanr) examples added
alongside Python. `Pathfinder (Stan 2.33+)` was the one version claim that checked out.

Every complete Stan program in the guide compiles; the regularized horseshoe also samples
clean (P=20, 4 chains, 0 exceptions, max R̂ 1.00).

---

## Open question

**What is this repo now?** As inherited, a Node.js toolkit: 13 scripts, 125 tests, ESLint,
remark. As used, a home for prose guides loaded into *other* repos — and `CLAUDE_voice.md` is
explicitly written for a different repository, naming `analysis_reports/*.qmd` and
`R/report_section_renderers.R`, which do not exist here.

Both halves now work, so nothing is broken either way. But they have different lifecycles, and
eventually splitting the guides from the Node toolkit is worth considering.
