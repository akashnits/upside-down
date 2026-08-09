#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { BASELINE_RESUME_VERSION, baselineResumeData } = require("../baseline_resume_data");
const { buildResume } = require("./resume_builder");

const args = process.argv.slice(2);
const fastMode = args.includes("--fast");
const positionalArgs = args.filter(arg => arg !== "--fast");
const [patchPath, outputPath, manifestPath] = positionalArgs;

if (!patchPath || !outputPath) {
  console.error("Usage: render-tailored-resume.js <patch.json> <output.docx> [manifest.json] [--fast]");
  process.exit(1);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSkills(skills) {
  if (!Array.isArray(skills) || !skills.length) {
    throw new Error("Patch must include a non-empty skills array");
  }

  return skills.map((skill, index) => {
    if (!skill || typeof skill.label !== "string" || typeof skill.value !== "string") {
      throw new Error(`Skill ${index + 1} must contain string label and value fields`);
    }
    const label = skill.label.trim();
    const value = skill.value.trim();
    if (!label || !value) throw new Error(`Skill ${index + 1} cannot be empty`);
    return { label, value };
  });
}

function readPatch(filePath) {
  const patch = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  const keys = Object.keys(patch).sort();
  if (keys.join(",") !== "skills,summary") {
    throw new Error("Patch may contain only summary and skills fields");
  }
  if (typeof patch.summary !== "string" || !patch.summary.trim()) {
    throw new Error("Patch must include a non-empty summary string");
  }
  return { summary: patch.summary.trim(), skills: normalizeSkills(patch.skills) };
}

function wordCount(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function getLayoutRisk(patch) {
  const summaryDelta = wordCount(patch.summary) - wordCount(baselineResumeData.summary);
  const skillRowDelta = patch.skills.length - baselineResumeData.skills.length;
  const longestSkillValue = Math.max(...patch.skills.map(skill => skill.value.length));
  const reasons = [];

  if (summaryDelta > 70) reasons.push("summary is more than 70 words longer than baseline");
  if (skillRowDelta > 0) reasons.push("skills add one or more rows");
  if (longestSkillValue > 150) reasons.push("a skills row exceeds 150 characters");

  return { requiresVisualQa: reasons.length > 0, reasons };
}

async function main() {
  const patch = readPatch(patchPath);
  const layoutRisk = getLayoutRisk(patch);
  if (fastMode && layoutRisk.requiresVisualQa) {
    throw new Error(`Fast mode is not allowed: ${layoutRisk.reasons.join("; ")}`);
  }

  const data = clone(baselineResumeData);
  data.summary = patch.summary;
  data.skills = patch.skills;

  const resolvedOutputPath = path.resolve(outputPath);
  await buildResume(data, resolvedOutputPath);

  const manifest = {
    version: 1,
    baselineVersion: BASELINE_RESUME_VERSION,
    baselineHash: sha256(JSON.stringify(baselineResumeData)),
    outputFile: path.basename(resolvedOutputPath),
    fastMode,
    layoutRisk,
    expected: {
      summary: data.summary,
      skills: data.skills,
    },
  };
  const resolvedManifestPath = path.resolve(manifestPath || `${resolvedOutputPath}.manifest.json`);
  fs.writeFileSync(resolvedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath: resolvedOutputPath, manifestPath: resolvedManifestPath, layoutRisk }));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
