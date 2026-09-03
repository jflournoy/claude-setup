const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'reviewer-dispatch.js');
const { agentFor, filePathFrom, buildOutput, RULES } = require(HOOK);

const run = (stdin, env = {}) =>
  execFileSync('node', [HOOK], {
    input: stdin, encoding: 'utf8', env: { ...process.env, ...env }
  });

describe('reviewer dispatch', () => {
  describe('agentFor: the routing table', () => {
    it('routes Stan models to the stan reviewer', () => {
      assert.strictEqual(agentFor('/p/m.stan').agent, 'stan-reviewer');
      assert.strictEqual(agentFor('m.STAN').agent, 'stan-reviewer');
    });

    it('routes R and literate-analysis files to the R reviewer', () => {
      for (const f of ['a.R', 'a.r', 'a.Rmd', 'a.rmd', 'report.qmd']) {
        assert.strictEqual(agentFor(f).agent, 'r-analysis-reviewer', `failed on ${f}`);
      }
    });

    it('returns null for file types with no reviewer', () => {
      for (const f of ['notes.txt', 'a.py', 'a.js', 'Makefile', 'data.csv']) {
        assert.strictEqual(agentFor(f), null, `should not match ${f}`);
      }
    });

    it('does not match an extension appearing mid-path', () => {
      // A directory named .stan must not trigger on an unrelated file inside it.
      assert.strictEqual(agentFor('/proj/model.stan/notes.txt'), null);
    });

    it('ignores dotfiles', () => {
      assert.strictEqual(agentFor('/p/.hidden.R'), null);
    });

    it('handles absent or non-string input without throwing', () => {
      for (const v of [null, undefined, '', 42, {}, []]) {
        assert.strictEqual(agentFor(v), null);
      }
    });

    it('keeps the auto-fire list small on purpose', () => {
      // Guards the solo-context decision: every rule costs context on every edit.
      assert.ok(RULES.length <= 4, `auto-fire rules grew to ${RULES.length}; justify or split`);
    });
  });

  describe('filePathFrom: payload shapes', () => {
    it('reads tool_input.file_path', () => {
      assert.strictEqual(filePathFrom({ tool_input: { file_path: '/a.R' } }), '/a.R');
    });
    it('falls back to tool_response.filePath', () => {
      assert.strictEqual(filePathFrom({ tool_response: { filePath: '/b.R' } }), '/b.R');
    });
    it('prefers tool_input when both are present', () => {
      assert.strictEqual(
        filePathFrom({ tool_input: { file_path: '/a.R' }, tool_response: { filePath: '/b.R' } }),
        '/a.R');
    });
    it('returns null for junk payloads', () => {
      for (const v of [null, undefined, 'string', 7, {}]) {
        assert.strictEqual(filePathFrom(v), null);
      }
    });
  });

  describe('buildOutput: hook contract', () => {
    it('emits the PostToolUse shape Claude Code expects', () => {
      const out = buildOutput({ tool_input: { file_path: '/p/m.stan' } });
      assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUse');
      assert.match(out.hookSpecificOutput.additionalContext, /stan-reviewer/);
      assert.match(out.hookSpecificOutput.additionalContext, /\/p\/m\.stan/);
    });
    it('says the reviewer reports rather than edits', () => {
      const out = buildOutput({ tool_input: { file_path: '/a.R' } });
      assert.match(out.hookSpecificOutput.additionalContext, /does not edit/);
    });
    it('returns null when nothing matches', () => {
      assert.strictEqual(buildOutput({ tool_input: { file_path: '/a.txt' } }), null);
    });
  });

  describe('end to end: fails open, never blocks an edit', () => {
    it('emits JSON for a matching file', () => {
      const out = run('{"tool_input":{"file_path":"/p/m.stan"}}');
      assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /stan-reviewer/);
    });
    it('emits nothing for a non-matching file', () => {
      assert.strictEqual(run('{"tool_input":{"file_path":"/p/a.txt"}}').trim(), '');
    });
    it('exits 0 and stays silent on malformed JSON', () => {
      assert.strictEqual(run('not json at all').trim(), '');
    });
    it('exits 0 and stays silent on empty stdin', () => {
      assert.strictEqual(run('').trim(), '');
    });
    it('honors CLAUDE_REVIEWER_DISPATCH=0', () => {
      const out = run('{"tool_input":{"file_path":"/p/m.stan"}}', { CLAUDE_REVIEWER_DISPATCH: '0' });
      assert.strictEqual(out.trim(), '');
    });
  });
});
