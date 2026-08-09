// Canonical resume content. Tailoring may replace only summary and skills.

const BASELINE_RESUME_VERSION = "2026-08-09";

const baselineResumeData = {
  contact: {
    name: "AKASH RAJ",
    city: "Bengaluru, Karnataka, India",
    email: "akash.nits@gmail.com",
    phone: "9004351967",
    linkedinLabel: "https://www.linkedin.com/in/akashnits/",
    linkedinUrl: "https://www.linkedin.com/in/akashnits/",
    leetcodeUrl: "https://leetcode.com/akashnits/",
  },
  summary: "Experienced software engineer specializing in backend and app development with over 12 years of industry experience. Expert in building scalable microservices and event-driven architectures using AWS, DynamoDB, Serverless, and Kafka/Kinesis. Proven ability to lead teams and ship production-grade APIs and real-time systems. Building LLM-driven workflow agents and Agent Skills currently, productionizing structured LLM outputs (BAML) and reliable orchestration using Temporal/LangGraph.",
  experience: [
    {
      title: "Software Engineer - AI",
      companyDisplay: "LANTERN ( www.withlantern.com )",
      companyUrl: "http://www.withlantern.com",
      dateRange: "September 2025 - Present",
      bullets: [
        "Designed and implemented Agent Skills which uses LLM to configure and build a workflow. The workflow is used to fetch crucial contacts at a company.",
        "Working on improving overall Skills stability using BAML to generate structured output from LLMs.",
        "Re-architect backend for Skills: Moving from getting data from multiple sources; joining them in memory to show on UI \u2192 Unified data source in Clickhouse with versions, storing in wide format for creating materialized views which can be queried/filtered upon.",
        "Automated enrichment flow for companies - Uses temporal workflow for enrichment, uploading intermediate/final results to S3.",
        "Built a multi-skill editing framework that plans and applies workflow changes in parallel, improving efficiency",
        "Built agentic automation capabilities using Claude, including PR generation, local environment orchestration, and controlled database interactions via rule-driven skill design.",
      ],
    },
    {
      title: "Senior software engineer - Backend",
      companyDisplay: "KHOROS INDIA PVT LTD, Bangalore",
      dateRange: "October 2020 - Aug 2025",
      bullets: [
        "Designed and implemented a Flink application to ingest application logs from Kafka streams and write them to Amazon S3 in Iceberg table format, enabling efficient querying via AWS Athena. This architecture replaced the previous DynamoDB-based solution, achieving approximately 95% cost savings.",
        "Led a multi-month architectural redesign of the event-driven ticketing platform, redefining downstream event contracts to propagate conversationId post-persistence, eliminating cross-conversation race conditions and stabilizing bot-human handoffs.",
        "Crafted REST APIs as part of an Automation Framework empowering chatbots to interact and respond to customer conversations on social platforms.",
        "Developed a high-performance microservice, ML-processor, designed to deploy surveys (NPS/CSAT), deliver welcome responses, and conduct language detection on customer posts at scale.",
        "Augmented Khoros's service software to enable seamless bot interactions encompassing responses, rich text delivery, media transmission, and beyond.",
        "Provided mentorship to junior team members, fostering their professional growth and development within the team dynamic.",
      ],
    },
    {
      title: "Lead Software Engineer",
      companyDisplay: "CYBERNETYX TECHNIK, Bangalore",
      dateRange: "November 2018 - September 2020",
      bullets: [
        "Innovated and refined algorithms to optimize the performance of key functionalities, such as fast single and multi-touch writing, highlighter tools, auto-grouping and ungrouping features, selection mechanisms, zoom capabilities, shape manipulation, geometrical tools, and an intuitive auto-draw feature.",
        "Designed and implemented a collaborative application for educators, offering a sophisticated alternative to traditional whiteboards on the TutorPlus device sold on Amazon.",
        "Developed RESTful APIs to facilitate seamless retrieval and posting of teaching content, classroom data, and related information.",
        "Engineered essential applications, including Whiteboard, Launcher, and SystemUI, seamlessly integrated into the device package.",
      ],
    },
    {
      title: "Senior software engineer",
      companyDisplay: "L&T TECHNOLOGY SERVICES, Bangalore",
      dateRange: "January 2017 - October 2018",
      bullets: [
        "Crafted a messaging application named Cloudbanter allowing users to exchange text messages and attachments seamlessly while receiving tailored advertisements, curated content, and exclusive offers.",
      ],
    },
    {
      title: "Associate consultant",
      companyDisplay: "SAPIENS TECHNOLOGIES PVT LTD, Bangalore",
      dateRange: "February 2016 - December 2016",
      bullets: [],
    },
    {
      title: "Associate system engineer",
      companyDisplay: "IBM INDIA PVT LTD, Mumbai",
      dateRange: "January 2014 - January 2016",
      bullets: [],
    },
  ],
  education: [
    {
      degree: "B.Tech",
      year: "2013",
      institution: "NATIONAL INSTITUTE OF TECHNOLOGY \u2022 Silchar \u2022 7.9",
    },
  ],
  coursework: [
    { name: "AWS Lambdas", source: "Pluralsight", year: "2023" },
    { name: "Microservices Architecture", source: "Pluralsight", year: "2022" },
    { name: "Data structures", source: "Coursera", year: "2017" },
  ],
  skills: [
    { label: "Languages", value: "Java, Kotlin, Bash, Python" },
    { label: "Frameworks", value: "Dropwizard, Android" },
    { label: "Databases", value: "MySQL, Postgres, AWS DynamoDB, Supabase, Clickhouse" },
    { label: "Stream processing", value: "Kafka, Kinesis, Flink" },
    { label: "Others", value: "RESTful  API Development; DBMS, Microservices Architecture; Git, AWS, Serverless, Docker, CI/CD, Jenkins, Datadog." },
    { label: "AI tools", value: "Cursor, Kiro, Claude code, Co-pilot, Roo code ( sub-agents ), Context Engineering, BAML etc." },
    { label: "Soft skills", value: "Stakeholder Management, Cross-functional Collaboration, Technical Leadership, Mentorship." },
  ],
};

module.exports = { BASELINE_RESUME_VERSION, baselineResumeData };
