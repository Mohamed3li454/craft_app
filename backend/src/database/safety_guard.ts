/**
 * Database Safety Guard
 * Prevents test mutations from executing against live production databases.
 */

export function isProductionDatabase(url?: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('supabase.com') ||
    lower.includes('supabase.co') ||
    lower.includes('pooler.supabase.com') ||
    lower.includes('neon.tech') ||
    lower.includes('psdb.cloud') ||
    lower.includes('prod') ||
    lower.includes('production')
  );
}

export function isTestDatabase(url?: string): boolean {
  if (!url) return false;
  if (isProductionDatabase(url)) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('test') ||
    lower.includes('mock') ||
    lower.includes('sqlite') ||
    lower.includes('memory')
  );
}

export function assertTestDatabaseSafety(env: {
  nodeEnv?: string;
  databaseUrl?: string;
  allowLiveDbTests?: string;
} = {
  nodeEnv: process.env.NODE_ENV,
  databaseUrl: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  allowLiveDbTests: process.env.ALLOW_LIVE_DB_TESTS,
}): void {
  if (env.nodeEnv === 'production') {
    throw new Error('SAFETY_VIOLATION: Refusing to run integration tests when NODE_ENV=production.');
  }

  if (isProductionDatabase(env.databaseUrl) && env.allowLiveDbTests !== 'true') {
    throw new Error(
      'SAFETY_VIOLATION: Refusing to run integration tests against production database URL. Isolated or mocked database required.'
    );
  }
}
