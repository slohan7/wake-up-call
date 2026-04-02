import dotenv from 'dotenv';
import { join } from 'path';

// Load test environment variables
dotenv.config({ path: join(__dirname, '..', '.env.test') });

// Set test defaults
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.DRY_RUN_MODE = 'true';
process.env.LLM_PROVIDER = 'mock';
process.env.LOG_LEVEL = 'error';

// Mock console methods during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};