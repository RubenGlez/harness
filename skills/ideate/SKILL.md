---
name: ideate
description: Research a product idea on the web to assess market viability, identify competitors, and produce a go/no-go verdict. Use as the very first step when you have a new product idea, before product-plan.
---

# Ideate

## Step 1: Capture the idea

If the user has already described their idea in the conversation, use that. Otherwise ask one question:

> "Describe the product you want to build in one sentence — what it does and who it's for."

## Step 2: Research

Search the web systematically. Read the top results in full for each search — don't skim.

**Competitor discovery**
- Search `[keyword] app`, `[keyword] tool`, `[keyword] software`
- Search `[keyword] site:producthunt.com`, `[keyword] site:github.com`
- Search `best [keyword] alternative`, `open source [keyword]`
- For each competitor found: what it does, who it targets, pricing model, main limitation, approximate user base or GitHub stars

**User pain signals**
- Search `[keyword] reddit`, `[keyword] site:news.ycombinator.com`
- Look for "I wish [existing tool] could...", "why is there no tool that..."
- Note the recurring complaints users have with existing solutions — these are the real gaps

**Market saturation**
- How many serious competitors exist? Are they well-funded, indie, or abandoned?
- Is the open-source space active (recent commits, high stars) or stale?
- Are there multiple funded startups? One dominant player? A fragmented market?

## Step 3: Synthesize

Assess across four dimensions:

**Saturation** — how crowded is the space? Is it dominated by one player, fragmented, or wide open?

**Gap** — what do users consistently complain about that no existing solution addresses? Be specific.

**Differentiation potential** — what angle could give this product a real edge — not a marginal improvement but a meaningfully different approach?

**Viability** — is the problem real, frequent, and worth solving? Would people pay for it, use it daily, or recommend it?

Produce a verdict:
- **go** — clear gap, realistic differentiation, winnable path
- **conditional go** — opportunity exists but depends on specific assumptions being true; name them
- **no-go** — saturated, no clear gap, or problem not strong enough to build on

## Step 4: Write docs

### Doctier bootstrap (once per repo)

`.harness/` is tracked in git as age-encrypted blobs via doctier. If `.doctier.yml` exists at the repo root, skip this — the repo is already set up. If `.harness/` already exists but is gitignored (a pre-doctier project), follow the adoption recipe in the migrate-docs skill's REFERENCE.md instead. Otherwise:

1. Check the binary: `command -v doctier`. If missing, STOP and tell the user: "harness doc skills require doctier. Install it with `brew tap RubenGlez/doctier https://github.com/RubenGlez/doctier && brew install doctier`, or without Homebrew: `curl -fsSL https://raw.githubusercontent.com/RubenGlez/doctier/main/install.sh | sh`. Then re-run this skill." Do not write `.harness/` docs without it.
2. Write `.doctier.yml` at the repo root (if the rules change later, re-run `doctier init` — it syncs the managed `.gitattributes`/`.gitignore` blocks):

   ```yaml
   version: 1

   # .harness/ is the private doc store: encrypted in git, decrypted on checkout.
   # Prototype/spike code is sensitive scratch: never committed, dies with the worktree.
   docs:
     - path: ".harness/**"
       visibility: private
       lifetime: durable

     - path: "**/_prototype-*"
       visibility: private
       lifetime: ephemeral
       sensitive: true

     - path: "**/_spike/**"
       visibility: private
       lifetime: ephemeral
       sensitive: true

   recipients_file: .doctier/recipients.txt
   ```

3. Run `doctier init` (configures the git filter and decrypted-diff textconv, writes the managed attribute/ignore blocks, installs pre-commit, pre-push, and post-merge hooks).
4. Run `doctier grant "$(cat "${DOCTIER_SSH_KEY:-$HOME/.ssh/id_ed25519}.pub")"`.
5. If `.gitignore` has a legacy standalone `.harness/` line, delete that line.
6. Protect the policy files: `.doctier.yml`, `.doctier/recipients.txt`, and `.gitattributes` are tracked, unauthenticated files — anyone with commit access can reclassify a private path as public or add their own key. Add CODEOWNERS entries for those three paths assigning the repo owner (create `.github/CODEOWNERS` if absent), and treat any diff to them as a security review.
7. Verify with `doctier check`, then commit the scaffolding: `git add .doctier.yml .doctier/ .gitattributes .gitignore .github/CODEOWNERS && git commit -m "chore: adopt doctier for .harness/ docs"`.

### Write `.harness/product/idea.md`

Create the directory if it doesn't exist.

```
# Idea: [Name]

## Concept
One sentence: what it does and who it's for.

## Problem
The specific pain being solved. Who feels it, how often, how they deal with it today.

## Market landscape

### Existing solutions
| Solution | What it does | Main weakness | Stars / traction |
|----------|-------------|---------------|------------------|
| [name]   | ...         | ...           | ...              |

### Market saturation
[low / medium / high] — one paragraph on why.

### User pain signals
The recurring complaints found in forums, communities, and discussions.

### Opportunity
The specific gap that exists and why existing solutions don't fill it.

## Viability assessment

**Verdict**: go / conditional go / no-go

**Reasons**
1. ...
2. ...
3. ...

**Key assumptions to validate**
- [assumption] — how to test it cheaply

## Sources
- [URL] — what it contributed to the analysis
```

After writing, refresh the doc index and commit — worktrees and future sessions only see committed `.harness/` content:

```bash
doctier agents --write
git add .harness AGENTS.md && git commit -m "docs: capture idea research"
```

Then share the verdict and key findings with the user. Recommend the next step:
- go / conditional go: "Run /product-plan to define the full product vision."
- no-go: explain what would need to change to reconsider.
