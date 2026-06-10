#!/usr/bin/env node
import { checkbox, select, Separator } from '@inquirer/prompts';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadSkills } from './scripts/load-skills.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortDesc(text: string, max = 80): string {
  if (!text) return '';
  const sentence = text.split(/\.\s/)[0];
  return sentence.length <= max ? sentence : text.slice(0, max) + '…';
}

function toTitle(id: string): string {
  return id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

interface HookDef {
  id: string;
  name: string;
  description: string;
}

// Workflow skills in chain order; everything else is a utility.
const WORKFLOW = ['ideate', 'product-plan', 'dev-plan', 'prototype', 'implement', 'qa', 'update-docs', 'ship'];

const HOOKS: HookDef[] = [
  { id: 'block-dangerous-git',    name: 'Block dangerous git',    description: 'Blocks force pushes, hard resets, and other destructive git ops before execution' },
  { id: 'block-prototype-commit', name: 'Block prototype commit', description: 'Prevents commits during /prototype to keep throwaway code out of history' },
  { id: 'lint-design',            name: 'Lint design docs',       description: 'Checks design document consistency after every Write or Edit' },
  { id: 'harness-gitignore',      name: 'Auto-update .gitignore', description: 'Adds common entries to .gitignore after file writes' },
  { id: 'harness-status',         name: 'Session status',         description: 'Prints harness state and active context at session start' },
  { id: 'handoff-nudge',          name: 'Handoff nudge',          description: 'Reminds you to run /handoff before stopping the agent' },
];

// ── Wizard ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n⚙️  Harness setup\n');

  const mode = await select({
    message: 'Installation mode',
    choices: [
      { name: 'Full install  —  everything, no questions', value: 'full' },
      { name: 'Custom        —  choose which components to install', value: 'custom' },
    ],
  });

  console.log('');

  const env: NodeJS.ProcessEnv = { ...process.env };

  if (mode === 'custom') {
    const skills = loadSkills(join(ROOT, 'skills'));

    const selectedSkills = await checkbox({
      message: 'Skills  (Codex — Claude always gets all skills via the plugin)',
      choices: [
        new Separator('── Workflow ──────────────────────────────────────'),
        ...skills
          .filter(s => WORKFLOW.includes(s.id))
          .sort((a, b) => WORKFLOW.indexOf(a.id) - WORKFLOW.indexOf(b.id))
          .map(s => ({
            name: toTitle(s.id),
            value: s.id,
            description: shortDesc(s.description),
            checked: true,
          })),
        new Separator('── Utilities ─────────────────────────────────────'),
        ...skills.filter(s => !WORKFLOW.includes(s.id)).map(s => ({
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

main().catch((err: unknown) => {
  if (err && typeof err === 'object' && (err as Record<string, unknown>).name === 'ExitPromptError') {
    console.log('\nCancelled.');
    process.exit(0);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
