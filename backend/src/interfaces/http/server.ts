import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { principalFromAuthorization } from '../../application/authenticate.js';
import type { AuthService } from '../../application/auth-service.js';
import type { Logger, TokenVerifier } from '../../application/ports.js';
import type { TeacherService } from '../../application/teacher-service.js';
import {
  AccessDenied,
  EmailAlreadyUsed,
  EmailUnverified,
  MethodNotAllowed,
  NotFound,
  TooManyRequests,
  Unauthorized,
  ValidationFailed,
  type FieldError,
} from '../../domain/errors.js';
import { toTeacherJson } from '../../domain/teacher.js';

const PROBLEM_BASE = 'https://api.exampapervalidator.example/problems';
const MAX_BODY_BYTES = 65_536;

export type AppDeps = {
  teachers: TeacherService;
  tokens: TokenVerifier;
  logger: Logger;
  auth?: AuthService;
};

type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: { pointer?: string; detail: string }[];
};

export function createHttpServer(deps: AppDeps): Server {
  return createServer((request, response) => {
    void handle(request, response, deps);
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, deps: AppDeps): Promise<void> {
  const started = performance.now();
  const method = request.method ?? 'GET';
  const url = requestUrl(request);
  const path = url.pathname;
  let status = 500;
  let teacherId: string | undefined;
  try {
    status = await route(request, response, deps, url, (id) => {
      teacherId = id;
    });
  } catch (error) {
    status = sendProblem(response, error, path, deps.logger);
  } finally {
    deps.logger.info('http.request', {
      method,
      path,
      status,
      durationMs: Math.round(performance.now() - started),
      teacherId,
    });
  }
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AppDeps,
  url: URL,
  setTeacherId: (id: string) => void
): Promise<number> {
  const method = request.method ?? 'GET';
  const path = url.pathname;

  if (path === '/v1/health') {
    if (method !== 'GET') throw new MethodNotAllowed('GET');
    return sendJson(response, 200, { status: 'ok' });
  }

  const authStatus = await routeAuth(request, response, deps, path, method);
  if (authStatus !== null) return authStatus;

  const principal = principalFromAuthorization(deps.tokens, request.headers.authorization);
  setTeacherId(principal.teacherId);

  if (path === '/v1/me') {
    if (method !== 'GET') throw new MethodNotAllowed('GET');
    const teacher = await deps.teachers.current(principal);
    return sendJson(response, 200, toTeacherJson(teacher));
  }

  if (path === '/v1/teachers') {
    if (method === 'GET') {
      const page = await deps.teachers.list(principal, queryRecord(url));
      return sendJson(response, 200, {
        data: page.data.map(toTeacherJson),
        page: page.page,
      });
    }
    if (method === 'POST') {
      const created = await deps.teachers.create(principal, await readJson(request));
      if (created.email && deps.auth) {
        try {
          await deps.auth.sendPasswordSetup(created);
        } catch (error) {
          deps.logger.error('auth.setup_email', {
            teacherId: created.id,
            message: error instanceof Error ? error.message : 'unknown',
          });
        }
      }
      return sendJson(response, 201, toTeacherJson(created), {
        location: resourceUrl(request, `/v1/teachers/${created.id}`),
      });
    }
    throw new MethodNotAllowed('GET, POST');
  }

  const teacherMatch = /^\/v1\/teachers\/([^/]+)$/.exec(path);
  if (teacherMatch?.[1]) {
    if (method !== 'GET') throw new MethodNotAllowed('GET');
    let teacherId = teacherMatch[1];
    try {
      teacherId = decodeURIComponent(teacherId);
    } catch {
      throw new ValidationFailed([{ pointer: '/teacherId', detail: 'Teacher id is not valid.' }]);
    }
    const teacher = await deps.teachers.get(principal, teacherId);
    return sendJson(response, 200, toTeacherJson(teacher));
  }

  throw new NotFound('Resource was not found.');
}

async function routeAuth(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AppDeps,
  path: string,
  method: string
): Promise<number | null> {
  if (!path.startsWith('/v1/auth/')) return null;
  if (!deps.auth) throw new NotFound('Resource was not found.');
  const ip = request.socket.remoteAddress ?? 'unknown';
  if (path === '/v1/auth/signup') {
    if (method !== 'POST') throw new MethodNotAllowed('POST');
    return sendJson(response, 201, await deps.auth.signup(await readJson(request), ip));
  }
  if (path === '/v1/auth/login') {
    if (method !== 'POST') throw new MethodNotAllowed('POST');
    return sendJson(response, 200, await deps.auth.login(await readJson(request), ip));
  }
  if (path === '/v1/auth/logout') {
    if (method !== 'POST') throw new MethodNotAllowed('POST');
    await deps.auth.logout(await readJson(request));
    return sendEmpty(response, 204);
  }
  if (path === '/v1/auth/refresh') {
    if (method !== 'POST') throw new MethodNotAllowed('POST');
    return sendJson(response, 200, await deps.auth.refresh(await readJson(request)));
  }
  if (path === '/v1/auth/password-resets') {
    if (method !== 'POST') throw new MethodNotAllowed('POST');
    return sendJson(response, 202, await deps.auth.requestPasswordReset(await readJson(request), ip));
  }
  if (path === '/v1/auth/password-resets/confirm') {
    if (method !== 'POST') throw new MethodNotAllowed('POST');
    await deps.auth.confirmPasswordReset(await readJson(request));
    return sendEmpty(response, 204);
  }
  if (path === '/v1/auth/email-verifications') {
    if (method !== 'POST') throw new MethodNotAllowed('POST');
    return sendJson(response, 202, await deps.auth.requestEmailVerification(await readJson(request), ip));
  }
  if (path === '/v1/auth/email-verifications/confirm') {
    if (method !== 'POST') throw new MethodNotAllowed('POST');
    await deps.auth.confirmEmailVerification(await readJson(request));
    return sendEmpty(response, 204);
  }
  throw new NotFound('Resource was not found.');
}

function queryRecord(url: URL): Record<string, string> {
  const seen = new Set<string>();
  const record: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) {
      throw new ValidationFailed([{ pointer: `/${key}`, detail: 'Query parameter is repeated.' }]);
    }
    seen.add(key);
    record[key] = value;
  }
  return record;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type'];
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ValidationFailed([{ detail: 'Content-Type must be application/json.' }]);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new ValidationFailed([{ detail: 'Request body is too large.' }]);
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') {
    throw new ValidationFailed([{ detail: 'Request body is required.' }]);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationFailed([{ detail: 'Request body is not valid JSON.' }]);
  }
}

function requestUrl(request: IncomingMessage): URL {
  const host = request.headers.host ?? 'localhost';
  return new URL(request.url ?? '/', `http://${host}`);
}

function resourceUrl(request: IncomingMessage, path: string): string {
  const host = request.headers.host ?? 'localhost';
  const secure = 'encrypted' in request.socket && request.socket.encrypted === true;
  return `${secure ? 'https' : 'http'}://${host}${path}`;
}

function sendEmpty(response: ServerResponse, status: number): number {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end();
  return status;
}

function sendJson(response: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): number {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  response.end(payload);
  return status;
}

function sendProblem(response: ServerResponse, error: unknown, instance: string, logger: Logger): number {
  const mapped = toProblem(error, instance);
  if (mapped.status >= 500) {
    logger.error('http.error', {
      path: instance,
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
  if (response.headersSent) return mapped.status;
  const payload = JSON.stringify(mapped.body);
  response.writeHead(mapped.status, {
    'content-type': 'application/problem+json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(mapped.allow ? { allow: mapped.allow } : {}),
    ...(mapped.retryAfter ? { 'retry-after': String(mapped.retryAfter) } : {}),
  });
  response.end(payload);
  return mapped.status;
}

function toProblem(error: unknown, instance: string): { status: number; body: Problem; allow?: string; retryAfter?: number } {
  if (error instanceof MethodNotAllowed) {
    return {
      status: 405,
      allow: error.allow,
      body: problem('method-not-allowed', 'Method Not Allowed', 405, error.message, instance),
    };
  }
  if (error instanceof ValidationFailed) {
    return {
      status: 400,
      body: problem('bad-request', 'Bad Request', 400, error.message, instance, error.fieldErrors),
    };
  }
  if (error instanceof Unauthorized) {
    return { status: 401, body: problem('unauthorized', 'Unauthorized', 401, error.message, instance) };
  }
  if (error instanceof EmailUnverified) {
    return { status: 403, body: problem('email-unverified', 'Email unverified', 403, error.message, instance) };
  }
  if (error instanceof AccessDenied) {
    return { status: 403, body: problem('forbidden', 'Forbidden', 403, error.message, instance) };
  }
  if (error instanceof NotFound) {
    return { status: 404, body: problem('not-found', 'Not Found', 404, error.message, instance) };
  }
  if (error instanceof EmailAlreadyUsed) {
    return { status: 409, body: problem('conflict', 'Conflict', 409, error.message, instance) };
  }
  if (error instanceof TooManyRequests) {
    return {
      status: 429,
      retryAfter: error.retryAfterSeconds,
      body: problem('too-many-requests', 'Too Many Requests', 429, error.message, instance),
    };
  }
  return {
    status: 500,
    body: problem('internal', 'Internal Server Error', 500, 'Something went wrong.', instance),
  };
}

function problem(slug: string, title: string, status: number, detail: string, instance: string, fieldErrors?: FieldError[]): Problem {
  const body: Problem = {
    type: `${PROBLEM_BASE}/${slug}`,
    title,
    status,
    detail,
    instance,
  };
  if (fieldErrors && fieldErrors.length > 0) {
    body.errors = fieldErrors.map((field) => (field.pointer ? { pointer: field.pointer, detail: field.detail } : { detail: field.detail }));
  }
  return body;
}
