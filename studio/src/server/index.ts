/**
 * HTTP API 服务器启动程序
 *
 * 初始化数据库、创建 Express 应用、监听端口。
 * 用于开发、测试和生产环境。
 */

import { createApp } from './app';
import { DatabaseManager } from '@service/db';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8799;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../.data');

async function startServer(): Promise<void> {
  try {
    console.log(`[Studio API] Initializing database at ${DATA_DIR}...`);

    const db = new DatabaseManager();
    db.init(DATA_DIR);

    const health = db.health();
    if (!health.isCompatible) {
      throw new Error(
        `Database schema version mismatch: expected ${health.expectedVersion}, got ${health.schemaVersion}`
      );
    }

    console.log(`[Studio API] Database initialized (v${health.schemaVersion})`);

    const app = createApp({ db });

    app.listen(PORT, () => {
      console.log(`[Studio API] Server listening on port ${PORT}`);
      console.log(`[Studio API] http://localhost:${PORT}/api/health`);
    });

    // 优雅关闭
    process.on('SIGTERM', () => {
      console.log('[Studio API] SIGTERM received, shutting down gracefully...');
      db.close();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('[Studio API] SIGINT received, shutting down gracefully...');
      db.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('[Studio API] Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
