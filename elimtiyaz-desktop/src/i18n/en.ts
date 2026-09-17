/**
 * English translation strings — the third locale (T-388, I18N-501).
 *
 * GENERATED ONCE from fr.ts + scripts/i18n/dictionary-en.json (the Pass 1
 * translation table), then HAND-MAINTAINED like fr.ts / ar.ts from now on.
 * Regenerating is NOT idempotent over manual edits — edit by hand.
 */
export const en = {
  app: {
    name: "El-Imtiyaz",
    tagline: "School Management Platform"
  },
  auth: {
    title: "Login",
    subtitle: "Access your workspace",
    email: "Email address",
    password: "Password",
    signIn: "Sign in",
    signOut: "Sign out",
    signingIn: "Signing in…",
    invalidCredentials: "Invalid credentials."
  },
  nav: {
    dashboard: "Dashboard",
    crm: "Students & Parents",
    academics: "Academics",
    financials: "Finances",
    personnel: "Staff",
    workflow: "Automations",
    routing: "Routes",
    settings: "Settings"
  },
  language: {
    switcher: "Change language",
    label: "Language"
  },
  common: {
    search: "Search",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    yes: "Yes",
    no: "No",
    loading: "Loading…",
    noData: "No items",
    retry: "Try again",
    export: "Export",
    import: "Import",
    filter: "Filter",
    all: "All",
    actions: "Actions",
    details: "Details",
    view: "View",
    back: "Back",
    next: "Next",
    previous: "Previous"
  },
  dashboard: {
    title: "Dashboard",
    overview: "Overview",
    alerts: "Alerts",
    reports: "Reports",
    analytics: "Analytics",
    seeDetails: "View details",
    kpi: {
      totalStudents: "Students",
      totalParents: "Parents",
      totalStaff: "Staff",
      monthlyRevenue: "Monthly revenue",
      outstandingDebt: "Overdue receivables",
      pendingExpenses: "Pending expenses",
      attendanceRate: "Attendance rate",
      overdueAlerts: "Overdue alerts"
    },
    charts: {
      revenue: "Revenue (last 12 months)",
      debtAging: "Receivables by age group",
      demographics: "Demographic distribution",
      gradeDistribution: "Distribution by grade level",
      genderDistribution: "Distribution by gender"
    },
    sections: {
      revenue: "Revenue",
      departments: "Departments",
      demographics: "Demographics",
      debt: "Receivables"
    }
  },
  settings: {
    title: "Settings",
    general: "General",
    audit: "Audit log",
    rbac: "RBAC Matrix",
    ai: "AI Configuration",
    backup: "Backups",
    locked: "Locked features",
    pricing: "Pricing",
    appearance: "Appearance",
    language: "Language",
    theme: "Theme",
    notifications: "Notifications",
    auditFilter: {
      action: "Action",
      entity: "Entity",
      actor: "Actor",
      from: "From",
      to: "Until"
    },
    noAuditEntries: "No audit entries match the filters."
  },
  crm: {
    batchRegistration: "Group registration",
    parentDetail: "Parent details",
    studentDetail: "Student details",
    adjustAccount: "Adjust account"
  },
  financials: {
    counterPayment: "Counter payment",
    expenseSubmit: "New expense",
    expenseDetail: "Expense details",
    installmentSchedule: "Installments"
  },
  academics: {
    classDetail: "Class details",
    rollCall: "Roll call",
    gradeEntry: "Grade entry",
    homeworkPush: "Assign homework"
  },
  status: {
    enabled: "Enabled",
    disabled: "Disabled",
    locked: "Locked",
    comingSoon: "Coming soon"
  },
  comingSoon: {
    title: "Module in development",
    description: "This module is scaffolded according to the business plan. Full implementation will arrive in a future iteration.",
    learnMore: "Learn more"
  },
  toast: {
    saved: "Saved successfully",
    error: "An error occurred",
    deleted: "Deleted successfully",
    confirmed: "Action confirmed"
  },
  ai: {
    title: "Artificial Intelligence",
    config: "AI Configuration",
    groqKey: "Groq API Key",
    openrouterKey: "OpenRouter API Key (fallback)",
    defaultProvider: "Default provider",
    defaultModel: "Default Model",
    fallbackModel: "Fallback Model (Optional)",
    test: "Test",
    save: "Save",
    clear: "Clear",
    configured: "Configured",
    notConfigured: "Not Configured",
    encryptionNote: "API keys are encrypted with AES-256-GCM before being stored locally.",
    testing: "Testing…",
    testOk: "Provider reachable",
    customKey: "Custom API Key (Optional)",
    customBaseUrl: "Base URL (OpenAI-compatible)",
    discoverModels: "Discover Models",
    discovering: "Discovering…",
    inferenceTest: "Test Inference",
    inferenceOk: "Connection Successful",
    sampling: "Sampling Parameters",
    temperature: "Temperature",
    topP: "Top P",
    maxTokens: "Max Tokens",
    modelsFound: "models discovered",
    narrative: {
      title: "Report Card Narrative",
      generate: "Generate",
      regenerate: "Regenerate",
      approve: "Approve",
      reject: "Reject",
      loading: "Generating…",
      teacherNotes: "Teacher's Notes",
      studentInfo: "Student",
      gradesSummary: "Grade Summary",
      attendanceRate: "Attendance Rate",
      generatedNarrative: "Generated Narrative",
      reviewMandatory: "Teacher review required before publication",
      rejectReason: "Reason for Rejection"
    },
    drafting: {
      title: "Writing Assistant",
      typeLabel: "Draft Type",
      recipient: "Recipient (Optional)",
      keyPoints: "Key Points (one per line)",
      generate: "Generate",
      copy: "Copy",
      download: "Download PDF",
      send: "Send",
      warning: "AI may hallucinate. Proofread before sending.",
      generatedDraft: "Draft Generated",
      type: {
        convocation: "Summon",
        parent_alert: "Parent Alert",
        policy_notice: "Policy Note"
      }
    },
    anomaly: {
      title: "Anomaly Explanation",
      signals: "Signals Detected",
      summary: "AI Summary",
      requestJustification: "Request Justification",
      signalNotVerdict: "AI provides a signal, the human always decides.",
      signal: {
        duplicate: "Duplication",
        new_vendor: "New Provider",
        budget_overrun: "Budget Overrun",
        missing_proof: "Missing justification"
      },
      justificationComment: "Justification request comment"
    }
  },
  workflow: {
    title: "Automations",
    editor: "Editor",
    runs: "Executions",
    new: "New workflow",
    deploy: "Deploy",
    save: "Save",
    saved: "Workflow saved",
    cycleDetected: "Cycle detected — unable to save",
    deployed: "Workflow deployed",
    execute: "Execute",
    executed: "Workflow executed",
    retried: "New execution started",
    status: {
      draft: "Draft",
      deployed: "Deployed",
      disabled: "Disabled"
    },
    runStatus: {
      running: "In progress",
      succeeded: "Success",
      failed: "Failure",
      timeout: "Expired"
    },
    nodeType: {
      trigger: "Trigger",
      condition: "Condition",
      action: "Action",
      delay: "Delay",
      transform: "Transformation"
    },
    noWorkflows: "No workflow. Create one to start.",
    selectWorkflow: "Select a workflow from the list to edit.",
    runDetail: "Execution details",
    nodeResults: "Results by node",
    retry: "Retry"
  },
  backup: {
    title: "Backups",
    lastBackup: "Last backup",
    runNow: "Save now",
    archives: "Archives",
    restore: "Restore",
    delete: "Delete",
    restoreConfirmTitle: "Restore the backup?",
    restoreConfirmDescription: "This action will replace current data. Irreversible.",
    deleteConfirmTitle: "Delete the archive?",
    deleteConfirmDescription: "The archive will be permanently deleted from the vault. Irreversible action.",
    purge: "Purge",
    purgeAuto: "Auto purge",
    nextScheduled: "Next execution",
    purgeNow: "Purge now",
    empty: "No backups. Click 'Save now' to create the first one.",
    size: "Size",
    status: {
      encrypted: "Encrypted",
      restored: "Restored",
      corrupted: "Corrupted",
      purged: "Purged"
    },
    vault: {
      local: "Local (IndexedDB)",
      offsite: "Off-site (S3)"
    },
    retention: "Retention 365 days",
    running: "Backup in progress…",
    restoring: "Restoration in progress…",
    success: "Backup created successfully",
    restoreSuccess: "Restoration successful",
    deleteSuccess: "Archive deleted successfully",
    purgeSuccess: "Purge completed successfully"
  }
};
