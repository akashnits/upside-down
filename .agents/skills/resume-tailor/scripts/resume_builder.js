/**
 * resume_builder.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic resume formatter. Contains ONLY layout/styling logic.
 * Usage:
 *   const { buildResume } = require("./resume_builder");
 *   buildResume(data, "/path/to/output.docx");
 *
 * Data schema:
 * {
 *   name: string,
 *   contact: { city, email, phone, linkedinLabel, linkedinUrl, extra? },
 *   summary: string,
 *   experience: [{ title, company, companyDisplay, companyUrl?, location?, dateRange, bullets[] }],
 *   education: [{ degree, year, institution }],
 *   coursework: [{ name, source, year }],
 *   skills: [{ label, value }]
 * }
 */

const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink,
  AlignmentType, BorderStyle, LevelFormat,
  Table, TableRow, TableCell, WidthType, VerticalAlign,
} = require("docx");

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const FONT          = "Calibri";
const C_BLACK       = "000000";
const C_DARK        = "333333";
const C_ACCENT      = "2E75B6";

// US Letter, 0.5" margins
const PAGE_W        = 12240;
const PAGE_H        = 15840;
const MARGIN        = 720;           // 0.5 inch in DXA
const CONTENT_W     = PAGE_W - 2 * MARGIN;  // 10800 DXA

// Two-column split: left ~70%, right ~30%
const LEFT_COL      = 7560;
const RIGHT_COL     = CONTENT_W - LEFT_COL;  // 3240

// ─── LOW-LEVEL HELPERS ────────────────────────────────────────────────────────

function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: opts.size || 20, color: opts.color || C_DARK, ...opts });
}

function hyperlink(text, url, opts = {}) {
  return new ExternalHyperlink({
    link: url,
    children: [run(text, { color: C_ACCENT, underline: {}, ...opts })],
  });
}

/** Horizontal rule under a section heading */
function sectionHeader(label) {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C_ACCENT, space: 1 } },
    children: [run(label.toUpperCase(), { bold: true, size: 22, color: C_ACCENT })],
  });
}

/**
 * Borderless two-column table row.
 * Renders correctly in Word, LibreOffice, AND Google Docs.
 * (Tab stops collapse in Google Docs — tables do not.)
 *
 * @param {TextRun[]} leftChildren  - Runs for the left cell
 * @param {string}    rightText     - Plain text for the right cell (right-aligned)
 * @param {object}    opts          - { before, after, rightSize }
 */
function twoColTable(leftChildren, rightText, opts = {}) {
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: none, bottom: none, left: none, right: none,
                      insideH: none, insideV: none };
  const cellPad = { top: 0, bottom: 0, left: 0, right: 0 };

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [LEFT_COL, RIGHT_COL],
    borders: noBorders,
    margins: cellPad,
    rows: [
      new TableRow({
        children: [
          // Left cell — title / degree / course name
          new TableCell({
            width: { size: LEFT_COL, type: WidthType.DXA },
            borders: noBorders,
            margins: cellPad,
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              spacing: { before: opts.before || 0, after: opts.after || 0 },
              children: leftChildren,
            })],
          }),
          // Right cell — date range / year / source, right-aligned
          new TableCell({
            width: { size: RIGHT_COL, type: WidthType.DXA },
            borders: noBorders,
            margins: cellPad,
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: opts.before || 0, after: opts.after || 0 },
              children: [run(rightText, { size: opts.rightSize || 20 })],
            })],
          }),
        ],
      }),
    ],
  });
}

function bulletPara(children) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 40 },
    children,
  });
}

// ─── SECTION BUILDERS ─────────────────────────────────────────────────────────

function buildHeader(contact) {
  const rows = [];

  // Name
  rows.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 50 },
    children: [run(contact.name, { bold: true, size: 36, color: C_BLACK })],
  }));

  // City | email | phone
  rows.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 20 },
    children: [
      run(`${contact.city}  |  `, { size: 18 }),
      run(contact.email, { size: 18, color: C_ACCENT }),
      run(`  |  ${contact.phone}`, { size: 18 }),
    ],
  }));

  // Links
  const linkChildren = [hyperlink(contact.linkedinLabel || "LinkedIn", contact.linkedinUrl, { size: 18 })];
  if (contact.leetcodeUrl) {
    linkChildren.push(run("  |  ", { size: 18 }));
    linkChildren.push(hyperlink("LeetCode", contact.leetcodeUrl, { size: 18 }));
  }
  rows.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 140 },
    children: linkChildren,
  }));

  return rows;
}

function buildSummary(text) {
  return [
    sectionHeader("Summary"),
    new Paragraph({
      spacing: { after: 140 },
      children: [run(text)],
    }),
  ];
}

function buildExperience(jobs) {
  const rows = [sectionHeader("Experience")];

  for (const job of jobs) {
    // Title (bold left) + date range (right-aligned)
    rows.push(twoColTable(
      [run(job.title, { bold: true, size: 21, color: C_BLACK })],
      job.dateRange,
      { before: 180 }
    ));

    // Company + optional location (italic), hyperlinked if url provided
    const companyChildren = job.companyUrl
      ? [hyperlink(job.companyDisplay, job.companyUrl)]
      : [run(job.companyDisplay, { italics: true })];
    if (job.location) companyChildren.push(run(`, ${job.location}`, { italics: true }));

    rows.push(new Paragraph({ spacing: { after: 40 }, children: companyChildren }));

    // Bullets
    for (const b of job.bullets) {
      rows.push(bulletPara([run(b)]));
    }
  }

  return rows;
}

function buildEducation(entries) {
  const rows = [sectionHeader("Education")];

  for (const e of entries) {
    // Degree (bold left) + year (right-aligned)
    rows.push(twoColTable(
      [run(e.degree, { bold: true, size: 21, color: C_BLACK })],
      e.year,
      { before: 60 }
    ));
    rows.push(new Paragraph({
      spacing: { after: 60 },
      children: [run(e.institution, { italics: true })],
    }));
  }

  return rows;
}

function buildCoursework(courses) {
  const rows = [sectionHeader("Coursework")];

  for (const c of courses) {
    // Course name (bold left) + "Source • Year" (right-aligned)
    rows.push(twoColTable(
      [run(c.name, { bold: true })],
      `${c.source} \u2022 ${c.year}`,
      { after: 30 }
    ));
  }

  return rows;
}

function buildSkills(skills) {
  const rows = [sectionHeader("Skills")];

  for (const s of skills) {
    rows.push(new Paragraph({
      spacing: { after: 50 },
      children: [
        run(`${s.label} \u2013 `, { bold: true }),
        run(s.value),
      ],
    }));
  }

  return rows;
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Build a resume .docx from structured data.
 * @param {Object} data   Resume data (see schema at top of file)
 * @param {string} outPath  Absolute path for the output .docx
 */
function buildResume(data, outPath) {
  const children = [
    ...buildHeader(data.contact),
    ...buildSummary(data.summary),
    ...buildExperience(data.experience),
    ...buildEducation(data.education),
    ...buildCoursework(data.coursework),
    ...buildSkills(data.skills),
  ];

  const doc = new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 450, hanging: 250 } } },
        }],
      }],
    },
    styles: {
      default: { document: { run: { font: FONT, size: 20 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children,
    }],
  });

  Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(outPath, buf);
    console.log("Resume written to: " + outPath);
  });
}

module.exports = { buildResume };
