const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const updates = [];
const gmailDrafts = [];
const entry = { pageId: "page-1", tailoringTask: { jobId: "123", role: "Staff Software Engineer", company: "Microsoft", jobUrl: "https://www.linkedin.com/jobs/view/123", draftToken: "00000000-0000-4000-8000-000000000000" }, resumeUrl: "https://docs.google.com/document/d/resume-123/edit", recruiterEmail: null, systemState: null, systemStateBlockId: null };
const context = {
  PROPERTIES: { getProperty: key => key === "NOTION_API_KEY" ? "token" : null },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === "NOTION_API_KEY" ? "token" : null }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { sleep() {} },
  GmailApp: { createDraft: (to, subject, body, options) => { gmailDrafts.push({ to, subject, body, options }); return { getId: () => "gmail-draft-1" }; } },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ properties: { Email: { rich_text: [] } } }) }) },
  Logger: { log() {} },
  getNotionOptions: () => ({}),
  parseNotionResponse: (_response, _code, _message) => ({ properties: { Email: { rich_text: [] } } }),
  getNotionRichTextValue: property => (property && property.rich_text || []).map(item => item.plain_text || item.text?.content || "").join(""),
  buildNotionRichText: value => value ? [{ text: { content: value } }] : [],
  findNotionEntry: () => entry,
  updateNotionPage: (_pageId, data) => updates.push(data),
  resolveJobId: data => String(data.jobId),
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/tailoring.js", "utf8"), context);

assert.strictEqual(
  context.sanitizeJobUrl("https://careers.example.com/jobs/42?utm_source=linkedin&utm_medium=social&location=India#details"),
  "https://careers.example.com/jobs/42?location=India#details",
);

const result = context.normalizeRecruiterEmails([" Alice@Example.com ", "alice@example.com", "bob@example.com"]);
assert.deepStrictEqual(Array.from(result), ["alice@example.com", "bob@example.com"]);
assert.throws(() => context.normalizeRecruiterEmails(["not-an-email"]), /invalid/);
assert.throws(() => context.normalizeRecruiterContacts([{ name: "Alice", email: "other@example.com" }], ["alice@example.com"]), /not in emails/);

const contacts = context.normalizeRecruiterContacts([{ name: "Alice", email: "alice@example.com", provider: "AnyMail Finder", linkedinUrl: "https://linkedin.com/in/alice" }], ["alice@example.com"]);
assert.strictEqual(contacts[0].status, "verified");
assert.strictEqual(contacts[0].provider, "AnyMail Finder");

const regionalContacts = context.normalizeRecruiterContacts([{ name: "Teja", linkedinUrl: "https://in.linkedin.com/in/tejaparisineti" }], []);
assert.strictEqual(regionalContacts[0].linkedinUrl, "https://in.linkedin.com/in/tejaparisineti");
assert.throws(() => context.normalizeRecruiterContacts([{ name: "Alice", linkedinUrl: "https://evil.linkedin.com/in/alice" }], []), /LinkedIn URL is invalid/);

const outreach = context.saveTailoringOutreach({
  jobId: "123",
  outreach: {
    email: "Hi,\n\nI’m applying for the Staff Software Engineer role at Microsoft. I believe my background in distributed systems and Kafka aligns well with what you’re looking for in this role, particularly around reliable backend platforms.\n\nFit highlights\n- distributed systems\n- Kafka\n\nJob link: https://www.linkedin.com/jobs/view/123\n\nBest,\nAkash",
    fitHighlights: ["distributed systems", "Kafka"],
  },
});
assert.strictEqual(outreach.outreachSubject, "Application for Staff Software Engineer at Microsoft");
assert.strictEqual(updates.at(-1).outreachSubject, "Application for Staff Software Engineer at Microsoft");
assert.deepStrictEqual(Array.from(updates.at(-1).fitHighlights), ["distributed systems", "Kafka"]);
entry.outreachSubject = outreach.outreachSubject;
entry.outreachDraft = outreach.outreachDraft;
entry.recruiterEnrichment = "completed";
entry.recruiterContacts = [
  { name: "Alice", email: "alice@example.com", status: "verified" },
  { name: "Bob", email: "bob@example.com", status: "verified" },
];
const gmailDraft = context.createOutreachGmailDraft({ jobId: "123", draftToken: entry.tailoringTask.draftToken });
assert.strictEqual(gmailDraft.gmailDraft.to, "alice@example.com");
assert.deepStrictEqual(Array.from(gmailDraft.gmailDraft.bcc), ["bob@example.com"]);
assert.strictEqual(gmailDrafts[0].subject, "Application for Staff Software Engineer at Microsoft");
assert.strictEqual(gmailDrafts[0].options.bcc, "bob@example.com");
entry.gmailDraft = gmailDraft.gmailDraft;
assert.strictEqual(context.createOutreachGmailDraft({ jobId: "123", draftToken: entry.tailoringTask.draftToken }).alreadyCreated, true);
assert.throws(() => context.saveTailoringOutreach({
  jobId: "123",
  outreach: { email: "Hi [Name],\n\nFit highlights", fitHighlights: ["Kafka"] },
}), /begin with 'Hi,'/);

const noEmailResult = context.saveRecruiterEmails({
  jobId: "123",
  emails: [],
  contacts: [{ name: "Recruiter", linkedinUrl: "https://linkedin.com/in/recruiter", status: "not found" }],
});
assert.strictEqual(noEmailResult.recruiterEnrichment, "no_verified_email");
assert.strictEqual(updates.at(-1).recruiterEnrichment, "no_verified_email");

console.log("recruiter email endpoint validation tests passed");
