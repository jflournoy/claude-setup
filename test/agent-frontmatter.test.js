const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const AGENT_DIR = path.join(__dirname, '..', 'agents');
const HOOK = path.join(__dirname, '..', 'hooks', 'reviewer-dispatch.js');
const { RULES } = require(HOOK);

const agentFiles = fs.readdirSync(AGENT_DIR).filter((f) => f.endsWith('.md'));

/**
 * Minimal frontmatter parse. Deliberately strict about the delimiters: the bug this
 * suite exists to prevent was a closing `---` glued onto the last key, which left the
 * block unterminated and silently stopped the agent loading.
 */
function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'file does not open with --- on its own line' };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { error: 'no closing --- on its own line' };
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return { fields };
}

describe('agent frontmatter', () => {
  it('finds agent files to check', () => {
    assert.ok(agentFiles.length > 0, 'no agents found');
  });

  for (const file of agentFiles) {
    describe(file, () => {
      const text = fs.readFileSync(path.join(AGENT_DIR, file), 'utf8');
      const { fields, error } = parseFrontmatter(text);

      it('has a properly delimited frontmatter block', () => {
        assert.strictEqual(error, undefined, `${file}: ${error}`);
      });

      it('declares the required name and description', () => {
        assert.ok(fields, `${file}: frontmatter did not parse`);
        assert.ok(fields.name, `${file}: missing required field "name"`);
        assert.ok(fields.description, `${file}: missing required field "description"`);
      });

      it('name matches the filename', () => {
        assert.strictEqual(fields.name, file.replace(/\.md$/, ''),
          `${file}: name must match filename, or the agent is addressed by a name that is not its own`);
      });

      it('name is lowercase and hyphenated', () => {
        assert.match(fields.name, /^[a-z][a-z0-9-]*$/,
          `${file}: name must be lowercase letters, digits and hyphens`);
      });

      it('does not use keys that stop an agent loading', () => {
        // `allowed-tools` is the slash-command key; `agent-type` is not a field at all.
        // Either one present means this agent silently fails to register.
        assert.strictEqual(fields['allowed-tools'], undefined,
          `${file}: uses allowed-tools; agents use "tools"`);
        assert.strictEqual(fields['agent-type'], undefined,
          `${file}: uses agent-type, which is not a subagent field`);
      });

      it('declares tools as a comma-separated string when present', () => {
        if (fields.tools === undefined) return; // optional: inherits all
        assert.ok(!fields.tools.startsWith('['),
          `${file}: tools should be "Read, Grep" not a YAML inline list`);
      });
    });
  }
});

describe('dispatch table points at agents that exist', () => {
  for (const rule of RULES) {
    it(`${rule.agent} has an agent file`, () => {
      const file = path.join(AGENT_DIR, `${rule.agent}.md`);
      assert.ok(fs.existsSync(file),
        `reviewer-dispatch routes to "${rule.agent}" but ${rule.agent}.md does not exist`);
    });
  }
});
