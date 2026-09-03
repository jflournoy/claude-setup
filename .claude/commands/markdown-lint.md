---
allowed-tools: [Bash]
description: Validate and fix markdown files
approach: direct-implementation
token-cost: ~100
portability: needs remark (npx or global); reports plainly when unavailable
---

# Markdown Lint Command

Validate markdown across the repo, and optionally auto-fix what can be fixed.

## Your Task

```bash
#!/bin/bash
if [ ! -f .remarkrc.js ] && [ ! -f .remarkrc ] && [ ! -f .remarkrc.json ]; then
  echo "⚠️  No remark config found (.remarkrc.js). Copy one in before linting."
  exit 1
fi

if command -v remark >/dev/null 2>&1; then
  REMARK="remark"
elif command -v npx >/dev/null 2>&1; then
  REMARK="npx --no-install remark"
else
  echo "❌ remark not available and no npx to fetch it."
  echo "   Install with: npm install --no-save remark remark-cli"
  exit 1
fi

$REMARK . --quiet || { echo "❌ Markdown issues found"; exit 1; }
echo "✅ Markdown clean"
```

To auto-fix what remark can fix, rerun with `--output` instead of `--quiet`, then review
the diff before committing — remark rewrites files in place.

## Notes

- Configuration lives in `.remarkrc.js`; exclusions in `.remarkignore`. Both must be copied
  alongside this command for it to do anything useful.
- `--no-install` is deliberate: it fails loudly rather than silently downloading remark
- Remark cannot fix everything; broken links and undefined references need manual edits
