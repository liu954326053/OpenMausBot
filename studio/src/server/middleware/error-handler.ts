/**
 * HTTP 错误处理中间件
 *
 * 统一的错误响应格式，包含错误代码、消息和详情。
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ErrorResponse {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, any>;
}

export function errorHandler(
  err: Error | ApiError | ZodError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: Record<string, any> | undefined;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = {
      issues: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
    };
  } else if (err instanceof Error) {
    message = err.message;
  }

  res.status(statusCode).json({
    code,
    message,
    statusCode,
    ...(details && { details }),
  } as ErrorResponse);
}
