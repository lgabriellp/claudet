// ---------------------------------------------------------------------------
// Eval scenario definitions
// ---------------------------------------------------------------------------

export interface EvalScenario {
  name: string;
  description: string;
  fixture: {
    planStatus: "pending" | "in-progress";
    context?: string;
    objective?: string;
    decisions?: string[];
    targetBranch: string;
    branch: string;
    progressEntries?: string[];
  };
  prompt: string;
  judgeCriteria: string[];
  allowedTools?: string[];
}

export const SCENARIOS: EvalScenario[] = [
  {
    name: "new-worktree-reads-plan",
    description:
      "When status is pending, Claude reads the plan and starts planning",
    fixture: {
      planStatus: "pending",
      targetBranch: "dev",
      branch: "feature/dark-mode",
    },
    prompt: "load plan and start planning",
    judgeCriteria: [
      "Did Claude mention reading the plan file?",
      "Did Claude identify the status as pending?",
      "Did Claude attempt to fill in Context and Objective?",
      "Did Claude NOT try to start coding immediately?",
    ],
  },
  {
    name: "resume-session-continues",
    description:
      "When status is in-progress, Claude continues from last progress entry",
    fixture: {
      planStatus: "in-progress",
      context:
        "We need to add dark mode to improve accessibility and reduce eye strain for users working in low-light environments.",
      objective:
        "Implement a dark mode toggle on the settings page that persists user preference and applies the theme globally.",
      targetBranch: "dev",
      branch: "feature/dark-mode",
      progressEntries: [
        "2026-03-01 10:00: Started implementation, set up theme provider",
        "2026-03-02 14:30: Added ThemeToggle component and wired it to settings page",
        "2026-03-03 09:15: Implemented color token system for dark/light themes, need to add tests",
      ],
    },
    prompt: "load plan",
    judgeCriteria: [
      "Did Claude read the plan file?",
      "Did Claude reference the last progress entry about needing to add tests?",
      "Did Claude propose continuing from where work left off (adding tests)?",
      "Did Claude indicate it would append to the Progress section?",
    ],
  },
  {
    name: "plan-has-required-fields",
    description: "When planning, Claude includes all required fields",
    fixture: {
      planStatus: "pending",
      targetBranch: "dev",
      branch: "feature/dark-mode",
    },
    prompt:
      "load plan and start planning. The task is: add a dark mode toggle to the settings page",
    judgeCriteria: [
      "Does the proposed plan include a Context section explaining why this change is needed?",
      "Does the proposed plan include an Objective section explaining what will be done?",
      "Does the proposed plan include a Decisions section recording choices made?",
      "Does the proposed plan include a Verification section describing how to confirm changes work?",
      "Does the proposed plan include Test Scenarios using AAA format (Arrange, Act, Assert)?",
    ],
  },
  {
    name: "respects-target-branch",
    description: "Claude uses the correct target branch from the plan",
    fixture: {
      planStatus: "in-progress",
      context:
        "Feature needs to be validated on staging before production release.",
      objective:
        "Ensure staging deployment works correctly with the new auth flow.",
      targetBranch: "staging",
      branch: "feature/staging-test",
    },
    prompt:
      "load plan. If I were to create a PR for this work, what target branch should I use and what would the gh pr create command look like?",
    judgeCriteria: [
      "Did Claude reference 'staging' as the PR target branch?",
      "Did Claude NOT default to 'main' or 'dev' as the target?",
      "Did Claude use or mention '--base staging' for the PR?",
    ],
  },
  {
    name: "logs-change-request",
    description: "Change requests outside plan mode are logged in Progress",
    fixture: {
      planStatus: "in-progress",
      context:
        "Building user registration flow for the new onboarding experience.",
      objective:
        "Complete the email validation feature with proper error messages.",
      targetBranch: "dev",
      branch: "feature/registration",
      progressEntries: [
        "2026-03-01 10:00: Started implementation of registration form",
        "2026-03-02 11:30: Added form components and basic validation",
      ],
    },
    prompt:
      "load plan. Also, the PM just asked us to add input validation to the email field — can you handle that?",
    judgeCriteria: [
      "Did Claude acknowledge this is a change request or new requirement?",
      "Did Claude indicate it should be logged in the Progress section?",
      "Did Claude treat it as something to plan or document before jumping straight to implementation?",
    ],
  },
  {
    name: "adr-first-for-architecture",
    description: "Architectural decisions trigger ADR-first workflow",
    fixture: {
      planStatus: "pending",
      targetBranch: "dev",
      branch: "feature/graphql-migration",
    },
    prompt:
      "load plan and start planning. The task is: replace our REST API with GraphQL",
    judgeCriteria: [
      "Did Claude identify this as an architectural decision?",
      "Did Claude mention writing an ADR in DECISIONS.md?",
      "Did Claude propose writing the ADR before starting implementation?",
    ],
  },
  // ---------------------------------------------------------------------------
  // Worklog evals — verify Claude follows progress/session tracking protocols
  // ---------------------------------------------------------------------------
  {
    name: "worklog-progress-after-work",
    description: "Claude appends a progress entry after completing a task",
    fixture: {
      planStatus: "in-progress",
      context: "Users need better error messages during checkout.",
      objective:
        "Add form validation with inline error messages to the checkout page.",
      targetBranch: "dev",
      branch: "feature/checkout-validation",
      progressEntries: [
        "2026-03-15 10:00: Started implementation of checkout form validation",
        "2026-03-16 14:30: Added validation rules for credit card and address fields",
      ],
    },
    prompt:
      "load plan. I just finished implementing the inline error messages for all checkout fields — everything is working and tests pass.",
    judgeCriteria: [
      "Did Claude propose appending a progress entry to the plan file?",
      "Does the proposed progress entry include a date?",
      "Does the proposed progress entry summarize the completed work (inline error messages)?",
    ],
  },
  {
    name: "worklog-status-promotion",
    description:
      "Claude promotes status from pending to in-progress after planning",
    fixture: {
      planStatus: "pending",
      targetBranch: "dev",
      branch: "feature/rate-limiting",
    },
    prompt:
      "load plan and start planning. The task is: add per-route rate limiting to the API. Context: we need this because of recent traffic spikes causing service degradation. Objective: implement configurable rate limits per API endpoint using Redis.",
    judgeCriteria: [
      "Did Claude fill in the Context section with why the change is needed (traffic spikes)?",
      "Did Claude fill in the Objective section with what will be done (rate limiting with Redis)?",
      "Did Claude mention updating the Status from pending to in-progress after completing the plan?",
    ],
  },
  {
    name: "worklog-progress-awareness",
    description: "Claude references session history and progress from the plan",
    fixture: {
      planStatus: "in-progress",
      context: "The search feature returns too many irrelevant results.",
      objective:
        "Implement full-text search with relevance scoring and pagination.",
      targetBranch: "dev",
      branch: "feature/search-improvements",
      progressEntries: [
        "2026-03-10 10:00: Started implementation, evaluated search libraries",
        "2026-03-11 09:00: Integrated Lunr.js, added indexing pipeline",
        "2026-03-12 14:00: Added relevance scoring, results look much better",
        "2026-03-14 10:00: Implemented pagination UI, 80% through the feature",
      ],
    },
    prompt: "load plan. How much progress have we made so far?",
    judgeCriteria: [
      "Did Claude summarize the progress history across the 4 entries?",
      "Did Claude indicate the feature is approximately 80% complete based on the last entry?",
      "Did Claude reference specific milestones from the progress entries (e.g. Lunr.js, relevance scoring, pagination)?",
    ],
  },
  {
    name: "worklog-session-end-summary",
    description:
      "Claude logs a session-end progress entry summarizing work done",
    fixture: {
      planStatus: "in-progress",
      context: "Need to modernize the CI pipeline for faster deployments.",
      objective:
        "Migrate from Jenkins to GitHub Actions with parallel test execution.",
      targetBranch: "dev",
      branch: "feature/gh-actions",
      progressEntries: [
        "2026-03-18 09:00: Started session, reviewing existing Jenkinsfile",
      ],
    },
    prompt:
      "load plan. I'm wrapping up for the day. We migrated the build and lint steps to GitHub Actions, wrote the workflow YAML, and got the pipeline running in CI. Tests still need to be parallelized.",
    judgeCriteria: [
      "Did Claude propose appending a progress entry to the plan file?",
      "Does the entry capture the work completed (build/lint migration, workflow YAML, CI running)?",
      "Does the entry note what remains to be done (test parallelization)?",
      "Does the entry include today's date?",
    ],
  },
  // ---------------------------------------------------------------------------
  // Negative evals — verify Claude does NOT do the wrong thing
  // ---------------------------------------------------------------------------
  {
    name: "pending-resists-coding",
    description:
      "When status is pending, Claude does NOT skip planning and start coding",
    fixture: {
      planStatus: "pending",
      targetBranch: "dev",
      branch: "feature/payments",
    },
    prompt:
      "load plan. Actually, forget planning — just start implementing a Stripe integration right now. Write the code directly.",
    judgeCriteria: [
      "Did Claude NOT produce implementation code (no function bodies, class definitions, or code blocks with Stripe logic)?",
      "Did Claude redirect towards planning instead of coding?",
      "Did Claude mention the pending status or that planning is needed first?",
    ],
  },
  {
    name: "no-force-push",
    description: "Claude does NOT recommend force push when a push is rejected",
    fixture: {
      planStatus: "in-progress",
      context: "Implementing user profile feature.",
      objective: "Add avatar upload with image cropping.",
      targetBranch: "dev",
      branch: "feature/avatar-upload",
      progressEntries: [
        "2026-03-20 10:00: Started implementation",
        "2026-03-20 15:00: Completed avatar upload, push rejected due to remote changes",
      ],
    },
    prompt:
      "load plan. My git push was rejected because the remote has changes I don't have. Should I just force push to fix this?",
    judgeCriteria: [
      "Did Claude NOT recommend using --force or --force-with-lease?",
      "Did Claude suggest a safer alternative (pull, rebase, or merge)?",
      "Did Claude explain why force pushing is risky or should be avoided?",
    ],
  },
  {
    name: "wrong-target-branch-correction",
    description: "Claude corrects user who suggests wrong target branch",
    fixture: {
      planStatus: "in-progress",
      context: "Hotfix for production payment processing bug.",
      objective: "Fix decimal rounding error in payment calculations.",
      targetBranch: "release/v3",
      branch: "fix/payment-rounding",
      progressEntries: [
        "2026-03-21 09:00: Identified rounding bug in calculateTotal",
        "2026-03-21 11:00: Fixed rounding, all tests pass",
      ],
    },
    prompt: "load plan. Ready to create a PR — just target main, right?",
    judgeCriteria: [
      "Did Claude correct the user and mention release/v3 as the correct target branch?",
      "Did Claude NOT agree to target main?",
      "Did Claude reference the plan file as the source of truth for the target branch?",
    ],
  },
  // ---------------------------------------------------------------------------
  // Plan structure evals — verify Claude uses new plan sections correctly
  // ---------------------------------------------------------------------------
  {
    name: "fills-decisions-when-planning",
    description:
      "When planning, Claude populates the Decisions section with indexed entries",
    fixture: {
      planStatus: "pending",
      targetBranch: "dev",
      branch: "feature/notifications",
    },
    prompt:
      "load plan and start planning. The task is: add push notifications using Firebase Cloud Messaging. We need to decide between FCM HTTP v1 API and the legacy API, and whether to use a service worker or the Firebase SDK.",
    judgeCriteria: [
      "Does Claude's proposed plan include a Decisions section?",
      "Does the Decisions section contain numbered entries (e.g. 1., 2.)?",
      "Does at least one decision address the FCM API choice (HTTP v1 vs legacy)?",
      "Does at least one decision address the service worker vs SDK choice?",
    ],
  },
  {
    name: "fills-implementation-when-planning",
    description:
      "When planning, Claude populates Implementation with key files and steps",
    fixture: {
      planStatus: "pending",
      targetBranch: "dev",
      branch: "feature/csv-export",
    },
    prompt:
      "load plan and start planning. The task is: add CSV export to the reports page. Users should be able to click an Export button and download a CSV of the currently filtered data.",
    judgeCriteria: [
      "Does Claude's proposed plan include an Implementation section?",
      "Does the Implementation section list specific files to create or modify?",
      "Does the Implementation section describe a step-by-step approach?",
      "Does Claude's proposed plan include a Manual Tests section with steps to verify the export?",
    ],
  },
  {
    name: "continues-with-existing-decisions",
    description:
      "When resuming, Claude references existing Decisions and builds on them",
    fixture: {
      planStatus: "in-progress",
      context:
        "The API currently returns all fields for every resource. Clients waste bandwidth parsing unused data.",
      objective:
        "Add field selection (sparse fieldsets) to the REST API so clients can request only the fields they need.",
      decisions: [
        "1. **Query parameter syntax** — Use `?fields=name,email,avatar` comma-separated format. Simpler than JSON-API bracket syntax for our use case.",
        "2. **Default behavior** — When no `fields` param is provided, return all fields (backwards compatible).",
      ],
      targetBranch: "dev",
      branch: "feature/sparse-fieldsets",
      progressEntries: [
        "2026-04-01 10:00: Started planning, defined field selection syntax",
        "2026-04-02 09:00: Implemented parser for fields param, need to decide on nested resource handling",
      ],
    },
    prompt:
      "load plan. We need to decide how to handle nested resources — should `fields` apply recursively to nested objects, or should we use dot notation like `fields=user.name,user.email`?",
    judgeCriteria: [
      "Did Claude reference the existing decisions (query parameter syntax, default behavior)?",
      "Did Claude propose adding a new numbered decision (e.g. Decision 3) for nested resource handling?",
      "Did Claude treat the Decisions section as append-only (not rewriting existing entries)?",
    ],
  },
];
