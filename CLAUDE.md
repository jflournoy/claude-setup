# CLAUDE.md - Project AI Guidelines

## Development Method: TDD

**STRONGLY RECOMMENDED: Use Test-Driven Development for all non-trivial changes**

TDD helps Claude produce more focused, correct code by clarifying requirements upfront and reducing wildly wrong approaches. This is the default expectation for any feature, refactor, or significant bug fix. Exceptions (typo fixes, one-liners) are rare and should be explicitly justified.

### Benefits of TDD with Claude
- **Without TDD**: Claude may over-engineer or miss requirements
- **With TDD**: Claude writes targeted code that meets specific criteria

### TDD Workflow
1. 🔴 **RED**: Write a failing test to define requirements
2. 🟢 **GREEN**: Write minimal code to pass the test
3. 🔄 **REFACTOR**: Improve code with test safety net
4. ✓ **COMMIT**: Ship working, tested code

### Test Contracts, Not Implementation
**CRITICAL: Tests must describe behavior from the caller's perspective — not internal mechanics.**

- ✅ Test inputs and outputs (the contract)
- ✅ Test observable side effects (files written, messages sent)
- ❌ Do NOT assert on internal function calls, private state, or call order
- ❌ Do NOT couple tests to specific implementation details that could change during refactoring

A good test survives a complete rewrite of the implementation. If refactoring breaks your tests without changing behavior, the tests are wrong.

### The TDD Command
```bash
/tdd start "your feature"  # Guides through the TDD cycle
```

Consider TDD especially for complex features or when requirements are unclear.

## Critical Instructions

**ALWAYS use `date` command for dates** - Never assume or guess dates. Always run `date "+%Y-%m-%d"` when you need the current date for documentation, commits, or any other purpose.

**NO SILENT FALLBACKS — THIS IS A HARD RULE.**

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

## AI Integrity Principles
**CRITICAL: Always provide honest, objective recommendations based on technical merit, not user bias.**

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

## Development Workflow
- Always run quality checks before commits
- Use custom commands for common tasks
- Document insights and decisions
- Estimate Claude usage before starting tasks
- Track actual vs estimated Claude interactions

## Quality Standards
- Zero errors policy
- All tests passing before commit
- No warnings in critical paths

## Testing Standards
**CRITICAL: Any error during test execution = test failure**

- **Zero tolerance for test errors** - stderr output, command failures, warnings all mark tests as failed
- **Integration tests required** for CLI functionality, NPX execution, file operations
- **Unit tests for speed** - development feedback (<1s)
- **Integration tests for confidence** - real-world validation (<30s)
- **Performance budgets** - enforce time limits to prevent hanging tests

## Markdown Standards
**All markdown files must pass validation before commit**

- **Syntax validation** - Uses remark-lint to ensure valid markdown syntax
- **Consistent formatting** - Enforces consistent list markers, emphasis, and code blocks
- **Link validation** - Checks that internal links point to existing files
- **Auto-fix available** - Run `npm run markdown:fix` to auto-correct formatting issues

### Markdown Quality Checks
- `npm run markdown:lint` - Validate all markdown files
- `npm run markdown:fix` - Auto-fix formatting issues
- Included in `hygiene:quick` and `commit:check` scripts
- CI validates markdown on every push/PR

### Markdown Style Guidelines
- Use `-` for unordered lists
- Use `*` for emphasis, `**` for strong emphasis
- Use fenced code blocks with language tags
- Use `.` for ordered list markers
- Ensure all internal links are valid

## Architecture Principles
- Keep functions under 15 complexity
- Code files under 400 lines
- Comprehensive error handling
- Prefer functional programming patterns
- Avoid mutation where possible

## Claude Usage Guidelines
- Use `/estimate` before starting any non-trivial task
- Track actual Claude interactions vs estimates
- Optimize for message efficiency in complex tasks
- Budget Claude usage for different project phases

**Typical Usage Patterns**:
- **Bug Fix**: 10-30 messages
- **Small Feature**: 30-80 messages  
- **Major Feature**: 100-300 messages
- **Architecture Change**: 200-500 messages

## Collaboration Guidelines
- Always add Claude as co-author on commits
- Run `/hygiene` before asking for help
- Use `/todo` for quick task capture
- Document learnings with `/learn`
- Regular `/reflect` sessions for insights

## Project Standards
- Test coverage: 60% minimum
- Documentation: All features documented
- Error handling: Graceful failures with clear messages
- Performance: Monitor code complexity and file sizes
- ALWAYS use atomic commits
- use emojis, judiciously
- NEVER Update() a file before you Read() the file.

### TDD Examples

- [🔴 test: add failing test for updateCommandCatalog isolation (TDD RED)](../../commit/00e7a22)
- [🔴 test: add failing tests for tdd.js framework detection (TDD RED)](../../commit/2ce43d1)
- [🔴 test: add failing tests for learn.js functions (TDD RED)](../../commit/8b90d58)
- [🔴 test: add failing tests for formatBytes and estimateTokens (TDD RED)](../../commit/1fdac58)
- [🔴 test: add failing tests for findBrokenLinks (TDD RED phase)](../../commit/8ec6319)

## Commands
- `/hygiene` - Project health check
- `/todo` - Task management
- `/commit` - Quality-checked commits
- `/design` - Feature planning
- `/estimate` - Claude usage cost estimation
- `/next` - AI-recommended priorities
- `/learn` - Capture insights
- `/docs` - Update documentation