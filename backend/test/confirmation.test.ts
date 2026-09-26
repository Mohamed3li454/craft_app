import { ConfirmationService } from '../src/modules/confirmation/confirmation.service';

describe('ConfirmationService', () => {
  let service: ConfirmationService;

  beforeEach(() => {
    service = new ConfirmationService();
  });

  test('creates a confirmation request with pending status and token', async () => {
    const request = await service.createConfirmationRequest(
      'run-123',
      'user-1',
      'send_email',
      'Confirm sending email to client',
      { to: 'test@example.com' }
    );

    expect(request.token).toBeDefined();
    expect(request.token.length).toBeGreaterThan(8);
    expect(request.status).toBe('pending');
    expect(request.actionName).toBe('send_email');
  });

  test('approves a pending confirmation token', async () => {
    const request = await service.createConfirmationRequest(
      'run-124',
      'user-1',
      'create_event',
      'Confirm adding meeting',
      {}
    );

    const result = await service.verifyAndResolve(request.token, 'approved');
    expect(result.success).toBe(true);
    expect(result.message).toContain('approved');
  });

  test('prevents replay attacks on already resolved tokens', async () => {
    const request = await service.createConfirmationRequest(
      'run-125',
      'user-1',
      'delete_chat',
      'Confirm deleting chat',
      {}
    );

    // First resolution: approved
    const firstRes = await service.verifyAndResolve(request.token, 'approved');
    expect(firstRes.success).toBe(true);

    // Second resolution: must fail
    const replayRes = await service.verifyAndResolve(request.token, 'approved');
    expect(replayRes.success).toBe(false);
    expect(replayRes.message).toContain('Replay rejected');
  });

  test('rejects non-existent tokens', async () => {
    const result = await service.verifyAndResolve('invalid-token-xyz', 'approved');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid');
  });

  afterAll(async () => {
    const { DatabaseManager } = require('../src/database/connection');
    const db = DatabaseManager.getInstance();
    const pool = db.getPool();
    if (pool) {
      await pool.query("DELETE FROM users WHERE name = 'user-1'");
    }
  });
});
