# Pull request to CALLE-AI/awesome-phone-call-agents

## Steps

```bash
git clone https://github.com/<your-fork>/awesome-phone-call-agents.git
cd awesome-phone-call-agents
python3 scripts/check_branch_name.py --branch feat/logistics-exception-skill
git switch -c feat/logistics-exception-skill
cp -r <docksignal>/community/awesome-phone-call-agents/skills/logistics-exception skills/
# add the README entry below under "### Skills" (keep the list order used by the repo)
python3 scripts/validate_repository.py
git add skills/logistics-exception README.md
git commit -m "feat(skills): add logistics-exception dock recovery skill"
git push -u origin feat/logistics-exception-skill
```

Before pushing, replace the placeholder repository URL in `skills/logistics-exception/SKILL.md` with the public DockSignal repository URL.

## README entry (under `### Skills`)

```markdown
- [`logistics-exception`](skills/logistics-exception/) - Resolves a missed dock window by calling the driver and receiving dock concurrently with one strict CALL-E result schema, reconciling terminal results by event id and re-fetch, combining only reached-contact facts into a recovery card, and gating any dock-changing follow-up call behind explicit human approval.
```

## PR title

```text
feat(skills): add logistics-exception dock recovery skill
```

## PR body

```markdown
## Summary

Adds `skills/logistics-exception`, a reusable Agent Skill for delayed-shipment dock exceptions. It packages the call plan, task templates, strict `recipient_result_schema`, idempotency/webhook reconciliation contract, and the deterministic decision table extracted from DockSignal (CALL-E: Your Code Is Calling submission, Most Practical Use Case).

## What it does

- Calls the driver and receiving dock (optionally carrier dispatch) concurrently, one CALL-E call task per contact, with per-contact idempotency keys.
- Uses one strict recipient schema with `unknown` enum values; empty strings and `unknown` stay unresolved.
- Reconciles `call.completed` / `call.failed` / `call.result_validation_failed` by `CALL-E-Event-Id` and `GET /v1/calls/{call_id}` before anything changes.
- Combines only reached-contact facts; disagreeing sources are labelled conflicted, vague ETAs are never converted to clock times.
- Suggests, but never places, the follow-up call that can change the dock appointment; that call requires explicit human approval.

## Side effects, credentials, cancellation

- Side effects: real outbound calls to operator-authorized numbers only; nothing is booked, priced, or confirmed automatically.
- Credentials: server-side `CALLE_API_KEY` only; never in the skill files.
- Cancellation: none after dispatch (Calls API has no cancel); waves are limited to confirmed contacts and never auto-repeated.
- Preview: the inspectable call plan plus `scripts/validate-result.mjs` for offline result checks. No fake results.

## Files

- `skills/logistics-exception/SKILL.md`
- `skills/logistics-exception/references/{safety.md,examples.md,result-schema.json}`
- `skills/logistics-exception/scripts/validate-result.mjs`
- `skills/logistics-exception/assets/{sample-incident.json,sample-result-driver.json,sample-result-vague.json}` (fictional NANP test-range numbers)
- README entry under Skills

## Validation

`python3 scripts/validate_repository.py` passes locally. Content is English; phone numbers are fictional.

## Related

- Devpost submission: <add URL>
- Demo video: <add URL>
- DockSignal repository: <add URL>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
