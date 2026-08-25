const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync("extension/scripts/ui.js", "utf8"), context);

const html = context.renderAnalysisScan({
  atsScore: 69,
  tailoringBrief: {
    ats: { currentCoverage: 69 },
    missingKeywords: {
      required: [{ keyword: "Microsoft Azure", expectedGain: 5 }],
      preferred: [],
      nice_to_have: [],
    },
    confirmationOptions: [{
      keyword: "Microsoft Azure",
      tier: "required",
    }],
  },
});

assert.ok(html.includes("Score lift: +5"));

console.log("UI score-lift test passed");
