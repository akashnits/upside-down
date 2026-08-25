const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = { Logger: { log() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/analysis.js", "utf8"), context);

const options = context.buildConfirmationOptions({
  missingKeywords: {
    required: [{ keyword: "Kafka", expectedGain: 5 }, { keyword: "Java", expectedGain: 4 }],
    preferred: [{ keyword: "Kubernetes", expectedGain: 2.5 }],
    nice_to_have: [{ keyword: "GraphQL", expectedGain: 1 }],
  },
});

assert.deepStrictEqual(JSON.parse(JSON.stringify(options)), [
  { keyword: "Kafka", tier: "required", expectedGain: 5 },
  { keyword: "Java", tier: "required", expectedGain: 4 },
  { keyword: "Kubernetes", tier: "preferred", expectedGain: 2.5 },
  { keyword: "GraphQL", tier: "nice_to_have", expectedGain: 1 },
]);

console.log("analysis brief tests passed");

const literalization = context.buildLiteralizationOptions({
  recognizedEvidence: [{
    keyword: "Amazon Web Services",
    matchedTerm: "aws",
    method: "synonym",
    expectedGain: 4,
  }],
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(literalization)), [{
  keyword: "Amazon Web Services",
  matchedTerm: "aws",
  method: "synonym",
  expectedGain: 4,
}]);
