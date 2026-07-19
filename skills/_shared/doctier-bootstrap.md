# Doctier bootstrap

The canonical once-per-repo setup for tracking `.harness/` as age-encrypted blobs. Shared by `/ideate`, `/product-plan`, and `/migrate-docs` — the calling skill decides *when* to run it (and when to skip); this file is the *how*. Run every step in order.

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
