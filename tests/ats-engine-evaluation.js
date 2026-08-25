/*
 * Offline diagnostic benchmark for ATS keyword matching.
 *
 * This intentionally compares match semantics only. Every fixture supplies a
 * fixed keyword and a human-reviewed expected result, so LLM rubric extraction
 * and the two products' different headline-score formulas do not affect the
 * result.
 *
 * Run: node tests/ats-engine-evaluation.js
 */

const fs = require("fs");
const vm = require("vm");

const context = { Logger: { log() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/atsEngine.js", "utf8"), context);

const fixtures = [
  // Exact and parser-sensitive terms.
  { id: "exact-python", term: "Python", resume: "Built Python APIs for payments.", expected: true, weight: 1.0 },
  { id: "boundary-go-google", term: "Go", resume: "Improved Google Ads reporting.", expected: false, weight: 1.0 },
  { id: "exact-cplusplus", term: "C++", resume: "Developed C++ services for trading.", expected: true, weight: 1.0 },
  { id: "exact-dotnet", term: ".NET", resume: "Built internal platforms on .NET 8.", expected: true, weight: 1.0 },
  { id: "exact-nodejs", term: "Node.js", resume: "Maintained Node.js API services.", expected: true, weight: 1.0 },
  { id: "exact-kubernetes", term: "Kubernetes", resume: "Deployed services to Kubernetes.", expected: true, weight: 1.0 },

  // Genuine spelling/abbreviation equivalents that should improve recall.
  { id: "alias-aws", term: "Amazon Web Services", resume: "Operated workloads on AWS.", expected: true, weight: 1.0 },
  { id: "alias-k8s", term: "Kubernetes", resume: "Managed K8s clusters.", expected: true, weight: 1.0 },
  { id: "alias-postgres", term: "PostgreSQL", resume: "Optimized Postgres query performance.", expected: true, weight: 1.0 },
  { id: "alias-react", term: "React.js", resume: "Built the customer portal in React.", expected: true, weight: 1.0 },
  { id: "alias-typescript", term: "TypeScript", resume: "Migrated UI code from JavaScript to TS.", expected: true, weight: 1.0 },
  { id: "alias-nlp", term: "Natural Language Processing", resume: "Built NLP classification pipelines.", expected: true, weight: 1.0 },
  { id: "alias-gcp", term: "Google Cloud Platform", resume: "Deployed production workloads to GCP.", expected: true, weight: 1.0 },
  { id: "alias-cicd", term: "CI/CD", resume: "Implemented continuous integration and continuous deployment.", expected: true, weight: 1.0 },

  // Related concepts are deliberately not treated as interchangeable skills.
  { id: "related-docker-containerization", term: "Docker", resume: "Improved containerization of legacy applications.", expected: false, weight: 1.0 },
  { id: "related-microservices-distributed", term: "Microservices", resume: "Worked on distributed systems for payments.", expected: false, weight: 1.0 },
  { id: "related-system-design-architecture", term: "System Design", resume: "Contributed to application architecture reviews.", expected: false, weight: 1.0 },
  { id: "related-message-queue-kafka", term: "Message Queuing", resume: "Built a Kafka analytics consumer.", expected: false, weight: 1.0 },
  { id: "related-genai-llm", term: "Generative AI", resume: "Evaluated LLMs for document classification.", expected: false, weight: 1.0 },
  { id: "related-tech-leadership-mentoring", term: "Technical Leadership", resume: "Mentored two junior engineers.", expected: false, weight: 1.0 },

  // Phrase words appearing separately must not become a phrase/capability match.
  { id: "split-phrase-distributed-systems", term: "Distributed Systems", resume: "Designed a distributed team process and maintained internal systems.", expected: false, weight: 1.0 },
  { id: "split-phrase-machine-learning", term: "Machine Learning", resume: "Operated a machine fleet and built a learning portal.", expected: false, weight: 1.0 },
  { id: "split-phrase-rest-api", term: "REST API", resume: "Applied REST principles and documented API integrations.", expected: false, weight: 1.0 },

  // A true morphological variant; this tells us whether stemming earns its keep.
  { id: "stem-deployment-deployed", term: "Deployment", resume: "Deployed services through a release pipeline.", expected: true, weight: 1.0 },
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Equivalent to Resume Matcher app.services.ats._keyword_in_text().
function resumeMatcherExact(term, resume) {
  return new RegExp(`(?<!\\w)${escapeRegex(term.trim().toLowerCase())}(?!\\w)`, "i")
    .test(resume.toLowerCase());
}

function oursMethod(term, resume) {
  const result = context.calculateATSScore([{ term, weight: 1 }], resume);
  return result.matchMethod[term] || null;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function evaluate(name, predict) {
  const results = fixtures.map(fixture => ({
    ...fixture,
    predicted: predict(fixture),
  }));
  const totals = results.reduce((acc, result) => {
    if (result.predicted && result.expected) acc.tp += result.weight;
    if (result.predicted && !result.expected) acc.fp += result.weight;
    if (!result.predicted && result.expected) acc.fn += result.weight;
    if (!result.predicted && !result.expected) acc.tn += result.weight;
    acc.expectedWeight += result.expected ? result.weight : 0;
    acc.predictedWeight += result.predicted ? result.weight : 0;
    acc.totalWeight += result.weight;
    return acc;
  }, { tp: 0, fp: 0, fn: 0, tn: 0, expectedWeight: 0, predictedWeight: 0, totalWeight: 0 });

  const precision = totals.tp / (totals.tp + totals.fp || 1);
  const recall = totals.tp / (totals.tp + totals.fn || 1);
  const expectedScore = totals.expectedWeight / totals.totalWeight;
  const predictedScore = totals.predictedWeight / totals.totalWeight;

  return {
    name,
    results,
    precision,
    recall,
    falsePositiveRate: totals.fp / (totals.fp + totals.tn || 1),
    expectedScore,
    predictedScore,
    scoreError: Math.abs(predictedScore - expectedScore),
  };
}

const configurations = [
  {
    name: "Resume Matcher exact baseline",
    predict: fixture => resumeMatcherExact(fixture.term, fixture.resume),
  },
  {
    name: "Ours: exact only",
    predict: fixture => oursMethod(fixture.term, fixture.resume) === "exact",
  },
  {
    name: "Ours: exact + synonym",
    predict: fixture => ["exact", "synonym"].includes(oursMethod(fixture.term, fixture.resume)),
  },
  {
    name: "Ours: exact + synonym + stem",
    predict: fixture => ["exact", "synonym", "stem"].includes(oursMethod(fixture.term, fixture.resume)),
  },
  {
    name: "Ours: full matcher",
    predict: fixture => Boolean(oursMethod(fixture.term, fixture.resume)),
  },
];

const evaluations = configurations.map(({ name, predict }) => evaluate(name, predict));

console.log("ATS matching evaluation (24 human-labelled term/resume fixtures)");
console.table(evaluations.map(result => ({
  matcher: result.name,
  precision: formatPercent(result.precision),
  recall: formatPercent(result.recall),
  falsePositiveRate: formatPercent(result.falsePositiveRate),
  expectedScore: formatPercent(result.expectedScore),
  predictedScore: formatPercent(result.predictedScore),
  scoreError: formatPercent(result.scoreError),
})));

for (const evaluation of evaluations) {
  const errors = evaluation.results.filter(result => result.predicted !== result.expected);
  console.log(`\n${evaluation.name}: ${errors.length} mismatch(es)`);
  for (const error of errors) {
    const method = oursMethod(error.term, error.resume);
    console.log(`- ${error.id}: expected ${error.expected ? "match" : "no match"}, got ${error.predicted ? "match" : "no match"}${method ? ` (${method})` : ""}`);
  }
}

