---
allowed-tools: [Bash]
description: Validate and fix markdown files
approach: script-delegation
token-cost: ~80 (npm script does the work)
best-for: Checking markdown before a commit or docs change
---

# Markdown Lint Command

Validate markdown across the repo, and optionally fix what can be fixed automatically.

## Your Task

Check for problems:

```bash
npm run markdown:lint
```

If issues are reported and the user wants them fixed automatically:

```bash
npm run markdown:fix
```

## Notes

- Configuration lives in `.remarkrc.js`; exclusions in `.remarkignore`
- `markdown:fix` rewrites files in place — review the diff before committing
- The same check runs in CI via `.github/workflows/quality.yml`
- Remark cannot fix everything; broken links and undefined references need manual edits
