const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = { Logger: { log() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/atsEngine.js", "utf8"), context);

function method(term, resume) {
  return context.calculateATSScore([{ term, weight: 1 }], resume).matchMethod[term];
}

// Genuine aliases keep full ATS credit.
assert.strictEqual(method("Amazon Web Services", "Operated workloads on AWS."), "synonym");
assert.strictEqual(method("Kubernetes", "Managed K8s clusters."), "synonym");
assert.strictEqual(method("CI/CD", "Implemented continuous integration and continuous deployment."), "synonym");
assert.strictEqual(method("Mentoring junior engineers", "Mentored junior engineers on production debugging."), "stem");

// Related capabilities must not receive equivalent-skill credit.
assert.strictEqual(method("Docker", "Improved containerization of legacy applications."), undefined);
assert.strictEqual(method("Microservices", "Worked on distributed systems for payments."), undefined);
assert.strictEqual(method("System Design", "Contributed to application architecture reviews."), undefined);
assert.strictEqual(method("Message Queuing", "Built a Kafka analytics consumer."), undefined);

// A phrase whose words occur in different contexts is not a match.
assert.strictEqual(method("Distributed Systems", "Designed a distributed team process and maintained internal systems."), undefined);

// Literal ATS coverage stays strict even when the engine recognizes equivalent
// evidence. This keeps score-lift calculations honest.
const aliasScore = context.calculateATSScore(
  [{ term: "Amazon Web Services", aliases: ["AWS"], weight: 1 }],
  "Operated workloads on AWS.",
);
assert.strictEqual(aliasScore.score, 0);
assert.strictEqual(aliasScore.evidenceScore, 100);
assert.deepStrictEqual(JSON.parse(JSON.stringify(aliasScore.strictMissing)), ["Amazon Web Services"]);

const stemScore = context.calculateATSScore(
  [{ term: "Mentoring junior engineers", weight: 1 }],
  "Mentored junior engineers on production debugging.",
);
assert.strictEqual(stemScore.score, 0);
assert.strictEqual(stemScore.evidenceScore, 50);

console.log("ATS engine regression tests passed");
