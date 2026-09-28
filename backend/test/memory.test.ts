import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { SaveMemoryTool } from '../src/modules/tools/builtins/memory.tool';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';

describe('Long-Term Memory & User Profile Intelligence', () => {
  let memoryRepo: MemoryRepository;
  let saveMemoryTool: SaveMemoryTool;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    memoryRepo = new MemoryRepository();
    saveMemoryTool = new SaveMemoryTool(memoryRepo);
    orchestrator = new AgentOrchestrator();
  });

  test('saves and retrieves memory facts for a user', async () => {
    await memoryRepo.saveFact('test_user_mem', 'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر', 'profession');
    await memoryRepo.saveFact('test_user_mem', 'المستخدم يفضل اللهجة المصرية', 'preference');

    const memories = await memoryRepo.getMemories('test_user_mem');
    expect(memories.length).toBe(2);
    expect(memories).toContain('المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر');
    expect(memories).toContain('المستخدم يفضل اللهجة المصرية');
  });

  test('extractAndSaveFacts automatically extracts profession and dialect', async () => {
    const testUserId = 'test_user_auto_' + Date.now();
    const extracted1 = await memoryRepo.extractAndSaveFacts(testUserId, 'انا mobile dev flutter بالمناسبة يعني');
    expect(extracted1.length).toBeGreaterThanOrEqual(1);

    const extracted2 = await memoryRepo.extractAndSaveFacts(testUserId, 'انت ليه بتتكلم فصحي كلمني مصري عادي');
    expect(extracted2.length).toBeGreaterThanOrEqual(1);

    const memories = await memoryRepo.getMemories(testUserId);
    expect(memories.some((m) => m.includes('Flutter'))).toBe(true);

    // Phase 4.5: Language preferences are routed to user_preferences and isolated from memory_items
    const userPrefRepo = new UserPreferenceRepository();
    const langPref = await userPrefRepo.getLanguagePreference(testUserId);
    expect(langPref?.dialect).toBe('egyptian');
    expect(memories.some((m) => m.includes('المصرية'))).toBe(false);
  });

  test('SaveMemoryTool executes and persists fact', async () => {
    const result = await saveMemoryTool.execute(
      { fact: 'المستخدم مهتم بتعلم الذكاء الاصطناعي', category: 'interests' },
      { userId: 'test_user_tool', conversationId: 'conv-1', channel: 'whatsapp' }
    );

    expect(result.success).toBe(true);
    const memories = await memoryRepo.getMemories('test_user_tool');
    expect(memories).toContain('المستخدم مهتم بتعلم الذكاء الاصطناعي');
  });

  test('orchestrator remembers profession and answers correctly', async () => {
    // 1. User introduces himself as flutter dev
    await orchestrator.run({
      userId: 'test_user_chat_mem',
      channel: 'whatsapp',
      text: 'انا mobile dev flutter بالمناسبة يعني',
    });

    // 2. Later, user asks what his job was
    const answer = await orchestrator.run({
      userId: 'test_user_chat_mem',
      channel: 'whatsapp',
      text: 'تمام انت فاكر انا شغلانتي كانت اي صحيح',
    });

    expect(answer.status).toBe('completed');
    expect(answer.replyText).toContain('فلاتر');
  });
});
