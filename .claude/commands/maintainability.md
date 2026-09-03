---
allowed-tools: [Bash]
description: Code maintainability analysis and improvement recommendations
approach: direct-implementation
token-cost: ~200
portability: self-contained; needs only git and coreutils
---

# Maintainability Analysis Command

Code health metrics that work in any language. No `package.json` required.

Uses `git ls-files`, so ignored paths (`node_modules/`, `renv/`, `.venv/`, `dist/`) are
excluded automatically without maintaining an exclusion list.

## Your Task

```bash
#!/bin/bash
echo "🔧 Code Maintainability Analysis"
echo "================================="

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ Not a git repository - this command reads the tracked file list"
  exit 1
fi

FILES=$(git ls-files)

echo ""
echo "📊 Project overview:"
echo "  Commits: $(git rev-list --count HEAD 2>/dev/null || echo 0)"
echo "  Branch:  $(git branch --show-current 2>/dev/null || echo unknown)"
echo "  Tracked files: $(echo "$FILES" | grep -c .)"
echo "  Source files by type:"
echo "$FILES" | grep -oE '\.[A-Za-z]+$' | sort | uniq -c | sort -rn | head -8 \
  | while read -r n ext; do printf "    %-8s %s\n" "$ext" "$n"; done

echo ""
echo "📁 Largest source files:"
echo "$FILES" | grep -E '\.(R|r|py|js|ts|jsx|tsx|stan|sh)$' \
  | tr '\n' '\0' | xargs -0 wc -l 2>/dev/null \
  | sort -rn | grep -v ' total$' | head -10

echo ""
echo "🔧 Technical debt markers:"
for marker in TODO FIXME HACK XXX; do
  n=$(echo "$FILES" | tr '\n' '\0' | xargs -0 grep -lI "$marker" 2>/dev/null | wc -l | xargs)
  printf "    %-6s %s files\n" "$marker" "$n"
done

echo ""
echo "📦 Dependencies:"
if [ -f DESCRIPTION ]; then
  echo "  R project (DESCRIPTION present)"
elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  echo "  Python project"
elif [ -f package.json ]; then
  node -e "const p=require('./package.json');console.log('  Node: '+Object.keys(p.dependencies||{}).length+' prod, '+Object.keys(p.devDependencies||{}).length+' dev')"
else
  echo "  No dependency manifest detected"
fi
```

## Notes

- Read-only; never modifies anything
- Exits non-zero only when run outside a git repository
- Extend the `grep -E` extension list for languages not covered
