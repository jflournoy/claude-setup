---
allowed-tools: [Bash, Read, Write]
description: Task management using GitHub Issues for better collaboration and tracking
---

# Todo Management Command

Manage tasks efficiently using GitHub Issues.

## Your Task
Handle todo operations via GitHub Issues:

**IMPORTANT**: If adding dates, always use `date "+%Y-%m-%d"` to get the current date. Never guess or assume dates.

```bash
#!/bin/bash

COMMAND="${1:-list}"
shift
ARGS="$*"

case "$COMMAND" in
  "list"|"show")
    echo "📋 GitHub Issues:"
    node scripts/todo-github.js list --silent
    ;;
    
  "add"|"create")
    if [ -z "$ARGS" ]; then
      echo "❌ Error: Title required"
      exit 1
    fi
    echo "➕ Creating issue: $ARGS"
    node scripts/todo-github.js add --silent -- "$ARGS"
    ;;
    
  "done"|"close")
    ISSUE_NUM="$1"
    if [ -z "$ISSUE_NUM" ]; then
      echo "❌ Error: Issue number required"
      exit 1
    fi
    echo "✅ Closing issue #$ISSUE_NUM"
    node scripts/todo-github.js done --silent -- "$ISSUE_NUM"
    ;;
    
  "comment")
    ISSUE_NUM="$1"
    shift
    COMMENT="$*"
    if [ -z "$ISSUE_NUM" ] || [ -z "$COMMENT" ]; then
      echo "❌ Error: Issue number and comment required"
      exit 1
    fi
    node scripts/todo-github.js comment --silent -- "$ISSUE_NUM" "$COMMENT"
    ;;
    
  "stats")
    echo "📊 Issue Statistics:"
    node scripts/todo-github.js stats --silent
    ;;
    
  *)
    echo "Usage: /todo [list|add|done|comment|stats] [args]"
    echo "  list         - Show open issues"
    echo "  add <title>  - Create new issue"
    echo "  done <#>     - Close issue"
    echo "  comment <#>  - Add comment to issue"
    echo "  stats        - Show issue statistics"
    ;;
esac
```

## Notes

This command uses GitHub Issues via the GitHub CLI for better collaboration and tracking.