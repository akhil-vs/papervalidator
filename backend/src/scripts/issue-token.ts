import { fileURLToPath } from 'node:url';
import { isUuid } from '../domain/ids.js';
import { loadEnvFile, requiredEnv } from '../infrastructure/config/env.js';
import { JwtTokenService } from '../infrastructure/jwt/jwt-token-service.js';

loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));

const teacherId = process.argv[2] ?? '';
const schoolId = process.argv[3] ?? '';
const role = process.argv[4] ?? 'teacher';
if (!isUuid(teacherId) || !isUuid(schoolId) || (role !== 'coordinator' && role !== 'teacher')) {
  console.error('Usage: npm run token -- <teacherId> <schoolId> [coordinator|teacher]');
  process.exit(1);
}

const tokens = new JwtTokenService(requiredEnv('JWT_SECRET'));
process.stdout.write(`${tokens.issue({ teacherId, schoolId, role }, 12 * 60 * 60)}\n`);
