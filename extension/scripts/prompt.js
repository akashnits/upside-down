// prompt.js — Compact agent-skill dispatch builder

/**
 * Build the Cowork prompt string for resume tailoring.
 * @param {Object} taskReference - Signed task details returned by the backend
 * @returns {string} The formatted Cowork prompt
 */
function buildCoworkPrompt(taskReference) {
    const task = {
        company: taskReference.company || 'Unknown',
        role: taskReference.role || 'Unknown',
        endpoint: taskReference.agentEndpoint,
        jobId: taskReference.jobId,
        taskToken: taskReference.taskToken,
    };

    return `Use the resume-tailor skill to execute this tailoring task. Do not create a
resume draft before invoking the skill. The skill will fetch the task and submit only a
Summary/Skills patch. The backend will copy the canonical base resume into the job folder,
apply and verify the patch, then rescore and update Notion.

Task reference:
${JSON.stringify(task, null, 2)}`;
}
