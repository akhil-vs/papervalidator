'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rules = require('./exam-rules');
const { createStore } = require('./store');

const JSON_LIMIT = 1024 * 1024;
const CHUNK_LIMIT = 1024 * 1024;

function createApp(options) {
  const store = createStore(options.dataDir);
  const nowFn = options.now || (() => Date.now());
  return http.createServer((req, res) => {
    handle(req, res, store, nowFn).catch(err => {
      sendError(res, err);
    });
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, x-manage-key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store'
  };
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json)
  }, corsHeaders()));
  res.end(json);
}

function sendError(res, err) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const status = err && err.status ? err.status : 500;
  const code = err && err.code ? err.code : 'SERVER';
  const message = status === 500 && code === 'SERVER'
    ? 'The server could not finish that request. The upload will try again.'
    : (err && err.message ? err.message : 'The server could not finish that request.');
  const body = { error: Object.assign({ code, message }, err && err.extra ? err.extra : {}) };
  if (status === 500) {
    console.error(err && err.stack ? err.stack : err);
  }
  send(res, status, body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let failed = false;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        failed = true;
        reject(new rules.RuleError(413, 'TOO_LARGE', 'That upload is larger than the server can accept.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', () => {
      if (!failed) {
        failed = true;
        reject(new rules.RuleError(0, 'NETWORK', 'The connection dropped while that part was being received.'));
      }
    });
  });
}

async function readJson(req) {
  const raw = await readBody(req, JSON_LIMIT);
  if (raw.length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (err) {
    throw new rules.RuleError(400, 'BAD_REQUEST', 'The request could not be read. Try again.');
  }
}

function publicSession(session, now) {
  return {
    className: session.className,
    exam: session.exam,
    subject: session.subject,
    teacher: session.teacher,
    opensAt: new Date(session.opensAt).toISOString(),
    closesAt: new Date(session.closesAt).toISOString(),
    graceMinutes: session.graceMinutes,
    instructions: session.instructions,
    maxFileBytes: session.maxFileBytes,
    maxAttempts: session.maxAttempts,
    maxFiles: rules.MAX_FILES,
    students: session.students,
    phase: rules.windowPhase(now, session.opensAt, session.closesAt),
    serverNow: new Date(now).toISOString()
  };
}

function fileSummary(file) {
  return {
    fileId: file.fileId,
    fileName: file.fileName,
    mime: file.mime,
    size: file.size,
    chunkSize: file.chunkSize,
    totalChunks: file.totalChunks,
    received: file.received || [],
    receivedBytes: rules.receivedBytes(file),
    status: file.status,
    updatedAt: file.updatedAt ? new Date(file.updatedAt).toISOString() : null
  };
}

function submissionSummary(submission) {
  return {
    submissionId: submission.submissionId,
    admNo: submission.admNo,
    name: submission.name,
    status: submission.status,
    createdAt: new Date(submission.createdAt).toISOString(),
    completedAt: submission.completedAt ? new Date(submission.completedAt).toISOString() : null,
    files: submission.files.map(fileSummary)
  };
}

function findSubmission(session, submissionId) {
  for (let i = 0; i < session.submissions.length; i++) {
    if (session.submissions[i].submissionId === submissionId) {
      return session.submissions[i];
    }
  }
  throw new rules.RuleError(404, 'NOT_FOUND', 'That upload could not be found. It will be started again if the window is still open.');
}

function safeDownloadName(name) {
  const cleaned = String(name || 'answer-sheet').replace(/[\r\n"]/g, '').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
  return cleaned || 'answer-sheet';
}

async function handle(req, res, store, nowFn) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true, now: new Date(nowFn()).toISOString() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const body = await readJson(req);
      const fields = rules.validateNewSession(body, nowFn());
      const session = store.createSession(fields);
      send(res, 201, {
        token: session.token,
        manageKey: session.manageKey,
        opensAt: new Date(session.opensAt).toISOString(),
        closesAt: new Date(session.closesAt).toISOString(),
        graceMinutes: session.graceMinutes,
        phase: rules.windowPhase(nowFn(), session.opensAt, session.closesAt),
        serverNow: new Date(nowFn()).toISOString()
      });
      return;
    }
    if (parts[0] === 'api' && parts[1] === 'sessions' && parts.length >= 3) {
      let token = parts[2];
    try {
      token = decodeURIComponent(parts[2]);
    } catch (err) {
      throw new rules.RuleError(400, 'BAD_REQUEST', 'This link is not valid. Ask your teacher for a new one.');
    }
      await store.withLock(token, async () => {
        await routeSession(req, res, store, nowFn, url, parts, token);
      });
      return;
    }
    throw new rules.RuleError(404, 'NOT_FOUND', 'That address was not found.');
  } catch (err) {
    sendError(res, err);
  }
}

async function routeSession(req, res, store, nowFn, url, parts, token) {
  const now = nowFn();
  if (req.method === 'GET' && parts.length === 3) {
    send(res, 200, publicSession(store.read(token), now));
    return;
  }
  if (req.method === 'PATCH' && parts.length === 3) {
    const session = store.read(token);
    store.assertManage(session, req.headers['x-manage-key']);
    const body = await readJson(req);
    if (body.forceClose === true) {
      if (session.opensAt > now) {
        session.opensAt = now - 1000;
      }
      session.closesAt = now;
      store.save(token, session);
      send(res, 200, publicSession(session, now));
      return;
    }
    const next = rules.validatePatch(session, body, now);
    session.opensAt = next.opensAt;
    session.closesAt = next.closesAt;
    session.graceMinutes = next.graceMinutes;
    session.instructions = next.instructions;
    session.students = next.students;
    store.save(token, session);
    send(res, 200, publicSession(session, nowFn()));
    return;
  }
  if (req.method === 'GET' && parts.length === 4 && parts[3] === 'submissions') {
    const session = store.read(token);
    store.assertManage(session, req.headers['x-manage-key']);
    send(res, 200, {
      serverNow: new Date(now).toISOString(),
      submissions: session.submissions
        .filter(item => item.status !== 'abandoned')
        .map(submissionSummary)
    });
    return;
  }
  if (req.method === 'GET' && parts.length === 4 && parts[3] === 'mine') {
    const session = store.read(token);
    const admNo = url.searchParams.get('admNo') || '';
    const identity = rules.assertIdentity(session, admNo, url.searchParams.get('name') || 'student');
    const complete = rules.completedCount(session, identity.admNo);
    const pending = rules.latestIncomplete(session, identity.admNo);
    send(res, 200, {
      admNo: identity.admNo,
      name: identity.name,
      completeCount: complete,
      maxAttempts: session.maxAttempts,
      lastCompletedAt: rules.lastCompletedAt(session, identity.admNo),
      inProgress: Boolean(pending),
      serverNow: new Date(now).toISOString()
    });
    return;
  }
  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'submissions') {
    const body = await readJson(req);
    const session = store.read(token);
    const identity = rules.assertIdentity(session, body.admNo, body.name);
    const described = rules.describeFiles(body.files, session.maxFileBytes);
    const complete = rules.completedCount(session, identity.admNo);
    const pending = rules.latestIncomplete(session, identity.admNo);
    if (pending && rules.sameFileSet(pending.files, described) && rules.canContinueSubmission(session, pending, now)) {
      send(res, 200, {
        submissionId: pending.submissionId,
        resumed: true,
        files: pending.files.map(fileSummary)
      });
      return;
    }
    if (!rules.canStartSubmission(session, now)) {
      const phase = rules.windowPhase(now, session.opensAt, session.closesAt);
      if (phase === 'scheduled') {
        throw new rules.RuleError(403, 'WINDOW_NOT_OPEN', 'The upload window is not open yet.');
      }
      throw new rules.RuleError(403, 'WINDOW_CLOSED', 'The upload window has closed. A new answer sheet cannot be sent.');
    }
    if (complete >= session.maxAttempts) {
      const when = rules.lastCompletedAt(session, identity.admNo);
      throw new rules.RuleError(403, 'ATTEMPT_LIMIT', 'An answer sheet for this admission number was already received.', {
        completedAt: when ? new Date(when).toISOString() : null
      });
    }
    if (pending) {
      pending.status = 'abandoned';
      pending.files.forEach(file => {
        store.removeFileTree(token, file.fileId);
      });
    }
    const submission = {
      submissionId: crypto.randomBytes(16).toString('hex'),
      admNo: identity.admNo,
      name: identity.name,
      status: 'partial',
      createdAt: now,
      completedAt: null,
      files: described.map(file => Object.assign({
        fileId: crypto.randomBytes(12).toString('hex'),
        received: [],
        status: 'partial',
        updatedAt: now
      }, file))
    };
    session.submissions.push(submission);
    store.save(token, session);
    send(res, 201, {
      submissionId: submission.submissionId,
      resumed: false,
      files: submission.files.map(fileSummary)
    });
    return;
  }
  if (parts.length >= 5 && parts[3] === 'submissions') {
    const submissionId = decodeURIComponent(parts[4]);
    const session = store.read(token);
    const submission = findSubmission(session, submissionId);
    if (req.method === 'GET' && parts.length === 5) {
      if (!rules.canContinueSubmission(session, submission, now) && submission.status !== 'complete') {
        throw new rules.RuleError(403, 'WINDOW_CLOSED', 'The extra time to finish this upload has ended.');
      }
      send(res, 200, submissionSummary(submission));
      return;
    }
    if (req.method === 'DELETE' && parts.length === 5) {
      store.assertManage(session, req.headers['x-manage-key']);
      if (submission.status === 'complete') {
        throw new rules.RuleError(400, 'BAD_REQUEST', 'A completed answer sheet is kept. Close the window if no further uploads should arrive.');
      }
      submission.status = 'abandoned';
      submission.files.forEach(file => store.removeFileTree(token, file.fileId));
      store.save(token, session);
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && parts.length === 6 && parts[5] === 'complete') {
      if (submission.status === 'complete') {
        send(res, 200, submissionSummary(submission));
        return;
      }
      if (!rules.canContinueSubmission(session, submission, now)) {
        throw new rules.RuleError(403, 'WINDOW_CLOSED', 'The extra time to finish this upload has ended.');
      }
      const gaps = [];
      submission.files.forEach(file => {
        const missing = rules.missingChunks(file);
        if (missing.length) {
          gaps.push({ fileId: file.fileId, missing });
        }
      });
      if (gaps.length) {
        throw new rules.RuleError(409, 'INCOMPLETE', 'Some parts of the file have not arrived yet. Sending will continue from the missing part.', {
          gaps
        });
      }
      submission.files.forEach(file => {
        const dir = store.fileDirectory(token, file.fileId);
        const pieces = [];
        for (let i = 0; i < file.totalChunks; i++) {
          pieces.push(fs.readFileSync(path.join(dir, 'chunk-' + String(i).padStart(6, '0'))));
        }
        fs.writeFileSync(store.finalPath(token, file.fileId), Buffer.concat(pieces));
        for (let i = 0; i < file.totalChunks; i++) {
          fs.unlinkSync(path.join(dir, 'chunk-' + String(i).padStart(6, '0')));
        }
        file.status = 'complete';
        file.updatedAt = now;
      });
      submission.status = 'complete';
      submission.completedAt = now;
      store.save(token, session);
      send(res, 200, submissionSummary(submission));
      return;
    }
    if (req.method === 'PUT' && parts.length === 9 && parts[5] === 'files' && parts[7] === 'chunks') {
      await writeChunk(req, res, store, session, submission, token, parts, now);
      return;
    }
    if (req.method === 'GET' && parts.length === 7 && parts[5] === 'files') {
      store.assertManage(session, req.headers['x-manage-key']);
      const file = submission.files.find(item => item.fileId === parts[6]);
      if (!file || file.status !== 'complete') {
        throw new rules.RuleError(404, 'NOT_FOUND', 'That file is not ready to download yet.');
      }
      const full = store.finalPath(token, file.fileId);
      const data = fs.readFileSync(full);
      res.writeHead(200, Object.assign({
        'Content-Type': file.mime,
        'Content-Length': data.length,
        'Content-Disposition': 'attachment; filename="' + safeDownloadName(file.fileName) + '"'
      }, corsHeaders()));
      res.end(data);
      return;
    }
  }
  throw new rules.RuleError(404, 'NOT_FOUND', 'That address was not found.');
}

async function writeChunk(req, res, store, session, submission, token, parts, now) {
  if (submission.status === 'abandoned') {
    throw new rules.RuleError(404, 'NOT_FOUND', 'That upload was replaced. Choose the file again.');
  }
  if (submission.status !== 'complete' && !rules.canContinueSubmission(session, submission, now)) {
    throw new rules.RuleError(403, 'WINDOW_CLOSED', 'The extra time to finish this upload has ended.');
  }
  const file = submission.files.find(item => item.fileId === parts[6]);
  if (!file) {
    throw new rules.RuleError(404, 'NOT_FOUND', 'That file is not part of this upload.');
  }
  const index = Number(parts[8]);
  const expected = rules.expectedChunkLength(file, index);
  const buf = await readBody(req, Math.max(expected, 1));
  if (buf.length !== expected) {
    throw new rules.RuleError(409, 'CHUNK_MISMATCH', 'A part of the file arrived incomplete. That part will be sent again.', {
      fileId: file.fileId,
      index
    });
  }
  if (submission.status === 'complete') {
    send(res, 200, { received: file.received, status: 'complete' });
    return;
  }
  const dest = store.chunkPath(token, file.fileId, index);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  if (file.received.indexOf(index) === -1) {
    file.received.push(index);
    file.received.sort((a, b) => a - b);
  }
  file.updatedAt = now;
  store.save(token, session);
  send(res, 200, { received: file.received, receivedBytes: rules.receivedBytes(file) });
}

if (require.main === module) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const port = Number(process.env.PORT || 3333);
  const host = process.env.HOST || '0.0.0.0';
  const server = createApp({ dataDir });
  server.listen(port, host, () => {
    console.log('Answer sheet service listening on http://' + host + ':' + port);
  });
}

module.exports = { createApp };
