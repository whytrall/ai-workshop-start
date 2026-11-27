---
name: issue-to-pr
description: Turn a GitHub issue into a pull request that implements it, per AGENTS.md (spec first, tests for every case, tests pass locally). When the issue leaves a decision open, ask in Slack channel C0CN9267T32 and wait for a reply in that thread before implementing.
---

# Issue to PR

## Input
A GitHub issue: a URL (`https://github.com/<owner>/<repo>/issues/<n>`) or `<owner>/<repo>#<n>`, or just `<n>` if the repo is implied by the current checkout.

## Output
A pull request implementing the issue, opened against the repo's default branch.

## Steps

1. **Read the issue.** `gh issue view <n> --repo <owner>/<repo> --comments` — read the body and every comment, not just the title.

2. **Read the spec first.** Per `AGENTS.md`, read [`spec/`](../../../spec) before touching code. Figure out which spec file(s) the issue touches.

3. **Check for an open decision.** An issue leaves a decision open when it describes a problem or a goal but the issue (including its comments) does not pin down one of: the exact behavior for an edge case, which of two reasonable approaches to take, a name/format/flag to use, or similar — i.e. a reasonable implementer could make the change two different ways and the issue doesn't say which. If every needed decision is already settled by the issue, the spec, or AGENTS.md, skip to step 5.

4. **Ask in Slack, then wait for the reply.** When step 3 finds an open decision:
   - Post the question to channel `C0CN9267T32` using `SLACK_BOT_TOKEN`, with enough context to answer without opening the issue (issue link, the options, your recommendation if you have one):
     ```bash
     ts=$(curl -s -X POST https://slack.com/api/chat.postMessage \
       -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
       --data-urlencode "channel=C0CN9267T32" \
       --data-urlencode "text=<question, with the issue link and the options>" \
       | python3 -c "import sys,json;print(json.load(sys.stdin)['ts'])")
     ```
   - Poll the thread for a reply (a human, not the bot itself) rather than guessing. Back off; don't hammer the API:
     ```bash
     for i in $(seq 1 60); do
       reply=$(curl -s "https://slack.com/api/conversations.replies?channel=C0CN9267T32&ts=$ts" \
         -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
         | python3 -c "
import sys, json
d = json.load(sys.stdin)
msgs = [m for m in d.get('messages', []) if m.get('ts') != '$ts' and not m.get('bot_id')]
print(msgs[-1]['text'] if msgs else '')
")
       [ -n "$reply" ] && break
       sleep 30
     done
     ```
   - If no one replies after this polling window (~30 min), stop and tell the user directly — don't guess an answer and don't silently pick one side.
   - Use the reply to resolve the decision, and note it (with a link to the Slack thread, e.g. `https://<workspace>.slack.com/archives/C0CN9267T32/p<ts-no-dot>`) in the PR description.
   - One question per open decision. If more than one is open, ask them together in one message rather than one thread per decision, unless they're independent enough that answering out of order would help.

5. **Implement the change.** Update the relevant file(s) under `spec/` to match (AGENTS.md: "Update it with the code"), then implement.

6. **Write tests.** Add an integration test for every case the spec now describes that this change adds or affects (AGENTS.md: "Integration tests for every case in the spec"). Don't just test the happy path if the spec describes edge cases.

7. **Run the tests.** `npm test`. All tests must pass locally before opening the PR (AGENTS.md's definition of done). If something fails, fix it or stop and report — don't open a PR on red tests.

8. **Branch, commit, PR.**
   - If on the default branch, create a branch first.
   - Commit with the project's commit-message convention if one is configured (e.g. a `commits` skill), otherwise a normal concise message, and the attribution line(s) currently in effect for this session.
   - Push and open the PR with `gh pr create`, with a body that: summarizes the change, links the issue (`Closes #<n>`), and links the Slack thread if one was used for a decision.
   - Use the PR-description attribution line currently in effect for this session.

## Notes
- Don't fabricate an answer to an open decision to avoid the Slack round-trip — that's the one thing this skill exists to prevent.
- Don't post anything to Slack except the decision question itself (no unrelated content, no impersonating anyone).
- If `SLACK_BOT_TOKEN` isn't set, say so and stop at step 4 rather than skipping the question.
