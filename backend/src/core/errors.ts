import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';
import { config } from '../config/env';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request parameters') {
    super(message, 400);
  }
}

export class ToolExecutionError extends AppError {
  public readonly toolName: string;
  constructor(toolName: string, message: string) {
    super(`Tool [${toolName}] failed: ${message}`, 500);
    this.toolName = toolName;
  }
}

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err.message || 'An unexpected internal server error occurred.';

  logger.error(`[Error Handler] ${message}`, {
    stack: config.nodeEnv === 'development' ? err.stack : undefined,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode,
      // Never expose stack traces to production clients
      ...(config.nodeEnv === 'development' && { stack: err.stack }),
    },
  });
}
