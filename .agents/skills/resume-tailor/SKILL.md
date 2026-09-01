---
name: resume-tailor
description: Execute an Upside Down resume-tailoring task through the Base Resume patch lifecycle.
---

# Resume Tailor

Use this skill only when the user provides an Upside Down task reference with
`endpoint` and `jobId`.

Set `SKILL_ROOT` once before running commands. Prefer the global installation;
fall back to the checked-in project skill when working in this repository:

```sh
SKILL_ROOT="${CODEX_HOME:-$HOME/.codex}/skills/resume-tailor"
[ -d "$SKILL_ROOT" ] || SKILL_ROOT=".agents/skills/resume-tailor"
```

## Network access

Both lifecycle commands POST to the provided Apps Script endpoint. They require
outbound network access from the agent sandbox.

If either command reports `fetch failed`, do not treat it as a task failure and
do not recreate the task. Request narrowly scoped network permission for that
exact `node ... task-client.js` command, then retry the unchanged command once.
Only stop and report the error if the permission-backed retry also fails.

## Task lifecycle

1. Claim the task before creating any resume file or Google Doc. This validates
   the task and returns its immutable analysis brief plus the current Summary
   and complete Skills section from the canonical Base Resume.

   ```sh
   node "$SKILL_ROOT/scripts/task-client.js" claim \
     "<endpoint>" "<jobId>"
   ```

2. Read the returned `task`. `task.analysisBrief` is the source of truth for
   keyword priority, strong matches, and user selections. `task.editableContent`
   is the source of truth for the current Summary and complete final-Skills baseline.

3. Write `/tmp/<jobId>-patch.json` with exactly these fields:

   ```json
   {
     "summary": "...",
     "skills": [{ "label": "Languages", "value": "Java, ..." }]
   }
   ```

   `skills` must contain the complete final Skills section, not only additions.
   It must have exactly the same number of rows as
   `task.editableContent.skills`; consolidate additions into the existing rows
   instead of adding or removing a row. Do not create, copy, import, or edit a
   Google Doc yourself.

4. Preserve every strong match. Add a `needs_confirmation` keyword only when it
   is in `analysisBrief.userSelections.confirmedKeywords`. Do not add excluded,
   unconfirmed, or unsupported experience. For each term in
   `analysisBrief.userSelections.literalizeKeywords`, preserve the existing
   evidence but use the selected JD wording where it truthfully describes that
   same evidence; this is a wording change, not a new skill claim.

5. Submit the patch. Do not update Notion or calculate the final ATS score yourself.
   The backend makes a native copy of the canonical Base Resume in:

   ```text
   Akash CVs / <Company> / <Role>_<JobId> / Akash_Raj
   ```

   It changes only Summary and Skills, reads the document back to verify the
   patch, then re-scores and updates Notion.

   ```sh
   node "$SKILL_ROOT/scripts/task-client.js" apply \
     "<endpoint>" "<jobId>" "/tmp/<jobId>-patch.json"
   ```

6. After `apply` succeeds, draft a concise, evidence-backed cold email using
   the finalized resume and JD. Lead with the most relevant role-specific
   experience, not generic total years of experience. Connect one concrete,
   verified achievement or capability to the JD's most important requirement.
   Keep it under 70 words before the sign-off and PS, include 1-3 short fit
   highlights, and end with a separate PS asking the recipient to forward you
   to the right person if they are not the recruiter for the role. Format it
   as plain text with blank lines between greeting, body, sign-off, and PS;
   do not use markdown bullets or a subject line. Save it as
   `/tmp/<jobId>-outreach.json`:

   ```json
   {
     "email": "Hi [Name],\n\nI’m interested ...\n\nBest,\nAkash\n\nP.S. If you’re not the recruiter ...",
     "fitHighlights": ["distributed systems", "Kafka platforms", "AWS backend"]
   }
   ```

   Use the exact evidence from the finalized resume; do not invent metrics or
   experience. Submit it with:

   ```sh
   node "$SKILL_ROOT/scripts/task-client.js" outreach \
     "<endpoint>" "<jobId>" "/tmp/<jobId>-outreach.json"
   ```

The `apply` response includes the finalized Google Doc URL and ATS score. The backend
verifies the submitted Summary and Skills against the copied Base Resume,
re-scores it with the saved rubric, and updates Notion.
Report its document URL and score to the user. For backend lifecycle errors,
stop and report the returned error instead of bypassing the task system. Treat
the first `fetch failed` error as the network-permission case described above.
