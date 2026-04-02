import { logger } from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  onRetry?: (error: Error, attempt: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 30000,
    onRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        logger.error('Max retry attempts reached', {
          attempt,
          error: lastError.message,
        });
        throw lastError;
      }

      const delay = Math.min(
        delayMs * Math.pow(backoffMultiplier, attempt - 1),
        maxDelayMs
      );

      logger.warn(`Retry attempt ${attempt}/${maxAttempts} after ${delay}ms`, {
        error: lastError.message,
      });

      if (onRetry) {
        onRetry(lastError, attempt);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

export function isRetriableError(error: Error): boolean {
  const retriableMessages = [
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'ECONNREFUSED',
    'rate limit',
    'too many requests',
    '429',
    '503',
    '504',
  ];

  const errorMessage = error.message.toLowerCase();
  return retriableMessages.some(msg => errorMessage.includes(msg.toLowerCase()));
}