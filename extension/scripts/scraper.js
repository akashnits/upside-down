// Scraper — Extracts job data from LinkedIn pages
// Strategy: Voyager API data first (Phase 3), DOM fallback

function scrapeJob() {
    const getText = (selectors) => {
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.innerText.trim()) return el.innerText.trim();
        }
        return null;
    };

    return {
        role: getText([
            '.job-details-jobs-unified-top-card__job-title',
            '.jobs-unified-top-card__job-title',
            '.t-24.t-bold.jobs-unified-top-card__job-title',
            '[class*="job-title"]',
            'h1'
        ]) || "Unknown Role",

        company: getText([
            '.job-details-jobs-unified-top-card__company-name',
            '.jobs-unified-top-card__company-name',
            '.jobs-unified-top-card__company-name a',
            '[class*="company-name"]'
        ]) || "Unknown Company",

        jobDescription: getText([
            '#job-details',
            '.jobs-description',
            '.jobs-description-content__text',
            '.jobs-box__html-content',
            '[class*="description"] [class*="content"]'
        ]) || "",

        jobUrl: window.location.href,
        jobId: (window.location.href.match(/\/view\/(\d+)/) || window.location.href.match(/currentJobId=(\d+)/) || [null, `UD-${Date.now()}`])[1],
        source: 'dom'
    };
}
