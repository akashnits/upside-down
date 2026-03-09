# Deploy Google Apps Script

When asked to deploy the Google Apps Script backend, follow these steps:

1. Push local code to the GAS project using clasp
2. Update the existing deployment to create a new version
3. Verify the deployment was successful

## Prerequisites

- `clasp` CLI must be installed globally (`npm install -g @google/clasp`)
- User must be logged in via `clasp login`
- Apps Script API must be enabled at https://script.google.com/home/usersettings

## Project Details

- **Working directory:** `google-apps-script/`
- **Clasp config:** `google-apps-script/.clasp.json`
- **Script ID:** `1Ybq1qPhyhDGrf-qaWXbFpy1Ikgxu7kDUnbBxBM7mWqEnVwgU4-CDhAm8`
- **Deployment ID:** `AKfycbz2dx-2BH2I_Nnj_forO_qwWN8L4djLs-BFhpYrpTmtp3TBnZGxnE8okeMBPbWl_fQq`
- **Files pushed:** `Code.js`, `config.js`, `appsscript.json`

## Steps

### Step 1: Push code to GAS

Run from `google-apps-script/`:

```bash
clasp push
```

This uploads all local `.js` files and `appsscript.json` to the remote Apps Script project.

### Step 2: Deploy new version

Run from `google-apps-script/`:

```bash
clasp deploy -i AKfycbz2dx-2BH2I_Nnj_forO_qwWN8L4djLs-BFhpYrpTmtp3TBnZGxnE8okeMBPbWl_fQq -d "<description>"
```

Replace `<description>` with a short summary of what changed (e.g., "Phase 1: Single LLM call").

Using the `-i` flag updates the **existing** deployment so the URL stays the same. The Chrome extension does not need to be updated.

### Step 3: Verify

Confirm the output shows a new version number (e.g., `@26`, `@27`). The deployment URL remains:

```
https://script.google.com/macros/s/AKfycbz2dx-2BH2I_Nnj_forO_qwWN8L4djLs-BFhpYrpTmtp3TBnZGxnE8okeMBPbWl_fQq/exec
```

## Troubleshooting

- **"User has not enabled the Apps Script API"** → Visit https://script.google.com/home/usersettings and toggle ON
- **"Not logged in"** → Run `clasp login` and authorize in the browser
- **"Project contents must include a manifest"** → Ensure `appsscript.json` exists in `google-apps-script/`
