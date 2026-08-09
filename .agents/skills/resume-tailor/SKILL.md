---
name: resume-tailor
description: Execute an Upside Down resume-tailoring task through the Base Resume patch lifecycle.
---

# Resume Tailor

Use this skill only when the user provides an Upside Down task reference with
`endpoint`, `jobId`, and `taskToken`.

Set `SKILL_ROOT` once before running commands. Prefer the global installation;
fall back to the checked-in project skill when working in this repository:

```sh
SKILL_ROOT="${CODEX_HOME:-$HOME/.codex}/skills/resume-tailor"
[ -d "$SKILL_ROOT" ] || SKILL_ROOT=".agents/skills/resume-tailor"
```

## Task lifecycle

1. Claim the task before creating any resume file or Google Doc. This validates
   the task and returns its immutable analysis brief plus the current Summary
   and complete Skills section from the canonical Base Resume.

   ```sh
   node "$SKILL_ROOT/scripts/task-client.js" claim \
     "<endpoint>" "<jobId>" "<taskToken>"
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
   Do not create, copy, import, or edit a Google Doc yourself.

4. Preserve every strong match. Add a `needs_confirmation` keyword only when it
   is in `analysisBrief.userSelections.confirmedKeywords`. Do not add excluded,
   unconfirmed, or unsupported experience.

5. Submit the patch. Do not update Notion or calculate the final ATS score yourself.
   The backend makes a native copy of the canonical Base Resume in:

   ```text
   Akash CVs / <Company> / <Role>_<JobId> / Akash_Raj
   ```

   It changes only Summary and Skills, reads the document back to verify the
   patch, then re-scores and updates Notion.

   ```sh
   node "$SKILL_ROOT/scripts/task-client.js" apply \
     "<endpoint>" "<jobId>" "<taskToken>" "/tmp/<jobId>-patch.json"
   ```

The response includes the finalized Google Doc URL and ATS score. The backend
verifies the submitted Summary and Skills against the copied Base Resume,
re-scores it with the saved rubric, and updates Notion.
Report its document URL and score to the user. If any lifecycle call fails, stop
and report the returned error instead of bypassing the task system.
