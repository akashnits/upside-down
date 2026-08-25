const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = { Logger: { log() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/atsEngine.js", "utf8"), context);
vm.runInContext(fs.readFileSync("google-apps-script/analysis.js", "utf8"), context);

const rubric = context.normalizeRubric({
  required: [
    { type: "keyword", term: "Java", aliases: ["Core Java"] },
    { type: "alternative", term: "Public cloud provider", alternatives: ["AWS", "Microsoft Azure", "Google Cloud Platform"] },
    { type: "eligibility", term: "8+ years experience", criterion: { kind: "min_years_experience", minimum: 8 } },
  ],
  preferred: [
    { type: "eligibility", term: "Technical degree", criterion: { kind: "technical_degree" } },
  ],
}, "fixture");

assert.strictEqual(rubric.version, "2");
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.rubricToWeightedKeywords(rubric).map(item => item.term))), [
  "Java",
  "Public cloud provider",
]);

const score = context.calculateATSScore(
  context.rubricToWeightedKeywords(rubric),
  "12+ years of experience. EDUCATION\nB.Tech - Electronics Engineering\nSKILLS\nCore Java, AWS",
);
assert.strictEqual(score.score, 100);
assert.strictEqual(score.evidenceScore, 100);

assert.deepStrictEqual(JSON.parse(JSON.stringify(context.evaluateEligibilitySignals(
  rubric,
  "12+ years of experience. EDUCATION\nB.Tech - Electronics Engineering",
))), [
  {
    requirement: "8+ years experience",
    tier: "required",
    kind: "min_years_experience",
    status: "met",
    observedValue: 12,
    minimum: 8,
  },
  {
    requirement: "Technical degree",
    tier: "preferred",
    kind: "technical_degree",
    status: "met",
  },
]);

console.log("rubric requirement tests passed");
