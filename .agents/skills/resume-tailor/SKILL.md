---
name: resume-tailor
description: Execute an Upside Down resume-tailoring task through the Base Resume patch lifecycle.
---

# Resume Tailor

Use this skill only when the user provides an Upside Down task reference with
`endpoint` and `jobId`.

Set `SKILL_ROOT` once before running commands. This repository's checked-in
skill is the source of truth for its Apps Script task contract; do not select a
globally installed `resume-tailor` skill, which may target a different API
version:

```sh
SKILL_ROOT=".agents/skills/resume-tailor"
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
   the finalized resume and JD. The backend derives the subject exactly as
   `Application for <Role> at <Company>`; do not provide a subject in the
   payload. Use this exact structure, replacing only the placeholders:

   ```text
   Hi,

   I’m applying for the <Role> role at <Company>. I believe my background in <relevant capabilities> aligns well with what you’re looking for in this role, particularly around <priority from the job description>.

   Fit highlights
   - <Relevant technology or domain 1>
   - <Relevant technology or domain 2>
   - <Relevant technology or domain 3>

   Job link: <task.applicationUrl, otherwise task.jobUrl>

   Best,
   Akash

   P.S. If you’re not the right person for this role, I’d appreciate it if you could point me to the appropriate recruiter.
   ```

   Keep the fit statement high-level and recruiter-readable: signal relevant
   capabilities and alignment, without arguing the full case or filling the
   paragraph with a technical list. Use 1–3 fit-highlight bullets containing
   only concise, relevant technologies or domains—not explanations, achievements,
   or full sentences. For example: `Agentic AI`, `Kafka`, `Distributed systems`.
   Save it as
   `/tmp/<jobId>-outreach.json`:

   ```json
   {
    "email": "Hi,\n\nI’m applying for the <Role> role at <Company>. I believe my background in <relevant capabilities> aligns well with what you’re looking for in this role, particularly around <priority from the job description>.\n\nFit highlights\n- <match 1>\n- <match 2>\n\nJob link: <task.applicationUrl or task.jobUrl>\n\nBest,\nAkash\n\nP.S. If you’re not the right person for this role, I’d appreciate it if you could point me to the appropriate recruiter.",
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
