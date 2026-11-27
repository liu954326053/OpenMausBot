/**
 * HTTP 请求日志中间件
 *
 * 记录所有请求的方法、路径、响应时间和状态码。
 */

import { Request, Response, NextFunction } from 'express';

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();

  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const contentLength = Buffer.byteLength(JSON.stringify(data));

    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.path} ${statusCode} ${duration}ms (${contentLength}B)`
    );

    return originalSend.call(this, data);
  };

  next();
}
