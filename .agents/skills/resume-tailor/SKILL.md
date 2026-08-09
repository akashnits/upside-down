---
name: resume-tailor
description: Execute an Upside Down resume-tailoring task through the builder-first task lifecycle.
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
   the task, returns its immutable analysis brief, and creates or reuses:

   ```text
   Akash CVs / <Company> / <Role>_<JobId>
   ```

   ```sh
   node "$SKILL_ROOT/scripts/task-client.js" claim \
     "<endpoint>" "<jobId>" "<taskToken>"
   ```

2. Read the returned `task`, `folderId`, and `outputName`. The task's
   `analysisBrief` is the source of truth for keyword priority, strong matches,
   and user selections.

3. Write `/tmp/<jobId>-patch.json` with exactly these fields:

   ```json
   {
     "summary": "...",
     "skills": [{ "label": "Languages", "value": "Java, ..." }]
   }
   ```

   `skills` must contain the complete final Skills section, not only additions.
   Use `$SKILL_ROOT/baseline_resume_data.js` as the canonical resume. Do not
   read, copy, or edit a base Google Doc.

4. Run the deterministic renderer. It clones every non-editable section from the
   baseline, applies only the patch, and writes a DOCX plus a renderer manifest.
   Install dependencies once when `docx` is unavailable:

   ```sh
   npm install --prefix "$SKILL_ROOT"
   node "$SKILL_ROOT/scripts/render-tailored-resume.js" \
     "/tmp/<jobId>-patch.json" "/tmp/<jobId>-Akash_Raj.docx" --fast
   ```

   The renderer reports `layoutRisk`. PDF visual QA is required when
   `layoutRisk.requiresVisualQa` is true. Otherwise the connector readback is
   the fast-path verification gate. If `--fast` rejects the patch because of
   layout risk, rerun without it and perform PDF visual QA.

5. Import the DOCX as a native Google Doc named with `outputName`, move it to
   the claimed `folderId`, and read the imported document through the Google Drive
   connector. Confirm the rendered Summary and every Skills row are present. Do
   not edit the imported Google Doc manually.

6. Preserve every strong match. Add a `needs_confirmation` keyword only when it
   is in `analysisBrief.userSelections.confirmedKeywords`. Do not add excluded,
   unconfirmed, or unsupported experience. The renderer guarantees no section
   outside Summary and Skills changes.

7. Complete the task with the final Google Doc URL and renderer manifest. Do not
   update Notion or calculate the final ATS score yourself.

   ```sh
   node "$SKILL_ROOT/scripts/task-client.js" complete \
     "<endpoint>" "<jobId>" "<taskToken>" "<documentUrl>" \
     "/tmp/<jobId>-Akash_Raj.docx.manifest.json"
   ```

The completion response verifies the rendered Summary and Skills against the
imported Google Doc, re-scores it with the saved rubric, and updates Notion.
Report its document URL and score to the user. If any lifecycle call fails, stop
and report the returned error instead of bypassing the task system.
