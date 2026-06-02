// apps/electron/.dependency-cruiser.cjs
// Layering CI guard for Capibara Architecture Refactor (G-1 / ADR-02)
// Enforces the dependency DAG from architecture-final-v2 §7/§8
//
// All rules start at severity 'warn' — flip to 'error' as later OPs fix violations.
// §8.2 allowed-edge whitelist is documented below; convert to `allowed` rules once baseline is clean.

const C = 'src/core';

module.exports = {
  forbidden: [
    /* ------------------------------------------------------------------
     * Rule 1: Domain Core must not import adapters
     * C-7 convention: infrastructure/ = all technical mechanics (inbound + outbound).
     * Domain modules depend only on foundation ports.
     * ------------------------------------------------------------------ */
    {
      name: 'no-core-to-adapters',
      severity: 'warn',
      comment:
        'Domain Core only depends on foundation ports; must not import infrastructure / mcp / ipc-handlers',
      from: { path: `^${C}/modules/` },
      to: { path: `^${C}/(infrastructure|mcp|ipc-handlers)/` },
    },

    /* ------------------------------------------------------------------
     * Rule 2: D0 (Organization) must stay leaf
     * Organization is the structural core — most stable, most referenced.
     * It must not import other domain modules (only foundation).
     * ------------------------------------------------------------------ */
    {
      name: 'd0-must-stay-leaf',
      severity: 'warn',
      comment:
        'D0 (Organization) is the structural core; must not import other domain modules',
      from: { path: `^${C}/modules/organization/` },
      to: {
        path: `^${C}/modules/(?!organization)[^/]+/`,
        pathNot: `^${C}/foundation/`,
      },
    },

    /* ------------------------------------------------------------------
     * Rule 3: D1 capability domains must not depend on D3 orchestration
     * Prevents upward reverse edges: D0/D1 → D3 is forbidden.
     * D3 orchestrators may depend on all lower layers (DAG terminal).
     * ------------------------------------------------------------------ */
    {
      name: 'no-upward-d1-to-d3',
      severity: 'warn',
      comment:
        'D1 capability domains must not import D3 orchestration (no upward reverse edges)',
      from: {
        path: `^${C}/modules/(conversation|workflow|execution|acp|planning)/`,
      },
      to: { path: `^${C}/modules/(coordination|orchestrator)/` },
    },

    /* ------------------------------------------------------------------
     * Rule 4: Cross-module concrete-class imports forbidden
     * Cross-module callers must depend on interfaces/, not services/ or engines/.
     * Same-module internal imports are allowed (capture-group backref $1).
     * Per ADR-12/Q4: if backref proves unreliable, switch to explicit
     * per-module whitelist edges (see §8.2).
     * ------------------------------------------------------------------ */
    {
      name: 'no-cross-module-concrete',
      severity: 'error',
      comment:
        'Cross-module must depend on interfaces/, not concrete services/ or engines/ (OP-1/OP-2 prerequisite)',
      from: { path: `^${C}/modules/([^/]+)/` },
      to: {
        path: `^${C}/modules/([^/]+)/(services|engines)/`,
        pathNot: '$1',
      },
    },
  ],

  /* ==================================================================
   * §8.2 D-layer allowed edges (whitelist)
   * ==================================================================
   * This table documents the ONLY cross-layer edges permitted in Domain Core.
   * Once violations are cleaned up by OP-1/OP-2, convert to `allowed` rules
   * to enforce the positive specification.
   *
   * | from              | allowed → to                                      | basis |
   * |-------------------|---------------------------------------------------|-------|
   * | D1 Workflow       | D0 Organization (IRoleRepository)                 | §7    |
   * | D1 acp-domain     | D0 Organization; D1 Execution (IExecutor)         | §7    |
   * | D1 Execution      | D1 Workflow (interfaces + engines)                | §7    |
   * | D1 Planning       | D1 Workflow (interfaces); Conversation (events)   | §7    |
   * | D2 Prompt         | D1 Workflow / Conversation; D0 Organization       | §7    |
   * | D3 Coordination   | D0 Organization; Conversation (events only)       | §7    |
   * | D3 Orchestrator×3 | D0/D1/D2 all (orchestration is DAG terminal)     | §7    |
   * ================================================================== */

  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    // Include type-only imports as dependencies.
    // import type still couples consumer to concrete class shape;
    // the guard must catch these to enforce "depend on interfaces, not implementations".
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
  },
};
