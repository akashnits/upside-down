---
name: enrich-recruiters
description: "Find current, role-relevant recruiters for tracked Notion job records and enrich them with verified work emails, prioritizing Bengaluru. Use for recruiter contacts, not candidate sourcing or outreach."
---

# Enrich Recruiters

Source a small, accurate set of in-house recruiters for existing job records and find verified business emails. Prefer current technical recruiters, talent-acquisition partners, or sourcers over generic HR or leadership contacts.

## Defaults and boundaries

- If the user gives no database, resolve the exact Notion database named `Upside Down`; never silently substitute `Applications` or another similarly named database.
- Require one exact Notion `Job ID` and process only that matching job record. Never fall back to the latest records, a title match, or a company match. Default to up to two contacts for that job and locality priority Bengaluru, then India, then the job's stated location.
- Require a current employer, recruiting evidence, and an exact direct LinkedIn profile URL surfaced by current public research. Never invent a profile URL.
- Exclude former employees, agencies, unrelated HR, and senior/global/operations leaders used only to fill a quota. Do not use hiring managers unless the user allows it.
- When at least one verified email is found, automatically update only the selected Notion row's `Email` rich-text property. Save every verified email in rank order, separated by `; `. Never send outreach, add properties, or modify unrelated rows.

## Fast workflow

1. Resolve and query Notion once.
   - Search for the exact `Upside Down` database, fetch it once, and validate that its schema includes job name/title, company, role, job link, job ID, a rich-text `Email` property, and canonical `createdTime`.
   - Query only `url`, `createdTime`, `Name`, `Company`, `Role`, `Job Link`, `Job ID`, and existing `Email` for the exact user-supplied `Job ID`. Do not query or process unrelated rows. If no row or more than one row matches, stop and report that result rather than choosing a row.

2. Research employers in batches.
   - Use web search queries such as `site:linkedin.com/in (recruiter OR "talent acquisition" OR sourcer) "Employer" Bengaluru India`.
   - Put up to four employer queries in one web call and run another batch only when needed. Use the current search-result snippet as evidence; open an individual profile only if the snippet is ambiguous.
   - Dedupe and keep at most the requested contact count per job. Record the direct profile URL, current title/evidence, employer, and location.

3. Enrich emails with the bundled runner.
   - Check `ANYMAIL_FINDER_API_KEY`, `PROSPEO_API_KEY`, and `LEADMAGIC_API_KEY` once without printing values. If none is set, mark email status `provider unavailable` and stop enrichment.
   - When any key is available, read [the provider reference](references/email-provider-api.md), then pass all recruiter records to `scripts/enrich_emails.py` through stdin. The runner batches requests concurrently by stage: AnyMail Finder for all profiles, Prospeo for AnyMail misses, and LeadMagic for remaining misses. Do not hand-roll shell loops.
   - Accept only: AnyMail `email_status=valid` plus `valid_email`; Prospeo `error=false`, verified/revealed email; LeadMagic `status=valid` plus email. Reject personal, ambiguous, invalid, or company-mismatched results.
   - Report only accepted email, provider, and `verified`/`not found`/`provider unavailable` status. Keep raw provider responses in memory only.

4. Synchronize Notion immediately after enrichment. This is a mandatory completion gate; do not return an intermediate result or report success before the write and verification finish.
   - If no verified email is found, leave `Email` unchanged.
   - If one or more verified emails are found, replace `Email` with every accepted address in recruiter-rank order, separated by `; ` (for example, `first@company.com; second@company.com`). Do not create or update a separate contacts field.
   - On a transient connector failure, including an `aborted` result, retry the identical `Email` update up to two times. Do not repeat recruiter research or email-provider calls: reuse the verified addresses already found.
   - After a successful write, fetch the selected page directly and verify that its `Email` value exactly equals the normalized, semicolon-separated addresses submitted. Do not rely on an immediately repeated SQL query, which may be stale.
   - If a direct fetch is interrupted or does not yet show the submitted value, retry the fetch twice. If the write or any read-back retry still fails, report enrichment as incomplete with the final error and the verified-but-unsaved address(es).
   - If the update or verification fails, report enrichment as incomplete with the exact failure reason; never claim success based only on provider output.

## Compact invocation

For “get contacts for job ID `<id>`” or equivalent: resolve only that exact `Upside Down` row, find up to two qualified contacts, apply Bengaluru priority, and automatically update and verify `Email` with all verified addresses separated by `; ` before reporting completion.

If the user does not provide a Job ID, ask for one. If the user supplies a contact count, location, database link, or output filename, use those values.

## Output rules

Lead with coverage achieved. State the database used, selected job ID, one record processed, verified emails found, rows updated, and any gaps. Include direct LinkedIn URLs in the response when useful, and identify non-local fallbacks. For genuine gaps, suggest only a focused next step such as authenticated LinkedIn access, broader location/role scope, or missing provider access.
