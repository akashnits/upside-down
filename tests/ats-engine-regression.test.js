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

console.log("ATS engine regression tests passed");
