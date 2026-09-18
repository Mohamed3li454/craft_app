import { Request, Response } from 'express';
import { AgentOrchestrator } from '../agent/orchestrator';
import { ConfirmationService } from '../confirmation/confirmation.service';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { logger } from '../../core/logger';

export class ChatController {
  constructor(
    private orchestrator: AgentOrchestrator = new AgentOrchestrator(),
    private confirmationService: ConfirmationService = new ConfirmationService(),
    private chatRepo: ChatRepository = new ChatRepository()
  ) {}

  /**
   * POST /api/v1/chat
   * Standard REST Chat endpoint for Flutter
   */
  public handleChat = async (req: Request, res: Response): Promise<void> => {
    try {
      const { message, userId = 'user_flutter_1', conversationId, imagePath } = req.body;

      if (!message && !imagePath) {
        res.status(400).json({ success: false, error: 'Message or imagePath required.' });
        return;
      }

      const result = await this.orchestrator.run({
        userId,
        conversationId,
        channel: 'flutter',
        text: message || 'Analyze attached image',
        mediaUrl: imagePath,
      });

      res.status(200).json({
        success: true,
        reply: result.replyText,
        text: result.replyText, // Compatibility alias
        conversationId: result.conversationId,
        agentRunId: result.agentRunId,
        status: result.status,
        toolCalls: result.toolCallsExecuted,
        confirmationRequest: result.confirmationRequest,
      });
    } catch (err: any) {
      logger.error('Error in /api/v1/chat', { error: err.message });
      res.status(500).json({ success: false, error: err.message || 'Internal server error' });
    }
  };

  /**
   * POST /api/v1/chat/stream
   * Server-Sent Events (SSE) Streaming endpoint for Flutter
   */
  public handleStream = async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { message, userId = 'user_flutter_1', conversationId } = req.body;

      sendEvent('agent_started', {
        type: 'agent_started',
        userId,
        createdAt: new Date().toISOString(),
      });

      const result = await this.orchestrator.run({
        userId,
        conversationId,
        channel: 'flutter',
        text: message || '',
      });

      // Stream tool calls if any were executed
      for (const tc of result.toolCallsExecuted) {
        sendEvent('tool_call_finished', {
          type: 'tool_call_finished',
          toolName: tc.toolName,
          result: tc.result,
        });
      }

      // Stream confirmation if required
      if (result.confirmationRequest) {
        sendEvent('confirmation_required', {
          type: 'confirmation_required',
          confirmation: result.confirmationRequest,
        });
      }

      // Stream final reply text
      sendEvent('text_delta', {
        type: 'text_delta',
        delta: result.replyText,
      });

      sendEvent('message_completed', {
        type: 'message_completed',
        conversationId: result.conversationId,
        agentRunId: result.agentRunId,
        status: result.status,
      });

      res.end();
    } catch (err: any) {
      sendEvent('agent_failed', {
        type: 'agent_failed',
        error: err.message || 'Unknown stream failure',
      });
      res.end();
    }
  };

  /**
   * POST /api/v1/chat/confirm
   * Submit decision for high-risk action confirmation
   */
  public handleConfirmation = async (req: Request, res: Response): Promise<void> => {
    const { token, decision } = req.body;

    if (!token || !['approved', 'rejected'].includes(decision)) {
      res.status(400).json({
        success: false,
        error: 'Token and valid decision ("approved" or "rejected") are required.',
      });
      return;
    }

    const result = await this.confirmationService.verifyAndResolve(token, decision);
    res.status(result.success ? 200 : 400).json(result);
  };

  /**
   * GET /api/v1/conversations
   */
  public listConversations = async (req: Request, res: Response): Promise<void> => {
    const userId = (req.query.userId as string) || 'user_flutter_1';
    const list = await this.chatRepo.listConversations(userId);
    res.status(200).json({ success: true, conversations: list });
  };

  /**
   * GET /api/v1/conversations/:id/messages
   */
  public getMessages = async (req: Request, res: Response): Promise<void> => {
    const conversationId = req.params.id;
    const messages = await this.chatRepo.getRecentMessages(conversationId, 50);
    res.status(200).json({ success: true, messages });
  };
}
