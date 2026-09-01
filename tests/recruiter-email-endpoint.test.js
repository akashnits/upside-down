const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const updates = [];
const context = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === "NOTION_API_KEY" ? "token" : null }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { sleep() {} },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ properties: { Email: { rich_text: [] } } }) }) },
  Logger: { log() {} },
  getNotionOptions: () => ({}),
  parseNotionResponse: (_response, _code, _message) => ({ properties: { Email: { rich_text: [] } } }),
  getNotionRichTextValue: property => (property && property.rich_text || []).map(item => item.plain_text || item.text?.content || "").join(""),
  buildNotionRichText: value => value ? [{ text: { content: value } }] : [],
  findNotionEntry: () => ({ pageId: "page-1", tailoringTask: { jobId: "123" }, recruiterEmail: null, systemState: null, systemStateBlockId: null }),
  updateNotionPage: (_pageId, data) => updates.push(data),
  resolveJobId: data => String(data.jobId),
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/tailoring.js", "utf8"), context);

const result = context.normalizeRecruiterEmails([" Alice@Example.com ", "alice@example.com", "bob@example.com"]);
assert.deepStrictEqual(Array.from(result), ["alice@example.com", "bob@example.com"]);
assert.throws(() => context.normalizeRecruiterEmails(["not-an-email"]), /invalid/);
assert.throws(() => context.normalizeRecruiterContacts([{ name: "Alice", email: "other@example.com" }], ["alice@example.com"]), /not in emails/);

const contacts = context.normalizeRecruiterContacts([{ name: "Alice", email: "alice@example.com", provider: "AnyMail Finder", linkedinUrl: "https://linkedin.com/in/alice" }], ["alice@example.com"]);
assert.strictEqual(contacts[0].status, "verified");
assert.strictEqual(contacts[0].provider, "AnyMail Finder");

console.log("recruiter email endpoint validation tests passed");
