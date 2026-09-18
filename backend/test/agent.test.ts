import { AgentOrchestrator } from '../src/modules/agent/orchestrator';

describe('AgentOrchestrator Lifecycle', () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    orchestrator = new AgentOrchestrator();
  });

  test('runs standard conversational query and completes', async () => {
    const output = await orchestrator.run({
      userId: 'test_user_1',
      channel: 'flutter',
      text: 'مرحبا',
    });

    expect(output.status).toBe('completed');
    expect(output.replyText).toBeDefined();
    expect(output.conversationId).toBeDefined();
    expect(output.agentRunId).toBeDefined();
  });

  test('runs time query, executes get_current_time tool, and returns answer', async () => {
    const output = await orchestrator.run({
      userId: 'test_user_2',
      channel: 'flutter',
      text: 'كم الساعة الآن؟',
    });

    expect(output.status).toBe('completed');
    expect(output.toolCallsExecuted.length).toBeGreaterThan(0);
    expect(output.toolCallsExecuted[0].toolName).toBe('get_current_time');
    expect(output.toolCallsExecuted[0].result.iso).toBeDefined();
  });

  test('runs weather query, executes get_weather tool, and returns result', async () => {
    const output = await orchestrator.run({
      userId: 'test_user_3',
      channel: 'whatsapp',
      text: 'ما حالة الطقس في القاهرة؟',
    });

    expect(output.status).toBe('completed');
    expect(output.toolCallsExecuted.length).toBeGreaterThan(0);
    expect(output.toolCallsExecuted[0].toolName).toBe('get_weather');
    expect(output.toolCallsExecuted[0].result.city).toBeDefined();
  });

  test('intercepts sensitive reminder action and requests confirmation', async () => {
    const output = await orchestrator.run({
      userId: 'test_user_4',
      channel: 'flutter',
      text: 'ذكرني بموعد اجتماع الغد',
    });

    expect(output.status).toBe('waiting_for_confirmation');
    expect(output.confirmationRequest).toBeDefined();
    expect(output.confirmationRequest?.token).toBeDefined();
    expect(output.replyText).toContain('هذا الإجراء يتطلب تأكيدك الصريح');
  });
});
