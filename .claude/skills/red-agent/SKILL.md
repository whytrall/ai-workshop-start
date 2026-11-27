---
name: red-agent
description: Red-team the Skill Atlas web view. Start the server, attack it in a real browser (hostile input, odd URLs, escaping, layout, org page, server edge cases), and file one GitHub issue per confirmed bug, with reproduction steps and a screen recording, labelled "Delegated to AI". Finds and reports bugs only; never fixes them.
---

# Red agent

Break the web view (`./skill-atlas web`), then report every bug as its own GitHub issue. Do **not** fix anything, and do not change `src/`, `spec/` or `tests/`.

## Input
Optional focus (e.g. "search", "org page"). Default: the whole web view.

## What counts as a bug
Read [`spec/web.md`](../../../spec/web.md) (and `analysis.md` for ordering) first. A bug is observable behavior that contradicts the spec, or that crashes, hangs, leaks, breaks the layout, or is unsafe, where the spec is silent. Opinions about the 2003 look are not bugs. Each bug must reproduce **twice** before it is filed; drop flaky ones.

## Steps

1. **Set up tooling outside the repo** (don't touch `package.json`):
   ```bash
   T=/tmp/red-agent; mkdir -p $T/out && cd $T && npm init -y >/dev/null \
     && npm i playwright >/dev/null && npx playwright install --with-deps chromium
   ```
   Back in the repo: `npm ci`.

2. **Start the target** on a free port, local only: `./skill-atlas web 0` (read the printed URL). Use `fixture/` as the directory under test; keep any scratch repos under `/tmp`. Never attack anything but this local server. Org-page attacks against github.com stay light (few requests, no token abuse).

3. **Attack.** Drive Chromium with Playwright scripts in `$T` (not in the repo), and also `curl` for raw HTTP. Cover at least:
   - **Escaping / injection**: `<script>`, quotes, `</style>`, `"><img onerror>` in `repo`, `q`, `org`; in skill names/descriptions of a scratch repo with hostile `SKILL.md` files; CSS-escaping on the org page streamed styles.
   - **Search**: regex metacharacters (`.*`, `(`, `\`), unicode/case folding, whitespace, very long text, repeated params, highlight `<mark>` landing inside entities or across tags, counts `M of N`, numbering.
   - **Routing**: `/x`, `//`, `/org/`, `/index.html`, trailing slash, encoded paths, HEAD/POST (405), malformed percent-encoding, huge URLs, `repo=` empty vs. missing.
   - **Inputs**: nonexistent dir, a file, `..` paths, unreadable dir, symlink loops, repos with zero skills, bad front matter, duplicate skills (`also in`), non-GitHub URLs.
   - **Layout**: very long names/descriptions/URLs overflowing tables, narrow viewports, many skills, empty description, RTL text; screenshot each.
   - **Org page**: empty or invalid org, URL form vs. name, progress `<done> of <N>` / percent arithmetic, final summary counts, failures box, closing the page mid-stream, rate-limit message.
   - **Server**: port in use (exit code 1), port `0`, bind address, concurrent requests, crash on odd input (check the process is still alive afterward).
   For each suspicion, find the smallest reproduction.

4. **Record each confirmed bug** as a video: a fresh Playwright context with `recordVideo: { dir: '$T/out/<slug>', size: {width: 1024, height: 700} }`, a script that performs only the minimal repro steps with short `waitForTimeout`s so a human can follow, then `context.close()` to flush the `.webm`. Rename it `<slug>.webm`. Bugs with no visible browser behavior (crash, status code, exit code) still get a recording: a page showing the result, or a terminal-style page, is fine; include the exact `curl`/command output in the issue as well.

5. **Publish the evidence.** GitHub has no API for issue attachments, so put the videos on an orphan branch `red-agent-evidence` (create it from an empty tree in a temporary worktree, never on the working branch), under `<date>/<slug>.webm`, and push. Link as `https://github.com/<owner>/<repo>/blob/red-agent-evidence/<date>/<slug>.webm`. Videos are small, but keep each under ~5 MB (shorter clips, smaller size). Don't include secrets or tokens in anything recorded.

6. **Label.** Ensure it exists, once:
   ```bash
   gh label create "Delegated to AI" --color 5319e7 --description "Work handed to an AI agent" 2>/dev/null || true
   ```

7. **File one issue per bug** (never bundle; first `gh issue list --state all --search "<keywords>"` and skip duplicates):
   ```bash
   gh issue create --title "<short, specific symptom>" --label bug --label "Delegated to AI" --body-file body.md
   ```
   Body template:
   ```markdown
   ## Summary
   One sentence: what happens vs. what the spec says (quote and link the spec line).

   ## Steps to reproduce
   1. `./skill-atlas web 0`
   2. Open `<URL path and query>`
   3. …

   ## Expected
   ## Actual
   (include status code / output / console error)

   ## Video
   [<slug>.webm](<link>)

   ## Environment
   Commit `<sha>`, Node `<version>`, Chromium `<version>`.

   _Found by the red-agent skill._
   ```
   Keep titles about the symptom, not the cause. Do not propose a fix or edit code.

8. **Clean up**: stop the server, remove the worktree, confirm `git status` shows only intended changes. Report to the user a table of issues (number, title, severity) and anything suspicious you couldn't reproduce.

## Rules
- Report only; no fixes, no PRs.
- Local server only; no scanning of third-party hosts beyond the org page's normal GitHub calls.
- One bug, one issue, one video. Reproduced twice or not filed.
