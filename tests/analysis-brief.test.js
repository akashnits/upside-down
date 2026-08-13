const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = { Logger: { log() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/analysis.js", "utf8"), context);

const options = context.buildConfirmationOptions({
  missingKeywords: {
    required: [{ keyword: "Kafka" }, { keyword: "Java" }],
    preferred: [{ keyword: "Kubernetes" }],
    nice_to_have: [{ keyword: "GraphQL" }],
  },
});

assert.deepStrictEqual(JSON.parse(JSON.stringify(options)), [
  { keyword: "Kafka", tier: "required", reason: "Not found in the current resume. Confirm direct experience before including it." },
  { keyword: "Java", tier: "required", reason: "Not found in the current resume. Confirm direct experience before including it." },
  { keyword: "Kubernetes", tier: "preferred", reason: "Not found in the current resume. Confirm direct experience before including it." },
  { keyword: "GraphQL", tier: "nice_to_have", reason: "Not found in the current resume. Confirm direct experience before including it." },
]);

console.log("analysis brief tests passed");
