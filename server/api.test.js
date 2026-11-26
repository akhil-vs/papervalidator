'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createApp } = require('./index');
const { CHUNK_SIZE } = require('./exam-rules');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epv-api-'));
let now = Date.parse('2026-06-01T09:00:00Z');
const app = createApp({ dataDir, now: () => now });

function listen(server) {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function request(port, method, urlPath, options) {
  const opts = options || {};
  const body = opts.body == null ? null : opts.body;
  const payload = Buffer.isBuffer(body) || body == null ? body : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: Object.assign({
        'Content-Type': payload && !Buffer.isBuffer(body) ? 'application/json' : 'application/octet-stream',
        'Content-Length': payload ? payload.length : 0
      }, opts.headers || {})
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        if (String(res.headers['content-type'] || '').indexOf('application/json') === 0) {
          json = JSON.parse(raw.toString('utf8'));
        }
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function createSession(port, overrides) {
  const body = Object.assign({
    className: '10 A',
    exam: 'Midterm',
    subject: 'Physics',
    teacher: 'Meera Nair',
    opensAt: '2026-06-01T09:00:00Z',
    closesAt: '2026-06-01T10:00:00Z',
    graceMinutes: 15,
    maxFileMb: 20,
    maxAttempts: 2,
    instructions: 'Upload one PDF or a photo of each page.',
    students: [
      { slNo: '1', admNo: 'A1', name: 'Anita' },
      { slNo: '2', admNo: 'A2', name: 'Rahul' }
    ]
  }, overrides || {});
  const res = await request(port, 'POST', '/api/sessions', { body });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

async function startSubmission(port, token, file) {
  const res = await request(port, 'POST', '/api/sessions/' + token + '/submissions', {
    body: {
      admNo: 'A1',
      name: 'Anita',
      files: [{ fileName: file.name, mime: 'application/pdf', size: file.data.length }]
    }
  });
  return res;
}

async function uploadAll(port, token, submission, file) {
  const meta = submission.files[0];
  for (let index = 0; index < meta.totalChunks; index++) {
    const start = index * meta.chunkSize;
    const slice = file.data.slice(start, start + meta.chunkSize);
    const res = await request(
      port,
      'PUT',
      '/api/sessions/' + token + '/submissions/' + submission.submissionId + '/files/' + meta.fileId + '/chunks/' + index,
      { body: slice }
    );
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  }
  const done = await request(port, 'POST', '/api/sessions/' + token + '/submissions/' + submission.submissionId + '/complete');
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  return done.json;
}

async function main() {
  const port = await listen(app);
  const health = await request(port, 'GET', '/api/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.json.ok, true);

  const bad = await request(port, 'POST', '/api/sessions', {
    body: { className: '10 A', exam: 'Midterm', subject: 'Physics', teacher: 'Meera' }
  });
  assert.strictEqual(bad.status, 400);

  now = Date.parse('2026-06-01T08:00:00Z');
  const early = await createSession(port);
  const tooSoon = await startSubmission(port, early.token, { name: 'sheet.pdf', data: Buffer.from('%PDF-1.4') });
  assert.strictEqual(tooSoon.status, 403);
  assert.strictEqual(tooSoon.json.error.code, 'WINDOW_NOT_OPEN');

  now = Date.parse('2026-06-01T09:30:00Z');
  const opened = await request(port, 'GET', '/api/sessions/' + early.token);
  assert.strictEqual(opened.json.phase, 'open');

  const unknown = await request(port, 'POST', '/api/sessions/' + early.token + '/submissions', {
    body: { admNo: 'Z9', name: 'Nobody', files: [{ fileName: 'sheet.pdf', mime: 'application/pdf', size: 5 }] }
  });
  assert.strictEqual(unknown.status, 403);
  assert.strictEqual(unknown.json.error.code, 'UNKNOWN_STUDENT');

  const wrongType = await request(port, 'POST', '/api/sessions/' + early.token + '/submissions', {
    body: { admNo: 'A1', name: 'Anita', files: [{ fileName: 'sheet.exe', mime: 'application/octet-stream', size: 5 }] }
  });
  assert.strictEqual(wrongType.status, 400);
  assert.strictEqual(wrongType.json.error.code, 'BAD_TYPE');

  const payload = Buffer.alloc(CHUNK_SIZE + 25, 7);
  payload.write('%PDF', 0);
  const created = await startSubmission(port, early.token, { name: 'sheet.pdf', data: payload });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.json.files[0].totalChunks, 2);

  const first = created.json.files[0];
  const partial = await request(
    port,
    'PUT',
    '/api/sessions/' + early.token + '/submissions/' + created.json.submissionId + '/files/' + first.fileId + '/chunks/0',
    { body: payload.slice(0, CHUNK_SIZE) }
  );
  assert.strictEqual(partial.status, 200);

  const incomplete = await request(port, 'POST', '/api/sessions/' + early.token + '/submissions/' + created.json.submissionId + '/complete');
  assert.strictEqual(incomplete.status, 409);
  assert.strictEqual(incomplete.json.error.code, 'INCOMPLETE');

  const resumed = await startSubmission(port, early.token, { name: 'sheet.pdf', data: payload });
  assert.strictEqual(resumed.status, 200);
  assert.strictEqual(resumed.json.resumed, true);
  assert.deepStrictEqual(resumed.json.files[0].received, [0]);

  const short = await request(
    port,
    'PUT',
    '/api/sessions/' + early.token + '/submissions/' + created.json.submissionId + '/files/' + first.fileId + '/chunks/1',
    { body: Buffer.from('nope') }
  );
  assert.strictEqual(short.status, 409);
  assert.strictEqual(short.json.error.code, 'CHUNK_MISMATCH');

  await uploadAll(port, early.token, resumed.json, { data: payload });

  const mine = await request(port, 'GET', '/api/sessions/' + early.token + '/mine?admNo=A1&name=Anita');
  assert.strictEqual(mine.json.completeCount, 1);
  assert.strictEqual(mine.json.maxAttempts, 2);

  const list = await request(port, 'GET', '/api/sessions/' + early.token + '/submissions', {
    headers: { 'x-manage-key': early.manageKey }
  });
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.json.submissions.length, 1);
  assert.strictEqual(list.json.submissions[0].status, 'complete');

  const denied = await request(
    port,
    'GET',
    '/api/sessions/' + early.token + '/submissions/' + created.json.submissionId + '/files/' + first.fileId
  );
  assert.strictEqual(denied.status, 401);

  const downloaded = await request(
    port,
    'GET',
    '/api/sessions/' + early.token + '/submissions/' + created.json.submissionId + '/files/' + first.fileId,
    { headers: { 'x-manage-key': early.manageKey } }
  );
  assert.strictEqual(downloaded.status, 200);
  assert.strictEqual(downloaded.raw.length, payload.length);
  assert.ok(downloaded.raw.equals(payload));

  const second = Buffer.from('%PDF-replacement');
  const again = await startSubmission(port, early.token, { name: 'sheet.pdf', data: second });
  assert.strictEqual(again.status, 201);
  await uploadAll(port, early.token, again.json, { data: second });
  const limited = await startSubmission(port, early.token, { name: 'other.pdf', data: second });
  assert.strictEqual(limited.status, 403);
  assert.strictEqual(limited.json.error.code, 'ATTEMPT_LIMIT');

  const closed = await request(port, 'PATCH', '/api/sessions/' + early.token, {
    headers: { 'x-manage-key': early.manageKey },
    body: { forceClose: true }
  });
  assert.strictEqual(closed.status, 200);
  assert.strictEqual(closed.json.phase, 'closed');

  now = Date.parse('2026-06-01T09:30:00Z');
  const graceSession = await createSession(port, {
    opensAt: '2026-06-01T09:00:00Z',
    closesAt: '2026-06-01T10:30:00Z',
    graceMinutes: 15,
    students: []
  });
  now = Date.parse('2026-06-01T10:00:00Z');
  const lateFile = Buffer.alloc(10, 3);
  const started = await request(port, 'POST', '/api/sessions/' + graceSession.token + '/submissions', {
    body: { admNo: 'B7', name: 'Leela', files: [{ fileName: 'page.jpg', mime: 'image/jpeg', size: lateFile.length }] }
  });
  assert.strictEqual(started.status, 201);
  now = Date.parse('2026-06-01T10:40:00Z');
  const duringGrace = await request(
    port,
    'PUT',
    '/api/sessions/' + graceSession.token + '/submissions/' + started.json.submissionId + '/files/' + started.json.files[0].fileId + '/chunks/0',
    { body: lateFile }
  );
  assert.strictEqual(duringGrace.status, 200, JSON.stringify(duringGrace.json));
  now = Date.parse('2026-06-01T10:46:00Z');
  const afterGrace = await request(port, 'POST', '/api/sessions/' + graceSession.token + '/submissions/' + started.json.submissionId + '/complete');
  assert.strictEqual(afterGrace.status, 403);
  assert.strictEqual(afterGrace.json.error.code, 'WINDOW_CLOSED');

  const fresh = await request(port, 'POST', '/api/sessions/' + graceSession.token + '/submissions', {
    body: { admNo: 'B8', name: 'Arun', files: [{ fileName: 'page.jpg', mime: 'image/jpeg', size: 4 }] }
  });
  assert.strictEqual(fresh.status, 403);
  assert.strictEqual(fresh.json.error.code, 'WINDOW_CLOSED');

  app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('api tests passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
