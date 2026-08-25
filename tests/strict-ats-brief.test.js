const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = { Logger: { log() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/atsEngine.js", "utf8"), context);
vm.runInContext(fs.readFileSync("google-apps-script/analysis.js", "utf8"), context);

const rubric = {
  keywords: {
    required: [{ term: "Amazon Web Services", aliases: ["AWS"], weight: 1 }],
    preferred: [],
    nice_to_have: [],
  },
};
const ats = context.calculateATSScore(context.rubricToWeightedKeywords(rubric), "Built services on AWS.");
const brief = context.buildDeterministicBrief(ats, rubric, "Built services on AWS.");

assert.strictEqual(ats.score, 0);
assert.strictEqual(ats.evidenceScore, 100);
assert.deepStrictEqual(JSON.parse(JSON.stringify(brief.missingKeywords.required.map(item => item.keyword))), ["Amazon Web Services"]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(brief.recognizedEvidence.map(item => item.method))), ["synonym"]);

console.log("strict ATS brief test passed");
