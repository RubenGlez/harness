#!/usr/bin/env node
import { checkbox, select, Separator } from '@inquirer/prompts';
import { spawnSync } from 'child_process';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFrontmatter(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

function shortDesc(text, max = 80) {
  if (!text) return '';
  const sentence = text.split(/\.\s/)[0];
  return sentence.length <= max ? sentence : text.slice(0, max) + '…';
}

function toTitle(id) {
  return id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ── Data ──────────────────────────────────────────────────────────────────────

const WORKFLOW_SKILLS = ['ideate', 'product-plan', 'dev-plan', 'prototype', 'implement', 'qa', 'update-docs'];

function loadSkills() {
  const dir = join(ROOT, 'skills');
  const meta = {};
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const md = join(dir, d.name, 'SKILL.md');
    if (!existsSync(md)) continue;
    meta[d.name] = { id: d.name, ...readFrontmatter(md) };
  }
  const order = [...WORKFLOW_SKILLS, 'migrate-docs', 'handoff', 'zoom-out'];
  const sorted = order.filter(id => meta[id]).map(id => meta[id]);
  const rest   = Object.keys(meta).filter(id => !order.includes(id)).map(id => meta[id]);
  return [...sorted, ...rest];
}

const HOOKS = [
  { id: 'block-dangerous-git',    name: 'Block dangerous git',    description: 'Blocks force pushes, hard resets, and other destructive git ops before execution' },
  { id: 'block-prototype-commit', name: 'Block prototype commit', description: 'Prevents commits during /prototype to keep throwaway code out of history' },
  { id: 'lint-design',            name: 'Lint design docs',       description: 'Checks design document consistency after every Write or Edit' },
  { id: 'harness-gitignore',      name: 'Auto-update .gitignore', description: 'Adds common entries to .gitignore after file writes' },
  { id: 'harness-status',         name: 'Session status',         description: 'Prints harness state and active context at session start' },
  { id: 'handoff-nudge',          name: 'Handoff nudge',          description: 'Reminds you to run /handoff before stopping the agent' },
];

const MCPS = [
  { id: 'agent-orchestrator', name: 'Agent orchestrator', description: 'Staged, parallel agent coordination across git worktrees (AFK mode)' },
  { id: 'agent-dashboard',    name: 'Agent dashboard',    description: 'Local dashboard for pipeline and worker visibility; auto-opens browser' },
];

// ── Wizard ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n⚙️  Harness setup\n');

  const mode = await select({
    message: 'Installation mode',
    choices: [
      { name: 'Full install  —  everything, no questions', value: 'full' },
      { name: 'Custom        —  choose which components to install', value: 'custom' },
    ],
  });

  console.log('');

  const env = { ...process.env };

  if (mode === 'custom') {
    const skills = loadSkills();

    const selectedSkills = await checkbox({
      message: 'Skills  (Codex — Claude always gets all skills via the plugin)',
      choices: [
        new Separator('── Workflow ──────────────────────────────────────'),
        ...skills.filter(s => WORKFLOW_SKILLS.includes(s.id)).map(s => ({
          name: toTitle(s.id),
          value: s.id,
          description: shortDesc(s.description),
          checked: true,
        })),
        new Separator('── Utilities ─────────────────────────────────────'),
        ...skills.filter(s => !WORKFLOW_SKILLS.includes(s.id)).map(s => ({
          name: toTitle(s.id),
          value: s.id,
          description: shortDesc(s.description),
          checked: true,
        })),
      ],
      pageSize: 15,
    });

    const selectedHooks = await checkbox({
      message: 'Hooks  (Codex — Claude always gets all hooks via the plugin)',
      choices: HOOKS.map(h => ({
        name: h.name,
        value: h.id,
        description: h.description,
        checked: true,
      })),
    });

    const selectedMCPs = await checkbox({
      message: 'MCP servers  (Codex — Claude always gets all MCPs via the plugin)',
      choices: MCPS.map(m => ({
        name: m.name,
        value: m.id,
        description: m.description,
        checked: true,
      })),
    });

    const other = await checkbox({
      message: 'Other components',
      choices: [
        { name: 'Rules',       value: 'rules',       description: 'Inject best-practice guidelines into ~/.claude/CLAUDE.md and ~/.agents/AGENTS.md', checked: true },
        { name: 'Status line', value: 'statusline',  description: 'Terminal status line showing git branch, model, context %, and rate limits', checked: true },
        { name: 'Codex CLI',   value: 'codex',       description: 'Sync skills and hooks to the Codex CLI', checked: true },
      ],
    });

    env.HARNESS_SKILLS = selectedSkills.join(',');
    env.HARNESS_HOOKS  = selectedHooks.join(',');
    env.HARNESS_MCPS   = selectedMCPs.join(',');
    if (!other.includes('rules'))      env.HARNESS_NO_RULES      = '1';
    if (!other.includes('statusline')) env.HARNESS_NO_STATUSLINE = '1';
    if (!other.includes('codex'))      env.HARNESS_NO_CODEX      = '1';
  }

  console.log('');
  const result = spawnSync('bash', [join(ROOT, 'scripts/setup-core.sh')], {
    env,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 0);
}

main().catch(err => {
  if (err?.name === 'ExitPromptError') { console.log('\nCancelled.'); process.exit(0); }
  console.error(err.message ?? err);
  process.exit(1);
});
