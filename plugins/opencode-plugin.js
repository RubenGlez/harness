// Harness plugin for OpenCode.
//
// Bridges the harness shell hooks (the same scripts Claude Code and Codex run)
// into OpenCode's tool lifecycle:
//
//   PreToolUse  Bash       → block-dangerous-git.sh, block-prototype-commit.sh
//   PostToolUse Write|Edit → lint-design.sh
//
// The scripts read a Claude Code hook payload on stdin and exit 2 to block,
// so this plugin translates OpenCode tool calls into that format instead of
// duplicating the checks.
//
// The SessionStart hook has no OpenCode equivalent; context injection is
// handled by the rules block in ~/.config/opencode/AGENTS.md instead.

import { homedir } from "node:os"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

export const HarnessPlugin = async () => {
  let harnessDir = ""
  try {
    harnessDir = readFileSync(join(homedir(), ".harness_dir"), "utf8").trim()
  } catch {}
  if (!harnessDir) return {}

  const runHook = (script, payload) => {
    try {
      return spawnSync("bash", [join(harnessDir, "scripts", "hooks", script)], {
        input: JSON.stringify(payload),
        encoding: "utf8",
      })
    } catch {
      return null
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return
      const payload = {
        tool_name: "Bash",
        tool_input: { command: output.args?.command ?? "" },
      }
      for (const script of ["block-dangerous-git.sh", "block-prototype-commit.sh"]) {
        const r = runHook(script, payload)
        if (r && r.status === 2) {
          throw new Error((r.stderr || `Blocked by harness hook ${script}`).trim())
        }
      }
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool !== "edit" && input.tool !== "write") return
      // Informational: exits 0 always, lints DESIGN.md to stderr.
      const filePath =
        input.args?.filePath ?? input.args?.file_path ?? output?.args?.filePath ?? ""
      runHook("lint-design.sh", {
        tool_name: input.tool === "edit" ? "Edit" : "Write",
        tool_input: { file_path: filePath },
      })
    },
  }
}
