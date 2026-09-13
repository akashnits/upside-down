---
name: draft-outreach
description: Create one unsent Gmail draft for a tailored job after verified contact enrichment is complete.
---

# Draft Outreach

Use this only after `enrich-recruiters` has completed for the exact tailoring
task. The task must provide `endpoint`, `jobId`, and `draftToken`.

Create exactly one Gmail draft through the task client:

```sh
node .agents/skills/resume-tailor/scripts/task-client.js drafts \
  "<endpoint>" "<jobId>" "<draftToken>"
```

The backend derives the verified recipients, saved subject, and saved cold-email
body. It puts the first verified contact in `To` and all remaining verified
contacts in `Bcc`. It never sends an email. A repeated command for the same
tailoring task returns the existing draft instead of creating another one.

If enrichment found no verified contact, do not invoke this skill. Report that
there is no recipient for a Gmail draft.
