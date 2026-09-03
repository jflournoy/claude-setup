---
allowed-tools: [Bash]
description: Monitor GitHub repository for test failures and pull requests
---

# Monitor Command - Repository Health Tracking

Keep an eye on your repository's health in the background.

## Usage

<bash>
#!/bin/bash

case "$1" in
  start)
    echo "🚀 Starting repository monitoring..."
    node scripts/monitor-repo.js &
    echo "Monitor running in background. Use '/monitor status' to check."
    ;;
  stop)
    echo "🛑 Stopping repository monitoring..."
    pkill -f 'node scripts/monitor-repo.js' || echo 'Monitor not running'
    ;;
  status|check)
    node scripts/monitor-repo.js status
    ;;
  *)
    echo "📊 GitHub Repository Monitor"
    echo ""
    echo "Usage:"
    echo "  /monitor start   - Start background monitoring"
    echo "  /monitor stop    - Stop monitoring"
    echo "  /monitor status  - Check current status"
    echo ""
    echo "The monitor checks every 5 minutes for:"
    echo "  • Failed workflow runs"
    echo "  • Open pull requests"
    echo "  • Running workflows"
    ;;
esac
</bash>

## What It Does

- **Monitors workflows**: Alerts on failures
- **Tracks PRs**: Never miss a pull request
- **Background operation**: Runs without interrupting work
- **Status persistence**: Check status anytime

## Notes

Monitor runs in background and checks repository every 5 minutes.
Status is saved to `.monitor-status.json` for quick access.