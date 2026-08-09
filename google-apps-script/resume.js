// resume.js - Resume text, bounded document edits, and Drive folder operations
// Functions: getResumeContent, getDocTextFromUrl, getEditableResumeContent,
//            createOrGetTailoringFolder, createOrGetTailoringDraft, applyTailoringPatch

/**
 * Helper to fetch Resume Text from Google Doc (base resume)
 */
function getResumeContent() {
  return DocumentApp.openById(getBaseResumeDocumentId()).getBody().getText();
}

function getBaseResumeDocumentId() {
  const docId = PROPERTIES.getProperty("RESUME_DOC_ID");
  if (!docId) throw new Error("RESUME_DOC_ID not set in Script Properties");
  return docId;
}

/**
 * Extract Google Doc text from a URL
 */
function getDocTextFromUrl(url) {
  return DocumentApp.openById(getGoogleDocIdFromUrl(url)).getBody().getText();
}

function getGoogleDocIdFromUrl(url) {
  const match = String(url || "").match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Could not extract Doc ID from URL: ${url}`);
  return match[1];
}

function getGoogleDocUrl(documentId) {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

function findOrCreateFolder(parentFolder, folderName) {
  const iterator = parentFolder.getFoldersByName(folderName);
  return iterator.hasNext() ? iterator.next() : parentFolder.createFolder(folderName);
}

function isDocumentInFolder(documentId, folderId) {
  const file = DriveApp.getFileById(documentId);
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return true;
  }
  return false;
}

function createOrGetTailoringFolder(role, company, jobId, existingFolderId) {
  const rootFolderId = PROPERTIES.getProperty("CVS_ROOT_FOLDER_ID");
  if (!rootFolderId) {
    throw new Error("CVS_ROOT_FOLDER_ID must be set in Script Properties");
  }

  const sanitizedCompany = (company || "Unknown").replace(/[^a-zA-Z0-9 _-]/g, "");
  const folderName = `${role || "Unknown"}_${jobId || "Unknown"}`.replace(/[^a-zA-Z0-9 _-]/g, "");
  const rootFolder = DriveApp.getFolderById(rootFolderId);
  const companyFolder = findOrCreateFolder(rootFolder, sanitizedCompany);
  const targetFolder = existingFolderId
    ? DriveApp.getFolderById(existingFolderId)
    : findOrCreateFolder(companyFolder, folderName);

  return {
    folderId: targetFolder.getId(),
    folderUrl: targetFolder.getUrl(),
  };
}

function createOrGetTailoringDraft(role, company, jobId, existingFolderId, existingDocumentId) {
  const folder = createOrGetTailoringFolder(role, company, jobId, existingFolderId);

  if (existingDocumentId && isDocumentInFolder(existingDocumentId, folder.folderId)) {
    return {
      ...folder,
      documentId: existingDocumentId,
      documentUrl: getGoogleDocUrl(existingDocumentId),
    };
  }

  const copy = DriveApp.getFileById(getBaseResumeDocumentId()).makeCopy("Akash_Raj", DriveApp.getFolderById(folder.folderId));

  return {
    ...folder,
    documentId: copy.getId(),
    documentUrl: getGoogleDocUrl(copy.getId()),
  };
}

function normalizeResumeHeading(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

function getDirectParagraphsInSection(body, heading, nextHeading) {
  let headingIndex = -1;
  let nextHeadingIndex = body.getNumChildren();

  for (let index = 0; index < body.getNumChildren(); index += 1) {
    const child = body.getChild(index);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

    const text = normalizeResumeHeading(child.asParagraph().getText());
    if (headingIndex === -1 && heading.includes(text)) {
      headingIndex = index;
      continue;
    }
    if (headingIndex !== -1 && nextHeading.includes(text)) {
      nextHeadingIndex = index;
      break;
    }
  }

  if (headingIndex === -1) {
    throw new Error(`Could not find the ${heading[0]} section in the base resume`);
  }

  const paragraphs = [];
  for (let index = headingIndex + 1; index < nextHeadingIndex; index += 1) {
    const child = body.getChild(index);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) {
      throw new Error(`The ${heading[0]} section has unsupported document content`);
    }
    paragraphs.push(child.asParagraph());
  }

  return { headingIndex, nextHeadingIndex, paragraphs };
}

function getSummarySection(body) {
  return getDirectParagraphsInSection(
    body,
    ["SUMMARY", "PROFESSIONAL SUMMARY", "OBJECTIVE"],
    ["EXPERIENCE"],
  );
}

function getSkillsSection(body) {
  return getDirectParagraphsInSection(
    body,
    ["SKILLS", "SKILLS / TECHNOLOGIES", "TECHNOLOGIES"],
    [],
  );
}

function parseSkillParagraph(paragraph) {
  const text = paragraph.getText().trim();
  const match = text.match(/^(.+?)(\s*[\u2013-]\s*)(.+)$/);
  if (!match) throw new Error(`Could not parse a Skills row: ${text}`);
  return { label: match[1].trim(), value: match[3].trim() };
}

function getEditableResumeContent(documentId) {
  const body = DocumentApp.openById(documentId || getBaseResumeDocumentId()).getBody();
  const summary = getSummarySection(body).paragraphs
    .map(paragraph => paragraph.getText().trim())
    .filter(Boolean)
    .join(" ");
  const skills = getSkillsSection(body).paragraphs
    .filter(paragraph => paragraph.getText().trim())
    .map(parseSkillParagraph);

  if (!summary || !skills.length) {
    throw new Error("The base resume must contain a non-empty Summary and Skills section");
  }
  return { summary, skills };
}

function getTextAttributes(text, offset) {
  return text.getAttributes(Math.max(0, Math.min(offset, text.getText().length - 1)));
}

function updateParagraphText(paragraph, value, attributes) {
  const text = paragraph.editAsText();
  text.setText(value);
  if (value) text.setAttributes(0, value.length - 1, attributes);
}

function replaceSummarySection(body, summary) {
  const section = getSummarySection(body);
  const paragraphs = section.paragraphs.filter(paragraph => paragraph.getText().trim());
  if (!paragraphs.length) throw new Error("The base resume Summary section is empty");

  const paragraph = paragraphs[0];
  const sourceText = paragraph.editAsText();
  updateParagraphText(paragraph, summary, getTextAttributes(sourceText, 0));

  for (let index = section.paragraphs.length - 1; index >= 0; index -= 1) {
    if (section.paragraphs[index] !== paragraph) {
      section.paragraphs[index].removeFromParent();
    }
  }
}

function getSkillStyleTemplate(paragraph) {
  const source = paragraph.getText();
  const match = source.match(/^(.+?)(\s*[\u2013-]\s*)(.+)$/);
  if (!match) throw new Error("The base resume Skills section has an unsupported row format");

  const text = paragraph.editAsText();
  return {
    paragraphAttributes: paragraph.getAttributes(),
    separator: match[2],
    labelAttributes: getTextAttributes(text, 0),
    valueAttributes: getTextAttributes(text, match[1].length + match[2].length),
  };
}

function writeSkillParagraph(paragraph, skill, template) {
  const label = `${skill.label}${template.separator}`;
  const value = `${label}${skill.value}`;
  const text = paragraph.editAsText();
  text.setText(value);
  text.setAttributes(0, label.length - 1, template.labelAttributes);
  text.setAttributes(label.length, value.length - 1, template.valueAttributes);
}

function clearParagraph(paragraph) {
  paragraph.editAsText().setText("");
}

function isLastBodyParagraph(body, paragraph) {
  return body.getNumChildren() > 0 && body.getChild(body.getNumChildren() - 1) === paragraph;
}

function replaceSkillsSection(body, skills) {
  const section = getSkillsSection(body);
  const paragraphs = section.paragraphs.filter(paragraph => paragraph.getText().trim());
  if (!paragraphs.length) throw new Error("The base resume Skills section is empty");

  const template = getSkillStyleTemplate(paragraphs[0]);
  const sharedCount = Math.min(paragraphs.length, skills.length);
  for (let index = 0; index < sharedCount; index += 1) {
    writeSkillParagraph(paragraphs[index], skills[index], template);
  }

  const retained = paragraphs.slice(0, sharedCount);
  for (let index = section.paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = section.paragraphs[index];
    if (!retained.includes(paragraph)) {
      if (isLastBodyParagraph(body, paragraph)) {
        clearParagraph(paragraph);
      } else {
        paragraph.removeFromParent();
      }
    }
  }

  for (let index = sharedCount; index < skills.length; index += 1) {
    const updatedSection = getSkillsSection(body);
    const paragraph = updatedSection.paragraphs.find(item => !item.getText().trim())
      || body.insertParagraph(updatedSection.nextHeadingIndex, "");
    paragraph.setAttributes(template.paragraphAttributes);
    writeSkillParagraph(paragraph, skills[index], template);
  }
}

function applyTailoringPatch(documentId, patch) {
  const document = DocumentApp.openById(documentId);
  const body = document.getBody();
  replaceSummarySection(body, patch.summary);
  replaceSkillsSection(body, patch.skills);
  document.saveAndClose();
}
