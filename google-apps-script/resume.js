// resume.js — Resume & Drive operations
// Functions: getResumeContent, getDocTextFromUrl, duplicateResume

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
  // Extract Doc ID from URLs like https://docs.google.com/document/d/DOC_ID/edit
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Could not extract Doc ID from URL: ${url}`);
  return DocumentApp.openById(match[1]).getBody().getText();
}

/**
 * Duplicates the Base Resume into a nested Drive folder structure:
 * Akash CVs -> [Company Name] -> [Role]_[JobId]
 * Returns the URL of the new document.
 */
function duplicateResume(role, company, jobId) {
  const baseDocId = PROPERTIES.getProperty("RESUME_DOC_ID");
  if (!baseDocId) return "";

  try {
    const baseFile = DriveApp.getFileById(baseDocId);
    const sanitizedCompany = (company || "Unknown").replace(/[^a-zA-Z0-9 _-]/g, '');
    const folderName = `${role || "Unknown"}_${jobId || "Unknown"}`.replace(/[^a-zA-Z0-9 _-]/g, '');
    
    // Access "Akash CVs" root folder directly
    const rootFolderId = PROPERTIES.getProperty("CVS_ROOT_FOLDER_ID");
    if (!rootFolderId) throw new Error("CVS_ROOT_FOLDER_ID not set in Script Properties");
    let rootFolder = DriveApp.getFolderById(rootFolderId);
    
    // Find or create Company folder inside Root
    let companyIter = rootFolder.getFoldersByName(sanitizedCompany);
    let companyFolder = companyIter.hasNext() ? companyIter.next() : rootFolder.createFolder(sanitizedCompany);

    // Create the specific Role/Job folder inside the Company folder
    const targetFolder = companyFolder.createFolder(folderName);
    
    // Create copy inside the new target folder
    const newFile = baseFile.makeCopy(`Akash_Raj`, targetFolder);
    
    // Grant edit access so Cowork/AI can modify it
    newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    
    return newFile.getUrl();
  } catch (err) {
    Logger.log(`[ERROR] Failed to duplicate resume: ${err.toString()}`);
    return "";
  }
}
