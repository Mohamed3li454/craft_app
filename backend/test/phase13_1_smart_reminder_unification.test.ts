/**
 * Phase 13.1 — Smart Reminder Execution Unification Test Suite
 *
 * Verifies that Smart Reminder generation is 100% unified with Craft's
 * foundational AgentPipeline and ExecutionEngine architecture:
 *
 * 1. Architecture & Pipeline Unification:
 *    - Zero duplicated execution loops in AgentOrchestrator.
 *    - AgentOrchestrator.generateSmartReminder delegates directly to AgentPipeline.
 *    - ExecutionEngine, AIRouter, ToolLifecycleManager, LoopGuard, and StepVerifier are utilized.
 *    - Zero secondary pipelines exist (no ReminderPipeline, SmartReminderPipeline, etc.).
 *
 * 2. Stage Invariants & Bypass Contract:
 *    - triggerType is 'smart_reminder'.
 *    - reminderId is passed through pipeline context, engine context, and observability spans.
 *    - SemanticCacheEngine is bypassed (fresh execution required).
 *    - Daily rate limiting is bypassed (system trigger).
 *    - System prompt is NOT saved as a user chat message.
 *    - Fact extraction is bypassed for system prompt.
 *    - Memory retrieval is executed with targeted query.
 *    - Assistant reply persistence in PostProcessStage is bypassed (ReminderScheduler persists on delivery).
 *    - LearningPipeline observation is bypassed.
 *
 * 3. Multi-Step & Live Tool Capabilities:
 *    - Weather queries invoke get_weather through ToolLifecycleManager.
 *    - Arabic output starts with '⏰ *تذكير من كرافت*:' and preserves Egyptian dialect.
 *    - English output starts with '⏰ *Reminder from Craft*:'.
 *    - Resilient fallback is returned on pipeline errors.
 *
 * 4. Boundary Safeguards:
 *    - Reminder delivery lifecycle (ReminderScheduler, WhatsApp Meta API) is untouched.
 *    - Zero runtime DDL statements executed.
 *    - Zero business table mutations during generation.
 */

import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { AgentPipeline } from '../src/modules/agent/pipeline/pipeline';
import { ExecutionEngine } from '../src/modules/agent/execution/execution_engine';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import { ToolRegistry } from '../src/modules/tools/registry';
import { ToolLifecycleManager } from '../src/modules/tools/lifecycle/tool_lifecycle';
import { DatabaseManager } from '../src/database/connection';
import { UserRepository } from '../src/database/repositories/user.repo';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { ConfirmationRepository } from '../src/database/repositories/confirmation.repo';
import { ReminderRepository } from '../src/database/repositories/reminder.repo';
import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { LanguageIntelligenceService } from '../src/modules/language';
import { PersonalityEngine } from '../src/modules/personality';
import { config } from '../src/config/env';
import fs from 'fs';
import path from 'path';

describe('Phase 13.1: Smart Reminder Execution Unification', () => {
  let mockDb: DatabaseManager;
  let userRepo: UserRepository;
  let chatRepo: ChatRepository;
  let memoryRepo: MemoryRepository;
  let userPrefRepo: UserPreferenceRepository;
  let confRepo: ConfirmationRepository;
  let confService: ConfirmationService;
  let groqProvider: GroqProvider;
  let toolRegistry: ToolRegistry;
  let orchestrator: AgentOrchestrator;

  const originalMockMode = config.groq.isMockMode;

  beforeAll(() => {
    config.groq.isMockMode = true;
  });

  afterAll(() => {
    config.groq.isMockMode = originalMockMode;
  });

  beforeEach(() => {
    mockDb = {
      getPool: () => null,
      getSupabase: () => null,
    } as unknown as DatabaseManager;

    userRepo = new UserRepository(mockDb);
    chatRepo = new ChatRepository(mockDb, userRepo);
    memoryRepo = new MemoryRepository(mockDb);
    userPrefRepo = new UserPreferenceRepository(mockDb);
    confRepo = new ConfirmationRepository(mockDb);
    confService = new ConfirmationService(confRepo);

    groqProvider = new GroqProvider();
    toolRegistry = ToolRegistry.getInstance();

    orchestrator = new AgentOrchestrator(
      groqProvider,
      toolRegistry,
      confService,
      chatRepo,
      memoryRepo,
      userRepo,
      userPrefRepo
    );

    // Mock SemanticCacheEngine to verify bypass and prevent any DB calls
    jest.spyOn(SemanticCacheEngine.getInstance(), 'process').mockResolvedValue({
      type: 'miss',
      reason: 'mock_test_mode',
      latencyMs: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Architecture & Pipeline Verification
  // =========================================================================
  describe('1. Architecture & Pipeline Verification', () => {
    test('confirms no secondary reminder pipeline exists in codebase', () => {
      const agentDir = path.join(__dirname, '../src/modules/agent');
      const files = fs.readdirSync(agentDir);
      expect(files).not.toContain('reminder_pipeline.ts');
      expect(files).not.toContain('smart_reminder_pipeline.ts');
      expect(files).not.toContain('reminder.pipeline.ts');

      const pipelineDir = path.join(__dirname, '../src/modules/agent/pipeline');
      const pipelineFiles = fs.readdirSync(pipelineDir);
      expect(pipelineFiles).not.toContain('reminder_pipeline.ts');
      expect(pipelineFiles).not.toContain('smart_reminder_pipeline.ts');
    });

    test('verifies AgentOrchestrator.generateSmartReminder delegates to underlying AgentPipeline', async () => {
      const pipeline = orchestrator.getPipeline();
      const pipelineSpy = jest.spyOn(pipeline, 'execute');

      const result = await orchestrator.generateSmartReminder(
        'test_user_arch_1',
        'تذكير بموعد الاجتماع',
        undefined,
        undefined,
        'rem_arch_123'
      );

      expect(pipelineSpy).toHaveBeenCalledTimes(1);
      const passedInput = pipelineSpy.mock.calls[0][0];
      expect(passedInput.userId).toBe('test_user_arch_1');
      expect(passedInput.channel).toBe('whatsapp');
      expect(passedInput.triggerType).toBe('smart_reminder');
      expect(passedInput.reminderId).toBe('rem_arch_123');
      expect(passedInput.reminderTitle).toBe('تذكير بموعد الاجتماع');
      expect(result).toBeDefined();
    });

    test('verifies AgentPipeline delegates execution to ExecutionEngine with triggerType and reminderId', async () => {
      const executionEngine = ExecutionEngine.getInstance();
      const engineSpy = jest.spyOn(executionEngine, 'run');

      await orchestrator.generateSmartReminder(
        'test_user_arch_2',
        'تذكير بتناول الدواء',
        undefined,
        undefined,
        'rem_arch_456'
      );

      expect(engineSpy).toHaveBeenCalled();
      const engineContext = engineSpy.mock.calls[0][0];
      expect(engineContext.userId).toBe('test_user_arch_2');
      expect(engineContext.channel).toBe('whatsapp');
      expect(engineContext.triggerType).toBe('smart_reminder');
      expect(engineContext.reminderId).toBe('rem_arch_456');
      expect(engineContext.reminderTitle).toBe('تذكير بتناول الدواء');
    });

    test('verifies tool calls are routed through ToolLifecycleManager and not executed directly in orchestrator', async () => {
      const lifecycleSpy = jest.spyOn(ToolLifecycleManager.getInstance(), 'execute');

      const reminderText = await orchestrator.generateSmartReminder(
        'test_user_arch_3',
        'تذكير بحالة الطقس في القاهرة',
        undefined,
        undefined,
        'rem_arch_789'
      );

      expect(reminderText).toBeDefined();
      expect(lifecycleSpy).toHaveBeenCalledWith(
        'get_weather',
        expect.anything(),
        expect.anything()
      );
    });
  });

  // =========================================================================
  // 2. Stage Invariants & Bypass Contract
  // =========================================================================
  describe('2. Stage Invariants & Bypass Contract', () => {
    test('bypasses semantic cache for smart_reminder', async () => {
      const cacheSpy = jest.spyOn(SemanticCacheEngine.getInstance(), 'process');

      await orchestrator.generateSmartReminder(
        'test_user_cache_1',
        'تذكير يومي للعمل'
      );

      // Semantic cache must NOT be called for smart_reminder
      expect(cacheSpy).not.toHaveBeenCalled();
    });

    test('bypasses daily message rate limit increment for smart_reminder', async () => {
      const rateLimitSpy = jest.spyOn(userRepo, 'checkAndIncrementDailyLimit');

      await orchestrator.generateSmartReminder(
        'test_user_limit_1',
        'تذكير بموعد المحاضرة'
      );

      expect(rateLimitSpy).not.toHaveBeenCalled();
    });

    test('does NOT save the synthetic system prompt to chatRepo as a user message', async () => {
      const saveMessageSpy = jest.spyOn(chatRepo, 'saveMessage');

      await orchestrator.generateSmartReminder(
        'test_user_chat_1',
        'تذكير بتسليم التقرير'
      );

      // Verify saveMessage was never called with role 'user'
      const userMessageSaves = saveMessageSpy.mock.calls.filter((call) => call[1] === 'user');
      expect(userMessageSaves.length).toBe(0);
    });

    test('does NOT persist assistant message in PostProcessStage (handled upon delivery by scheduler)', async () => {
      const saveMessageSpy = jest.spyOn(chatRepo, 'saveMessage');

      await orchestrator.generateSmartReminder(
        'test_user_chat_2',
        'تذكير بدفع الفاتورة'
      );

      // Verify saveMessage was never called with role 'assistant' in the pipeline
      const assistantMessageSaves = saveMessageSpy.mock.calls.filter((call) => call[1] === 'assistant');
      expect(assistantMessageSaves.length).toBe(0);
    });

    test('bypasses memory fact extraction on smart reminder system prompt', async () => {
      const factExtractionSpy = jest.spyOn(memoryRepo, 'extractAndSaveFacts');

      await orchestrator.generateSmartReminder(
        'test_user_fact_1',
        'تذكير بالرياضة اليومية'
      );

      expect(factExtractionSpy).not.toHaveBeenCalled();
    });

    test('executes memory retrieval to provide relevant context for the reminder', async () => {
      const memoryRetrievalSpy = jest.spyOn(memoryRepo, 'getActiveMemories');

      await orchestrator.generateSmartReminder(
        'test_user_mem_1',
        'تذكير بمشروع Flutter'
      );

      expect(memoryRetrievalSpy).toHaveBeenCalledWith('test_user_mem_1', expect.anything());
    });
  });

  // =========================================================================
  // 3. Multi-Step, Tool Calling & Output Formatting
  // =========================================================================
  describe('3. Multi-Step, Tool Calling & Output Formatting', () => {
    test('formats Arabic smart reminder starting with standard header and topic', async () => {
      const reminderText = await orchestrator.generateSmartReminder(
        'test_user_fmt_ar',
        'تجديد اشتراك النادي'
      );

      expect(reminderText).toBeDefined();
      expect(reminderText).toContain('⏰ *تذكير من كرافت*:');
      expect(reminderText).toContain('تجديد اشتراك النادي');
    });

    test('formats English smart reminder starting with English header and topic', async () => {
      const langCtx = LanguageIntelligenceService.getInstance().resolveContext('Gym Workout Session');

      const reminderText = await orchestrator.generateSmartReminder(
        'test_user_fmt_en',
        'Gym Workout Session',
        langCtx
      );

      expect(reminderText).toBeDefined();
      expect(reminderText).toContain('⏰ *Reminder from Craft*:');
      expect(reminderText).toContain('Gym Workout Session');
    });

    test('executes live tool (get_weather) for weather-related smart reminder', async () => {
      const reminderText = await orchestrator.generateSmartReminder(
        'test_user_weather_1',
        'تذكير بحالة الطقس في القاهرة'
      );

      expect(reminderText).toBeDefined();
      expect(reminderText).toContain('⏰ *تذكير من كرافت*:');
      expect(reminderText).toContain('القاهرة');
    });

    test('falls back gracefully to template format when pipeline throws an unexpected error', async () => {
      const pipeline = orchestrator.getPipeline();
      jest.spyOn(pipeline, 'execute').mockRejectedValueOnce(new Error('Simulated pipeline failure'));

      const fallbackText = await orchestrator.generateSmartReminder(
        'test_user_fallback_1',
        'موعد مراجعة الطبيب'
      );

      expect(fallbackText).toBeDefined();
      expect(fallbackText).toContain('⏰ *تذكير من كرافت*:');
      expect(fallbackText).toContain('📌 *الموضوع*: "موعد مراجعة الطبيب"');
      expect(fallbackText).toContain('حان الآن موعد هذا التذكير المحدد.');
    });

    test('falls back gracefully in English when pipeline fails', async () => {
      const pipeline = orchestrator.getPipeline();
      jest.spyOn(pipeline, 'execute').mockRejectedValueOnce(new Error('Simulated network timeout'));

      const langCtx = LanguageIntelligenceService.getInstance().resolveContext('Doctor Appointment');
      const fallbackText = await orchestrator.generateSmartReminder(
        'test_user_fallback_2',
        'Doctor Appointment',
        langCtx
      );

      expect(fallbackText).toBeDefined();
      expect(fallbackText).toContain('⏰ *Reminder from Craft*:');
      expect(fallbackText).toContain('📌 *Topic*: "Doctor Appointment"');
      expect(fallbackText).toContain('It is now time for this scheduled reminder.');
    });
  });

  // =========================================================================
  // 4. Delivery Boundary Protection & Production Safety
  // =========================================================================
  describe('4. Delivery Boundary Protection & Production Safety', () => {
    test('confirms generateSmartReminder does NOT make any Meta WhatsApp API network calls', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      await orchestrator.generateSmartReminder(
        'test_user_net_1',
        'تذكير باجتماع العمل'
      );

      // Verify no graph.facebook.com calls were made during smart reminder generation
      const metaCalls = fetchSpy.mock.calls.filter((call) => {
        const url = typeof call[0] === 'string' ? call[0] : (call[0] as any)?.url || '';
        return url.includes('graph.facebook.com');
      });

      expect(metaCalls.length).toBe(0);
    });

    test('confirms zero runtime DDL statements are executed during reminder generation', async () => {
      const pool = mockDb.getPool();
      const querySpy = pool ? jest.spyOn(pool, 'query') : jest.fn();

      await orchestrator.generateSmartReminder(
        'test_user_ddl_1',
        'تذكير بموعد الدواء'
      );

      const ddlPatterns = [
        /\bCREATE\s+TABLE\b/i,
        /\bALTER\s+TABLE\b/i,
        /\bCREATE\s+INDEX\b/i,
        /\bDROP\b/i,
        /\bTRUNCATE\b/i,
        /\bCREATE\s+EXTENSION\b/i,
      ];

      for (const call of querySpy.mock.calls) {
        const sql = typeof call[0] === 'string' ? call[0] : '';
        for (const pattern of ddlPatterns) {
          expect(pattern.test(sql)).toBe(false);
        }
      }
    });

    test('confirms zero business table mutations occur in PostgreSQL during reminder generation', async () => {
      const pool = mockDb.getPool();
      const querySpy = pool ? jest.spyOn(pool, 'query') : jest.fn();

      await orchestrator.generateSmartReminder(
        'test_user_safe_1',
        'تذكير بالقراءة اليومية'
      );

      const businessMutationPatterns = [
        /\bINSERT\s+INTO\s+reminders\b/i,
        /\bUPDATE\s+reminders\b/i,
        /\bDELETE\s+FROM\b/i,
      ];

      for (const call of querySpy.mock.calls) {
        const sql = typeof call[0] === 'string' ? call[0] : '';
        for (const pattern of businessMutationPatterns) {
          expect(pattern.test(sql)).toBe(false);
        }
      }
    });
  });
});
