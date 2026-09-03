const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { plannedLinks, classify, plan, apply } = require('../scripts/install-global.js');

let tmp, repo, root;
const mk = (p, body = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-global-'));
  repo = path.join(tmp, 'repo');
  root = path.join(tmp, 'home', '.claude');
  fs.mkdirSync(root, { recursive: true });
  mk(path.join(repo, '.claude', 'agents', 'alpha.md'), '---\nname: alpha\n---\n');
  mk(path.join(repo, '.claude', 'agents', 'beta.md'), '---\nname: beta\n---\n');
  mk(path.join(repo, '.claude', 'agents', 'notes.txt'), 'ignored');
  mk(path.join(repo, 'CLAUDE_voice.md'), 'voice');
  mk(path.join(repo, 'CLAUDE.md'), 'not a guide');
  mk(path.join(repo, 'README.md'), 'no');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('install-global', () => {
  describe('plannedLinks', () => {
    it('links agent markdown and CLAUDE_* guides', () => {
      const rels = plannedLinks(repo).map((l) => l.rel).sort();
      assert.deepStrictEqual(rels, ['CLAUDE_voice.md', 'agents/alpha.md', 'agents/beta.md'].sort());
    });
    it('excludes non-markdown in the agent dir', () => {
      assert.ok(!plannedLinks(repo).some((l) => l.rel.endsWith('notes.txt')));
    });
    it('excludes CLAUDE.md itself, which is project-scoped', () => {
      assert.ok(!plannedLinks(repo).some((l) => l.rel === 'CLAUDE.md'));
    });
  });

  describe('classify', () => {
    it('reports create when nothing is there', () => {
      assert.strictEqual(classify(path.join(repo, 'CLAUDE_voice.md'), path.join(root, 'CLAUDE_voice.md')), 'create');
    });
    it('reports already-linked for a correct existing symlink', () => {
      const src = path.join(repo, 'CLAUDE_voice.md');
      const dest = path.join(root, 'CLAUDE_voice.md');
      fs.symlinkSync(src, dest);
      assert.strictEqual(classify(src, dest), 'already-linked');
    });
    it('reports relink for a symlink pointing elsewhere', () => {
      const dest = path.join(root, 'CLAUDE_voice.md');
      fs.symlinkSync(path.join(repo, 'README.md'), dest);
      assert.strictEqual(classify(path.join(repo, 'CLAUDE_voice.md'), dest), 'relink');
    });
    it('reports conflict for a real file', () => {
      const dest = path.join(root, 'CLAUDE_voice.md');
      mk(dest, 'someone real wrote this');
      assert.strictEqual(classify(path.join(repo, 'CLAUDE_voice.md'), dest), 'conflict');
    });
  });

  describe('apply', () => {
    const quiet = () => {};

    it('creates the links', () => {
      const res = apply(plan(root, plannedLinks(repo)), { force: false, log: quiet });
      assert.strictEqual(res.created, 3);
      assert.ok(fs.lstatSync(path.join(root, 'agents', 'alpha.md')).isSymbolicLink());
      assert.strictEqual(fs.readFileSync(path.join(root, 'CLAUDE_voice.md'), 'utf8'), 'voice');
    });

    it('is idempotent', () => {
      apply(plan(root, plannedLinks(repo)), { force: false, log: quiet });
      const second = apply(plan(root, plannedLinks(repo)), { force: false, log: quiet });
      assert.strictEqual(second.created, 0);
      assert.strictEqual(second.skipped, 3);
    });

    it('refuses to clobber a real file without --force', () => {
      const dest = path.join(root, 'CLAUDE_voice.md');
      mk(dest, 'precious');
      apply(plan(root, plannedLinks(repo)), { force: false, log: quiet });
      assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'precious');
      assert.ok(!fs.lstatSync(dest).isSymbolicLink());
    });

    it('backs up before replacing with --force', () => {
      const dest = path.join(root, 'CLAUDE_voice.md');
      mk(dest, 'precious');
      apply(plan(root, plannedLinks(repo)), { force: true, log: quiet });
      assert.ok(fs.lstatSync(dest).isSymbolicLink());
      const backups = fs.readdirSync(root).filter((f) => f.startsWith('CLAUDE_voice.md.backup-'));
      assert.strictEqual(backups.length, 1, 'exactly one backup should exist');
      assert.strictEqual(fs.readFileSync(path.join(root, backups[0]), 'utf8'), 'precious');
    });

    it('leaves unrelated files in ~/.claude alone', () => {
      mk(path.join(root, 'settings.json'), '{"keep":true}');
      mk(path.join(root, 'memory', 'MEMORY.md'), 'remembered');
      apply(plan(root, plannedLinks(repo)), { force: true, log: quiet });
      assert.strictEqual(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), '{"keep":true}');
      assert.strictEqual(fs.readFileSync(path.join(root, 'memory', 'MEMORY.md'), 'utf8'), 'remembered');
    });
  });
});
