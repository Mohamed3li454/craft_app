import { AnalyticsController } from '../src/modules/analytics/analytics.controller';
import { AnalyticsRepository } from '../src/database/repositories/analytics.repo';
import { ChatRepository } from '../src/database/repositories/chat.repo';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { config } from '../src/config/env';

describe('Craft AI Analytics & Monitoring Dashboard', () => {
  let controller: AnalyticsController;
  let analyticsRepo: AnalyticsRepository;
  let chatRepo: ChatRepository;
  let orchestrator: AgentOrchestrator;
  const adminSecret = config.admin.secretKey;

  beforeAll(() => {
    process.env.GROQ_MOCK_MODE = 'true';
    analyticsRepo = new AnalyticsRepository();
    chatRepo = new ChatRepository();
    orchestrator = new AgentOrchestrator();
    controller = new AnalyticsController(analyticsRepo);
  });

  describe('Security & Authentication for Analytics API', () => {
    it('rejects unauthenticated requests without token', async () => {
      const req: any = { query: {}, headers: {} };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await controller.getAnalyticsData(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('غير مصرح'),
        })
      );
    });

    it('rejects requests with invalid token', async () => {
      const req: any = { query: { token: 'wrong_secret_123' }, headers: {} };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await controller.getAnalyticsData(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
    });

    it('allows access with valid query token', async () => {
      const req: any = { query: { token: adminSecret }, headers: {} };
      let jsonOutput: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation((val) => {
          jsonOutput = val;
        }),
      };

      await controller.getAnalyticsData(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonOutput.success).toBe(true);
      expect(jsonOutput.overview).toBeDefined();
      expect(jsonOutput.dailyTrends).toBeDefined();
      expect(jsonOutput.modelBreakdown).toBeDefined();
      expect(jsonOutput.mediaBreakdown).toBeDefined();
    });

    it('allows access with valid Bearer token header', async () => {
      const req: any = {
        query: {},
        headers: { authorization: `Bearer ${adminSecret}` },
      };
      let jsonOutput: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation((val) => {
          jsonOutput = val;
        }),
      };

      await controller.getAnalyticsData(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonOutput.success).toBe(true);
    });
  });

  describe('Analytics Data Aggregation', () => {
    it('aggregates overview metrics correctly', async () => {
      const overview = await analyticsRepo.getOverviewStats();
      expect(overview).toHaveProperty('totalConversations');
      expect(overview).toHaveProperty('totalMessages');
      expect(overview).toHaveProperty('totalTokens');
      expect(overview).toHaveProperty('estimatedCostUsd');
      expect(overview).toHaveProperty('avgLatencyMs');
      expect(overview).toHaveProperty('totalUsers');
      expect(typeof overview.totalTokens).toBe('number');
      expect(typeof overview.estimatedCostUsd).toBe('number');
    });

    it('returns daily trends array for requested timeframe', async () => {
      const trends = await analyticsRepo.getDailyTrends(7);
      expect(Array.isArray(trends)).toBe(true);
      expect(trends.length).toBe(7);
      expect(trends[0]).toHaveProperty('date');
      expect(trends[0]).toHaveProperty('userMessages');
      expect(trends[0]).toHaveProperty('botMessages');
    });

    it('returns model usage and media breakdown', async () => {
      const models = await analyticsRepo.getModelBreakdown();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty('model');
      expect(models[0]).toHaveProperty('percentage');

      const media = await analyticsRepo.getMediaTypeBreakdown();
      expect(media).toHaveProperty('text');
      expect(media).toHaveProperty('image');
      expect(media).toHaveProperty('audio');
      expect(media).toHaveProperty('document');
    });

    it('returns top users list and recent interactions', async () => {
      const topUsers = await analyticsRepo.getTopUsers(5);
      expect(Array.isArray(topUsers)).toBe(true);

      const recent = await analyticsRepo.getRecentInteractions(10);
      expect(Array.isArray(recent)).toBe(true);
    });
  });

  describe('AgentOrchestrator Token & Latency Recording', () => {
    it('records tokens, model, and latency during execution and returns metrics', async () => {
      const testUserId = `analytics_user_${Date.now()}`;
      const result = await orchestrator.run({
        userId: testUserId,
        channel: 'flutter',
        text: 'مرحبا يا كرافت، كيف حالك اليوم؟',
      });

      expect(result.status).toBe('completed');
      expect(result.metrics).toBeDefined();
      expect(result.metrics?.modelUsed).toBeDefined();
      expect(result.metrics?.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.totalTokens).toBeGreaterThan(0);

      // Verify message is saved with metadata
      const messages = await chatRepo.getRecentMessages(result.conversationId, 5);
      const assistantMsg = messages.find((m) => m.senderRole === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg?.tokensUsed).toBeGreaterThan(0);
      expect(assistantMsg?.modelName).toBeDefined();
    });
  });

  describe('Conversations & Deep Inspector Endpoints', () => {
    it('returns 24-hour distribution array', async () => {
      const hourly = await analyticsRepo.getHourlyDistribution();
      expect(Array.isArray(hourly)).toBe(true);
      expect(hourly.length).toBe(24);
      expect(hourly[0]).toHaveProperty('hour');
      expect(hourly[0]).toHaveProperty('totalMessages');
    });

    it('returns conversation list with user and message details via controller', async () => {
      const req: any = { query: { token: adminSecret } };
      let jsonOutput: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation((val) => {
          jsonOutput = val;
        }),
      };

      await controller.getConversations(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonOutput.success).toBe(true);
      expect(Array.isArray(jsonOutput.conversations)).toBe(true);
    });

    it('returns full conversation transcript', async () => {
      const conv = await chatRepo.getOrCreateConversation('inspector_user_test', 'whatsapp');
      await chatRepo.saveMessage(conv.id, 'user', 'Tester', 'أريد معرفة الطقس اليوم');
      await chatRepo.saveMessage(conv.id, 'assistant', 'Craft', 'الطقس معتدل وجميل!');

      const transcript = await analyticsRepo.getConversationTranscript(conv.id);
      expect(Array.isArray(transcript)).toBe(true);
      expect(transcript.length).toBeGreaterThanOrEqual(2);
      expect(transcript[0]).toHaveProperty('text');
      expect(transcript[0]).toHaveProperty('sender');
    });

    it('returns deep user details including memories and metrics', async () => {
      const details = await analyticsRepo.getUserDetails('test_inspector_user');
      expect(details).toBeDefined();
      expect(details?.user).toBeDefined();
      expect(details?.metrics).toBeDefined();
      expect(Array.isArray(details?.memories)).toBe(true);
      expect(Array.isArray(details?.reminders)).toBe(true);
    });

    it('returns tools execution statistics', async () => {
      const tools = await analyticsRepo.getToolsStats();
      expect(tools).toHaveProperty('totalWebSearches');
      expect(tools).toHaveProperty('totalRemindersCreated');
      expect(tools).toHaveProperty('confirmations');
      expect(tools.confirmations).toHaveProperty('approved');
    });
  });

  describe('Dashboard UI Serving', () => {
    it('serves dashboard HTML page without crashing', () => {
      const req: any = {};
      const res: any = {
        sendFile: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };

      controller.serveDashboardUI(req, res);
      const sentSomething = res.sendFile.mock.calls.length > 0 || res.send.mock.calls.length > 0;
      expect(sentSomething).toBe(true);
    });
  });
});
