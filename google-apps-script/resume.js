// resume.js - Resume text and Drive folder operations
// Functions: getResumeContent, getDocTextFromUrl, createOrGetTailoringFolder

/**
 * Helper to fetch Resume Text from Google Doc (base resume)
 */
function getResumeContent() {
  const docId = PROPERTIES.getProperty("RESUME_DOC_ID");
  if (!docId) throw new Error("RESUME_DOC_ID not set in Script Properties");
  return DocumentApp.openById(docId).getBody().getText();
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
