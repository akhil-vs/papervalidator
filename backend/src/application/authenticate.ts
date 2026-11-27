import { Unauthorized } from '../domain/errors.js';
import type { Principal } from '../domain/teacher.js';
import type { TokenVerifier } from './ports.js';

export function principalFromAuthorization(tokens: TokenVerifier, header: string | undefined): Principal {
  if (!header) throw new Unauthorized();
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match?.[1]) throw new Unauthorized();
  const principal = tokens.verify(match[1]);
  if (!principal) throw new Unauthorized();
  return principal;
}
