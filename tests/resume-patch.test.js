const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

class MockText {
  constructor(paragraph) {
    this.paragraph = paragraph;
  }

  getText() {
    return this.paragraph.text;
  }

  setText(value) {
    this.paragraph.text = value;
  }

  getAttributes() {
    return { fontSize: 10 };
  }

  setAttributes() {}
}

class MockParagraph {
  constructor(text) {
    this.text = text;
    this.parent = null;
  }

  getType() {
    return "PARAGRAPH";
  }

  asParagraph() {
    return this;
  }

  getText() {
    return this.text;
  }

  editAsText() {
    return new MockText(this);
  }

  getAttributes() {
    return { spacingAfter: 50 };
  }

  setAttributes() {}

  removeFromParent() {
    throw new Error("Resume patching must not remove paragraphs");
  }
}

class MockBody {
  constructor(lines) {
    this.children = lines.map(line => {
      const paragraph = new MockParagraph(line);
      paragraph.parent = this;
      return paragraph;
    });
  }

  getNumChildren() {
    return this.children.length;
  }

  getChild(index) {
    return this.children[index];
  }

}

const baseLines = [
  "AKASH RAJ",
  "SUMMARY",
  "Backend engineer with Java and AWS experience.",
  "",
  "EXPERIENCE",
  "Senior Engineer",
  "Delivered event-driven systems.",
  "EDUCATION",
  "B.Tech",
  "SKILLS",
  "Languages - Java, Python",
  "Databases - DynamoDB",
  "Others - AWS, Docker",
  "",
];
const body = new MockBody(baseLines);
const documents = {
  base: { getBody: () => body, saveAndClose: () => {} },
};
const context = {
  DocumentApp: {
    ElementType: { PARAGRAPH: "PARAGRAPH" },
    openById: id => documents[id],
  },
  PROPERTIES: { getProperty: () => "base" },
  DriveApp: {},
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("google-apps-script/resume.js", "utf8"), context);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.getEditableResumeContent("base"))),
  {
    summary: "Backend engineer with Java and AWS experience.",
    skills: [
      { label: "Languages", value: "Java, Python" },
      { label: "Databases", value: "DynamoDB" },
      { label: "Others", value: "AWS, Docker" },
    ],
  },
);

context.applyTailoringPatch("base", {
  summary: "Backend engineer building Java services on AWS.",
  skills: [
    { label: "Languages", value: "Java, Python, SQL" },
    { label: "Platforms", value: "AWS, Docker, Kubernetes" },
    { label: "Others", value: "DynamoDB, Kafka" },
  ],
});

assert.deepStrictEqual(
  body.children.map(paragraph => paragraph.text),
  [
    "AKASH RAJ",
    "SUMMARY",
    "Backend engineer building Java services on AWS.",
    "",
    "EXPERIENCE",
    "Senior Engineer",
    "Delivered event-driven systems.",
    "EDUCATION",
    "B.Tech",
    "SKILLS",
    "Languages - Java, Python, SQL",
    "Platforms - AWS, Docker, Kubernetes",
    "Others - DynamoDB, Kafka",
    "",
  ],
);

assert.throws(
  () => context.applyTailoringPatch("base", {
    summary: "This must not replace the summary.",
    skills: [{ label: "Languages", value: "Java" }],
  }),
  /preserve the Base Resume's 3 Skills rows/,
);
assert.strictEqual(body.children[2].text, "Backend engineer building Java services on AWS.");

vm.runInContext(fs.readFileSync("google-apps-script/tailoring.js", "utf8"), context);
assert.throws(
  () => context.normalizeTailoringPatch({ summary: "x", skills: [], unexpected: true }),
  /only summary and skills/,
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.normalizeTailoringPatch({
    summary: " Summary ",
    skills: [{ label: " Languages ", value: " Java " }],
  }))),
  { summary: "Summary", skills: [{ label: "Languages", value: "Java" }] },
);

console.log("resume patch tests passed");
