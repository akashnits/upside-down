// Scraper — Extracts job data from LinkedIn's current job details DOM

function scrapeJob() {
    const cleanText = (text) => {
        return (text || "")
            .replace(/\u00a0/g, " ")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    };

    const parseTitle = () => {
        const parts = document.title
            .split("|")
            .map(cleanText)
            .filter(Boolean);

        return {
            role: parts[0] || "",
            company: parts[1] && parts[1] !== "LinkedIn" ? parts[1] : "",
        };
    };

    const getJobDescription = () => {
        const aboutJob = document.querySelector('[id^="JobDetails_AboutTheJob_"]');
        return cleanText(aboutJob?.innerText).replace(/^About the job\s*/i, "").trim();
    };

    const getJobId = () => {
        const urlMatch =
            window.location.href.match(/\/view\/(\d+)/) ||
            window.location.href.match(/currentJobId=(\d+)/);
        if (urlMatch) return urlMatch[1];

        const aboutJob = document.querySelector('[id^="JobDetails_AboutTheJob_"]');
        return aboutJob?.id.match(/JobDetails_AboutTheJob_(\d+)/)?.[1] || `UD-${Date.now()}`;
    };

    const sanitizeJobUrl = (value) => {
        try {
            const url = new URL(value, window.location.href);
            [...url.searchParams.keys()].forEach(key => {
                if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
            });
            return url.href;
        } catch (_error) {
            return value || "";
        }
    };

    const getApplicationUrl = () => {
        const applyLink = [
            ...document.querySelectorAll('a.jobs-apply-button[href], a[data-live-test-job-apply-button][href], a[href]')
        ].find(link => /^(apply|apply now)$/i.test(cleanText(link.innerText || link.textContent)));
        if (!applyLink) return "";

        const isLinkedInHost = hostname => hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");

        try {
            const href = new URL(applyLink.href, window.location.href);
            // LinkedIn occasionally wraps an external application URL in a redirect.
            // Preserve the employer destination when it is available, otherwise keep
            // the LinkedIn URL as the safe fallback.
            const redirectedUrl = href.searchParams.get("url");
            if (redirectedUrl) {
                const destination = new URL(redirectedUrl);
                if (destination.protocol === "https:" && !isLinkedInHost(destination.hostname)) return sanitizeJobUrl(destination.href);
            }
            if (href.protocol === "https:" && !isLinkedInHost(href.hostname)) return sanitizeJobUrl(href.href);
        } catch (_error) {
            // A malformed or non-web Apply link is not useful in an outreach email.
        }
        return "";
    };

    const titleData = parseTitle();

    return {
        role: cleanText(document.querySelector("h1")?.innerText) || titleData.role || "Unknown Role",
        company: titleData.company || "Unknown Company",
        jobDescription: getJobDescription(),

        jobUrl: sanitizeJobUrl(window.location.href),
        applicationUrl: getApplicationUrl(),
        jobId: getJobId(),
        source: "linkedin-current-dom"
    };
}
