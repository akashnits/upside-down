---
name: resume-tailor
description: Execute an Upside Down resume-tailoring task from a signed task reference. Use for creating, validating, and completing a tailored resume through the Apps Script task lifecycle.
---

# Resume Tailor

Use this skill only when the user provides an Upside Down task reference with
`endpoint`, `jobId`, and `taskToken`.

## Task lifecycle

1. Fetch the immutable task.

   ```sh
   node .agents/skills/resume-tailor/scripts/task-client.js get \
     "<endpoint>" "<jobId>" "<taskToken>"
   ```

2. Start the task before creating any resume file or Google Doc. This creates or
   reuses the task's existing Drive location:

   ```text
   Akash CVs / <Company> / <Role>_<JobId> / Akash_Raj
   ```

   ```sh
   node .agents/skills/resume-tailor/scripts/task-client.js start \
     "<endpoint>" "<jobId>" "<taskToken>"
   ```

3. Read the returned task and draft URL. The task's `analysisBrief` is the source
   of truth for keyword priority, strong matches, and user selections.

4. Read `resume_builder.js` from Downloads, copy it into the working directory if
   needed, and create `data_<company>.js` that calls `buildResume()`. Preserve the
   existing resume's fonts, spacing, date alignment, styling, and section layout.

5. Modify only these sections:

   - Professional Summary / Objective
   - Skills / Technologies

   Preserve all strong matches. Add a `needs_confirmation` keyword only when it is
   in `analysisBrief.userSelections.confirmedKeywords`. Never add excluded,
   unconfirmed, or unsupported experience.

6. Validate before completion:

   - Selected supported keywords use their exact canonical term or approved alias.
   - No keyword stuffing or unsupported claims were introduced.
   - No section outside Summary and Skills changed.
   - The final Google Doc is inside the task's job folder and is visually checked
     in Google Docs-friendly format.

7. Complete the task using the final Google Doc URL. Do not update Notion or
   calculate the final ATS score yourself.

   ```sh
   node .agents/skills/resume-tailor/scripts/task-client.js complete \
     "<endpoint>" "<jobId>" "<taskToken>" "<documentUrl>"
   ```

The completion response is authoritative. It validates the document, re-scores it
against the saved rubric, and updates Notion. Report its document URL and score to
the user. If any lifecycle call fails, stop and report the returned error instead
of bypassing the task system.
