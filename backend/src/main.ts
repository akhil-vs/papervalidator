import { fileURLToPath } from 'node:url';
import { TeacherService } from './application/teacher-service.js';
import { loadEnvFile, requiredEnv } from './infrastructure/config/env.js';
import { JwtTokenService } from './infrastructure/jwt/jwt-token-service.js';
import { createLogger } from './infrastructure/logging/logger.js';
import { createPool, createTeacherRepository } from './infrastructure/postgres/teacher-repository.js';
import { createHttpServer } from './interfaces/http/server.js';

loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));

const logger = createLogger();
const tokens = new JwtTokenService(requiredEnv('JWT_SECRET'));
const pool = createPool(requiredEnv('DATABASE_URL'));
const server = createHttpServer({
  teachers: new TeacherService(createTeacherRepository(pool)),
  tokens,
  logger,
});

const port = portNumber(process.env.PORT);
server.listen(port, '0.0.0.0', () => {
  logger.info('http.listen', { port });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('http.stop', { signal });
  server.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

function portNumber(value: string | undefined): number {
  const port = value === undefined || value.trim() === '' ? 8080 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }
  return port;
}
