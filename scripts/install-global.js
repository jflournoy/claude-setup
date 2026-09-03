#!/usr/bin/env node
/**
 * Link this repo's agents and guides into ~/.claude so they apply in every project,
 * instead of being copied per project.
 *
 * Symlinks, not copies: editing the file here updates every project at once, and there
 * is exactly one source of truth. Nothing is written unless --apply is passed, nothing
 * that is not already a symlink to this repo is overwritten without --force, and
 * anything replaced is backed up first.
 *
 *   node scripts/install-global.js            # dry run: report what would change
 *   node scripts/install-global.js --apply    # do it
 *   node scripts/install-global.js --apply --force   # replace real files (backed up)
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

/** What gets linked, and where. Add a line here, not a special case below. */
function plannedLinks(repo = REPO) {
  const links = [];
  const agentDir = path.join(repo, '.claude', 'agents');
  if (fs.existsSync(agentDir)) {
    for (const f of fs.readdirSync(agentDir).filter((n) => n.endsWith('.md'))) {
      links.push({ src: path.join(agentDir, f), rel: path.join('agents', f) });
    }
  }
  for (const f of fs.readdirSync(repo)) {
    if (/^CLAUDE_[\w-]+\.md$/.test(f)) {
      links.push({ src: path.join(repo, f), rel: f });
    }
  }
  return links.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Classify what would happen at `dest` for `src`, without touching the filesystem.
 * Returns one of: 'create', 'already-linked', 'relink', 'conflict'.
 */
function classify(src, dest) {
  let st;
  try {
    st = fs.lstatSync(dest);
  } catch {
    return 'create';
  }
  if (st.isSymbolicLink()) {
    let target;
    try {
      target = fs.readlinkSync(dest);
    } catch {
      return 'relink';
    }
    return path.resolve(path.dirname(dest), target) === path.resolve(src)
      ? 'already-linked'
      : 'relink';
  }
  return 'conflict';
}

function backupPath(dest) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${dest}.backup-${stamp}`;
}

function plan(root, links) {
  return links.map((l) => {
    const dest = path.join(root, l.rel);
    return { ...l, dest, action: classify(l.src, dest) };
  });
}

function apply(entries, { force, log = console.log }) {
  let created = 0;
  let skipped = 0;
  for (const e of entries) {
    if (e.action === 'already-linked') { skipped += 1; continue; }
    if (e.action === 'conflict' && !force) {
      log(`  SKIP  ${e.rel} — a real file is already there; --force to replace (it will be backed up)`);
      skipped += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(e.dest), { recursive: true });
    if (e.action === 'conflict') {
      const b = backupPath(e.dest);
      fs.renameSync(e.dest, b);
      log(`  BACKUP ${e.rel} -> ${path.basename(b)}`);
    } else if (e.action === 'relink') {
      fs.unlinkSync(e.dest);
    }
    fs.symlinkSync(e.src, e.dest);
    log(`  LINK  ${e.rel}`);
    created += 1;
  }
  return { created, skipped };
}

function main(argv = process.argv.slice(2)) {
  const doApply = argv.includes('--apply');
  const force = argv.includes('--force');
  const root = path.join(os.homedir(), '.claude');

  const entries = plan(root, plannedLinks());
  console.log(`${doApply ? 'Installing' : 'Dry run —'} ${entries.length} item(s) into ${root}\n`);

  if (!doApply) {
    for (const e of entries) console.log(`  ${e.action.padEnd(14)} ${e.rel}`);
    const conflicts = entries.filter((e) => e.action === 'conflict').length;
    console.log('\nRe-run with --apply to make these links.');
    if (conflicts) {
      console.log(`${conflicts} real file(s) are in the way; --force replaces them after backing them up.`);
    }
    return 0;
  }

  const { created, skipped } = apply(entries, { force });
  console.log(`\nLinked ${created}, skipped ${skipped}.`);
  console.log('Nothing else in ~/.claude was touched.');
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { plannedLinks, classify, plan, apply, backupPath };
