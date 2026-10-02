import { isProductionDatabase, assertTestDatabaseSafety } from './helpers/db_safety_guard';

describe('Production Test Pollution Prevention Guard', () => {
  it('identifies production database connection strings accurately', () => {
    expect(isProductionDatabase('postgresql://postgres:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres')).toBe(true);
    expect(isProductionDatabase('postgresql://postgres:secret@db.supabase.co:5432/postgres')).toBe(true);
    expect(isProductionDatabase('postgresql://user:pass@ep-cool-fog-1234.neon.tech/neondb')).toBe(true);
    expect(isProductionDatabase('mysql://user:pass@aws.connect.psdb.cloud/prod_db')).toBe(true);
    expect(isProductionDatabase('postgres://localhost:5432/craft_test')).toBe(false);
    expect(isProductionDatabase('postgres://127.0.0.1:5432/test_db')).toBe(false);
    expect(isProductionDatabase(undefined)).toBe(false);
  });

  it('rejects test execution when NODE_ENV is production', () => {
    expect(() => {
      assertTestDatabaseSafety({
        nodeEnv: 'production',
        databaseUrl: 'postgres://localhost:5432/craft_test',
      });
    }).toThrow('SAFETY_VIOLATION: Refusing to run integration tests when NODE_ENV=production.');
  });

  it('rejects test execution when DATABASE_URL points to a production host without explicit allow override', () => {
    expect(() => {
      assertTestDatabaseSafety({
        nodeEnv: 'test',
        databaseUrl: 'postgresql://postgres:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
      });
    }).toThrow('SAFETY_VIOLATION: Refusing to run integration tests against production database URL.');
  });

  it('allows test execution against isolated local test databases', () => {
    expect(() => {
      assertTestDatabaseSafety({
        nodeEnv: 'test',
        databaseUrl: 'postgres://127.0.0.1:5432/craft_test_isolated',
      });
    }).not.toThrow();
  });

  it('allows test execution when explicitly authorized with ALLOW_LIVE_DB_TESTS=true', () => {
    expect(() => {
      assertTestDatabaseSafety({
        nodeEnv: 'test',
        databaseUrl: 'postgresql://postgres:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
        allowLiveDbTests: 'true',
      });
    }).not.toThrow();
  });
});
