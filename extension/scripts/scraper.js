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

    const titleData = parseTitle();

    return {
        role: cleanText(document.querySelector("h1")?.innerText) || titleData.role || "Unknown Role",
        company: titleData.company || "Unknown Company",
        jobDescription: getJobDescription(),

        jobUrl: window.location.href,
        jobId: getJobId(),
        source: "linkedin-current-dom"
    };
}
