export const LOCALE = {
  app: {
    name: 'Capibara',
    tagline: 'Company-grade AI Organization Orchestration',
  },
  sections: {
    dashboard: 'Dashboard',
    organization: 'Organization',
    execution: 'Execution',
    discussion: 'Discussions',
  },
  status: {
    active: 'Active',
    paused: 'Paused',
    archived: 'Archived',
    idle: 'Idle',
  },
  task: {
    pending: 'Pending',
    in_progress: 'In Progress',
    awaiting_review: 'Awaiting Review',
    revision: 'Revision',
    approved: 'Approved',
    done: 'Done',
    blocked: 'Blocked',
    cancelled: 'Cancelled',
  },
  vote: {
    APPROVE: 'Approve',
    REVISE: 'Request Revision',
    CONCERN: 'Raise Concern',
    DELEGATE: 'Delegate',
  },
  errors: {
    notFound: 'Not found',
    validation: 'Validation error',
    internal: 'Internal error',
    budgetExceeded: 'Budget exceeded',
  },
} as const;
