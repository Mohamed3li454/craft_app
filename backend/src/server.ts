import { createApp } from './app';
import { config } from './config/env';
import { logger } from './core/logger';
import { DatabaseManager } from './database/connection';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`Craft AI Agent Backend running on port [${config.port}]`, {
    env: config.nodeEnv,
    mockMode: config.gemini.isMockMode,
  });
});

// Graceful Shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    await DatabaseManager.getInstance().close();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
