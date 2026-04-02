import winston from 'winston';
import { join } from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const nodeEnv = process.env.NODE_ENV || 'development';

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: nodeEnv === 'development' ? consoleFormat : logFormat,
  }),
];

if (nodeEnv === 'production') {
  transports.push(
    new winston.transports.File({
      filename: join('logs', 'error.log'),
      level: 'error',
      format: logFormat,
    }),
    new winston.transports.File({
      filename: join('logs', 'combined.log'),
      format: logFormat,
    })
  );
}

export const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports,
  exitOnError: false,
});

export const createLogger = (service: string) => {
  return logger.child({ service });
};