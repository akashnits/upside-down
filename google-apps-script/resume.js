// resume.js — Resume & Drive operations
// Functions: getResumeContent, getDocTextFromUrl, duplicateResume,
//            createOrGetTailoringDraft

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

function createOrGetTailoringDraft(role, company, jobId, existingFolderId, existingDocumentId) {
  if (existingDocumentId) {
    try {
      const existingFile = DriveApp.getFileById(existingDocumentId);
      if (!existingFolderId || isDocumentInFolder(existingDocumentId, existingFolderId)) {
        return {
          folderId: existingFolderId || "",
          documentId: existingDocumentId,
          documentUrl: existingFile.getUrl(),
        };
      }
    } catch (err) {
      Logger.log(`[WARN] Stored tailoring draft is unavailable: ${err.toString()}`);
    }
  }

  const baseDocId = PROPERTIES.getProperty("RESUME_DOC_ID");
  const rootFolderId = PROPERTIES.getProperty("CVS_ROOT_FOLDER_ID");
  if (!baseDocId || !rootFolderId) {
    throw new Error("RESUME_DOC_ID and CVS_ROOT_FOLDER_ID must be set in Script Properties");
  }

  const sanitizedCompany = (company || "Unknown").replace(/[^a-zA-Z0-9 _-]/g, "");
  const folderName = `${role || "Unknown"}_${jobId || "Unknown"}`.replace(/[^a-zA-Z0-9 _-]/g, "");
  const rootFolder = DriveApp.getFolderById(rootFolderId);
  const companyFolder = findOrCreateFolder(rootFolder, sanitizedCompany);
  const targetFolder = existingFolderId
    ? DriveApp.getFolderById(existingFolderId)
    : findOrCreateFolder(companyFolder, folderName);

  const existingFiles = targetFolder.getFilesByName("Akash_Raj");
  if (existingFiles.hasNext()) {
    const existingFile = existingFiles.next();
    return {
      folderId: targetFolder.getId(),
      documentId: existingFile.getId(),
      documentUrl: existingFile.getUrl(),
    };
  }

  const baseFile = DriveApp.getFileById(baseDocId);
  const newFile = baseFile.makeCopy("Akash_Raj", targetFolder);
  newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
  return {
    folderId: targetFolder.getId(),
    documentId: newFile.getId(),
    documentUrl: newFile.getUrl(),
  };
}

/**
 * Duplicates the Base Resume into a nested Drive folder structure:
 * Akash CVs -> [Company Name] -> [Role]_[JobId]
 * Returns the URL of the new document.
 */
function duplicateResume(role, company, jobId) {
  try {
    return createOrGetTailoringDraft(role, company, jobId, "", "").documentUrl;
  } catch (err) {
    Logger.log(`[ERROR] Failed to duplicate resume: ${err.toString()}`);
    return "";
  }
}
