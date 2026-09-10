# Pull request to CALLE-AI/awesome-phone-call-agents

The Devpost form asks for a **Project submission pull request URL**: an opened PR into the upstream `CALLE-AI/awesome-phone-call-agents` repository (a PR in your own fork does not count). It does not need to be merged before the deadline, 2026-09-14 15:45 UTC.

The PR contributes the reusable `skills/logistics-exception` skill. The DockSignal app itself stays in its own public repository and is linked from the skill. It is not copied under `apps/`, because the upstream checklist expects runnable apps to default to a no-call path, and DockSignal deliberately has no mock or no-call mode.

## Prerequisites

1. DockSignal pushed to a **public** GitHub repository. You need its URL.
2. A GitHub account with a fork of `CALLE-AI/awesome-phone-call-agents`.
3. Optional but recommended before opening: the Devpost project URL and the public demo video URL, so the PR body has no placeholders.

## Steps

Run in Git Bash. The clone needs long paths enabled on Windows.

```bash
git -c core.longpaths=true clone https://github.com/<your-user>/awesome-phone-call-agents.git
cd awesome-phone-call-agents
git config core.longpaths true
git remote add upstream https://github.com/CALLE-AI/awesome-phone-call-agents.git
git fetch upstream && git reset --hard upstream/main
python3 scripts/check_branch_name.py --branch feat/logistics-exception-skill
git switch -c feat/logistics-exception-skill

cp -r <path-to-docksignal>/community/awesome-phone-call-agents/skills/logistics-exception skills/
sed -i 's#DOCKSIGNAL_REPO_URL#https://github.com/<your-user>/<docksignal-repo>#' skills/logistics-exception/SKILL.md
grep -rn "DOCKSIGNAL_REPO_URL" skills/logistics-exception && echo "STOP: placeholder still present" || echo "placeholder replaced"
```

Add the README entry below as the last line of the `### Skills` list (immediately before `### Apps`), then validate and push:

```bash
python3 scripts/validate_repository.py
git add skills/logistics-exception README.md
git commit -m "feat(skills): add logistics-exception dock recovery skill"
git push -u origin feat/logistics-exception-skill
```

Open the PR from your fork's branch against `CALLE-AI/awesome-phone-call-agents:main` with the title and body below, then paste the PR URL into Devpost.

## README entry (under `### Skills`)

```markdown
- [`logistics-exception`](skills/logistics-exception/) - Resolves a missed dock window by calling the driver and receiving dock concurrently with one strict CALL-E result schema, reconciling terminal results by event id and re-fetch, combining only reached-contact facts into a recovery card, and gating any dock-changing follow-up call behind explicit human approval.
```

## PR title

```text
feat(skills): add logistics-exception dock recovery skill
```

## PR body (follows the upstream pull request template)

```markdown
## Summary

Adds `skills/logistics-exception`, a reusable Agent Skill for delayed-shipment dock exceptions, plus its README awesome-list entry. It packages the call plan, task templates, strict `recipient_result_schema`, the idempotency and webhook reconciliation contract, and the deterministic decision table from DockSignal, a CALL-E: Your Code Is Calling submission (<DockSignal repository URL>).

When a delivery misses its dock window, the skill calls the driver and the receiving dock concurrently (optionally carrier dispatch), one CALL-E call task per contact with a stable per-contact idempotency key. Terminal events are deduplicated by `CALL-E-Event-Id` and re-fetched with `GET /v1/calls/{call_id}` before anything changes. Only facts from reached contacts are combined: empty strings and `unknown` stay unresolved, disagreeing sources are labelled conflicted, and vague ETAs are never converted to clock times. The follow-up call that could change the dock appointment is suggested, never placed, until a human approves it.

## Type

- [x] New skill
- [ ] New runnable app
- [ ] New workflow plugin
- [ ] New provider adapter
- [ ] New scheduler recipe
- [x] README awesome-list entry
- [ ] Safety or documentation update
- [ ] Validation or tooling update

## Checklist

- [x] Repository-facing content is written in English.
- [x] Branch name, commit messages, and PR title follow `docs/git-naming-conventions.md`.
- [x] No secrets, tokens, private phone numbers, call recordings, or private transcripts are included.
- [x] Real-world side effects are clearly described.
- [x] Phone numbers are masked in documentation and test fixtures unless they are clearly fictional.
- [x] Recurring workflows include cancellation behavior.
- [x] Runnable code has a dry-run, fake-server, or no-call path by default.
- [x] `python3 scripts/validate_repository.py` passes.

## Side effects, credentials, cancellation

- Side effects: real outbound calls to operator-authorized numbers only. Nothing is booked, priced, or confirmed automatically; the dock-changing follow-up needs explicit human approval.
- Credentials: server-side `CALLE_API_KEY` only; none in the skill files.
- Cancellation: the Calls API has no cancel endpoint, so waves are limited to the contacts confirmed in the plan and never repeated automatically. The workflow is not recurring.
- No-call path: the only runnable code in the skill, `scripts/validate-result.mjs`, checks a result offline with no network or credentials. Sample numbers use the fictional `+1 500 555 01xx` range.

## Links

- DockSignal repository: <add URL>
- Devpost project: <add URL>
- Demo video: <add URL>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
