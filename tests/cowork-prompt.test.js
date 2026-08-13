const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync("extension/scripts/prompt.js", "utf8"), context);

const prompt = context.buildCoworkPrompt({
  company: "Palo Alto Networks",
  role: "Sr Staff Software Engineer",
  agentEndpoint: "https://script.google.com/macros/s/example/exec",
  jobId: "4450120692",
  taskToken: "task-token",
});

assert.ok(prompt.includes('"company": "Palo Alto Networks"'));
assert.ok(prompt.includes('"role": "Sr Staff Software Engineer"'));
assert.ok(prompt.indexOf('"company"') < prompt.indexOf('"jobId"'));

console.log("cowork prompt tests passed");
