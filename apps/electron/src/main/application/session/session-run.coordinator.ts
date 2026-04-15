import { injectable, inject } from 'tsyringe';
import type { IRunEngine, RunResult } from '@main/core/interfaces/i-run-engine.js';
import type { ISessionRepository } from '@main/core/interfaces/i-session.repository.js';
import type { ISessionMessageRepository } from '@main/core/interfaces/i-session-message.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { ISettingsRepository } from '@main/core/interfaces/i-settings.repository.js';
import type { IPromptBuilder, PlanningPhase, SessionPromptContext } from '@main/core/interfaces/i-prompt-builder.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Session, SessionType } from '@main/core/types/session.types.js';
import type { McpExecutionContext } from '@main/core/interfaces/i-run-engine.js';
import {
  RUN_ENGINE_TOKEN,
  SESSION_REPO_TOKEN,
  SESSION_MESSAGE_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  ORGANIZATION_REPO_TOKEN,
  SKILL_REPO_TOKEN,
  PROMPT_BUILDER_TOKEN,
  SETTINGS_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';

/**
 * Orchestrates AI runs within a Session context. Manages session messages,
 * prompt construction, planning phase detection, and session resume.
 *
 * Does NOT touch: Task, OrgOrchestrator, ConversationWorkflow, RoutingPolicyEngine.
 *
 * See architecture-session-layer.md §7 (ADR-SESSION-02).
 */
@injectable()
export class SessionRunCoordinator {
  /** Buffer for assistant text extracted from streaming output */
  private runAssistantText = new Map<string, string>();

  constructor(
    @inject(RUN_ENGINE_TOKEN) private readonly runEngine: IRunEngine,
    @inject(SESSION_REPO_TOKEN) private readonly sessionRepo: ISessionRepository,
    @inject(SESSION_MESSAGE_REPO_TOKEN) private readonly messageRepo: ISessionMessageRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(ORGANIZATION_REPO_TOKEN) private readonly orgRepo: IOrganizationRepository,
    @inject(SKILL_REPO_TOKEN) private readonly skillRepo: ISkillRepository,
    @inject(PROMPT_BUILDER_TOKEN) private readonly promptBuilder: IPromptBuilder,
    @inject(SETTINGS_REPO_TOKEN) private readonly settingsRepo: ISettingsRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {
    // Listen for assistant text to capture AI responses for session messages
    this.runEngine.onAssistantText((runId, text) => {
      const existing = this.runAssistantText.get(runId) ?? '';
      this.runAssistantText.set(runId, existing + text);
    });
  }

  /**
   * Execute an AI run within a session context.
   * Called when user sends a message (first or subsequent).
   *
   * @param skipUserMessage Set true when the caller already stored the human
   *   message (e.g. SessionService.startSession stores the initial message).
   */
  async executeInSession(
    sessionId: string,
    userMessage: string,
    skipUserMessage = false,
  ): Promise<RunResult> {
    const sessionT0 = Date.now();
    console.log(`[session-coordinator] [${sessionId.slice(0, 8)}] executeInSession start`, { skipUserMessage, messageLength: userMessage.length });

    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status !== 'active') throw new Error(`Session is not active: ${sessionId}`);

    // 1. Store user message (unless already stored by caller)
    if (!skipUserMessage) {
      await this.messageRepo.create({
        sessionId,
        authorType: 'human',
        content: userMessage,
      });

      this.eventBus.emit({
        type: 'session:message-added',
        timestamp: new Date().toISOString(),
        payload: { sessionId, authorType: 'human' },
      });
    }

    // 2. Build prompt
    const promptCtx = await this.buildSessionPromptContext(session);
    const prompt = this.promptBuilder.buildForSession(promptCtx);
    console.log(`[session-coordinator] [${sessionId.slice(0, 8)}] Prompt built at +${Date.now() - sessionT0}ms (${prompt.length} chars, phase: ${promptCtx.phase})`);

    // 3. Resolve org name for context label
    const org = await this.orgRepo.findById(session.orgId);
    const contextLabel = org?.name ?? session.orgId;

    // 4. Execute via RunEngine
    console.log(`[session-coordinator] [${sessionId.slice(0, 8)}] Calling RunEngine.execute at +${Date.now() - sessionT0}ms`, { cliSessionId: session.cliSessionId ? session.cliSessionId.slice(0, 8) + '...' : 'none' });
    const result = await this.runEngine.execute({
      roleId: session.roleId,
      orgId: session.orgId,
      prompt,
      contextId: session.id,
      contextLabel,
      sessionId: session.cliSessionId ?? undefined,
      mcpContext: this.getMcpContext(session.type),
    });

    // 5. Store AI response + update session
    // Always clean up buffered text regardless of status
    const aiText = (this.runAssistantText.get(result.runId) ?? result.summary ?? '').trim();
    this.runAssistantText.delete(result.runId);

    if (result.status === 'succeeded') {
      // Update CLI session ID for --resume
      if (result.sessionId) {
        await this.sessionRepo.updateCliSessionId(sessionId, result.sessionId);
      }

      if (aiText) {
        await this.messageRepo.create({
          sessionId,
          authorType: 'ai',
          content: aiText,
        });

        this.eventBus.emit({
          type: 'session:message-added',
          timestamp: new Date().toISOString(),
          payload: { sessionId, authorType: 'ai' },
        });
      } else {
        this.logger.warn('AI run succeeded but produced no text output', {
          sessionId, runId: result.runId,
        });
      }
    } else if (result.status === 'failed' && result.errorMessage) {
      // Store error as system message so user sees what went wrong
      await this.messageRepo.create({
        sessionId,
        authorType: 'system',
        content: `Run failed: ${result.errorMessage}`,
      });

      this.eventBus.emit({
        type: 'session:message-added',
        timestamp: new Date().toISOString(),
        payload: { sessionId, authorType: 'system' },
      });
    }

    // 6. Emit completion event
    console.log(`[session-coordinator] [${sessionId.slice(0, 8)}] Session run finished at +${Date.now() - sessionT0}ms`, { status: result.status, aiTextLength: aiText.length });
    this.eventBus.emit({
      type: 'session:run-completed',
      timestamp: new Date().toISOString(),
      payload: { sessionId, status: result.status, runId: result.runId },
    });

    return result;
  }

  private getMcpContext(type: SessionType): McpExecutionContext {
    switch (type) {
      case 'planning': return 'session:planning';
      case 'adhoc': return 'session:adhoc';
    }
  }

  private async buildSessionPromptContext(session: Session): Promise<SessionPromptContext> {
    // Resolve role
    const role = await this.roleRepo.findById(session.roleId);
    const roleName = role?.name ?? 'AI Assistant';
    const rolePersona = role?.persona ?? '';

    // Detect phase from AI message count since last role switch
    const messages = await this.messageRepo.findBySessionId(session.id);
    const lastSwitchIdx = messages.findLastIndex(
      (m) => m.authorType === 'system' && m.content.startsWith('__role_switched:'),
    );
    const relevantMessages = lastSwitchIdx >= 0 ? messages.slice(lastSwitchIdx + 1) : messages;
    const aiMessageCount = relevantMessages.filter((m) => m.authorType === 'ai').length;
    const phase: PlanningPhase =
      aiMessageCount >= 4 ? 'structure' :
      aiMessageCount >= 2 ? 'focus' : 'diverge';

    // Build org roles context
    const orgRoles = await this.buildOrgRolesContext(session.orgId);

    // Load communication language
    let communicationLanguage: string | undefined;
    try {
      communicationLanguage = await this.settingsRepo.get('locale') ?? undefined;
    } catch { /* default */ }

    // Load org instructions
    const org = await this.orgRepo.findById(session.orgId);
    const orgInstructions = org?.customInstructions?.trim() || undefined;

    return {
      roleName,
      rolePersona,
      phase,
      orgRoles,
      communicationLanguage,
      orgInstructions,
    };
  }

  private async buildOrgRolesContext(
    orgId: string,
  ): Promise<Array<{ id: string; name: string; skillDescriptions: string[] }>> {
    const roles = await this.roleRepo.findByOrgId(orgId);
    const result: Array<{ id: string; name: string; skillDescriptions: string[] }> = [];

    for (const role of roles) {
      if (role.isSystemRole) continue;
      const skillDescriptions: string[] = [];
      for (const skillId of role.skillIds) {
        const skill = await this.skillRepo.findById(skillId);
        if (skill) skillDescriptions.push(skill.description);
      }
      result.push({ id: role.id, name: role.name, skillDescriptions });
    }

    return result;
  }
}
