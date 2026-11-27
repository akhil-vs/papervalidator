'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rules = require('./exam-rules');

function createStore(dataDir) {
  const locks = new Map();

  function sessionDir(token) {
    if (!rules.tokenOk(token)) {
      throw new rules.RuleError(404, 'INVALID_LINK', 'This link is not valid. Ask your teacher for a new one.');
    }
    return path.join(dataDir, 'sessions', token);
  }

  function sessionFile(token) {
    return path.join(sessionDir(token), 'session.json');
  }

  function fileDir(token, fileId) {
    if (!rules.tokenOk(fileId)) {
      throw new rules.RuleError(404, 'NOT_FOUND', 'That upload could not be found. It will be started again.');
    }
    return path.join(sessionDir(token), 'files', fileId);
  }

  function withLock(token, fn) {
    const prev = locks.get(token) || Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(token, next.then(() => undefined, () => undefined));
    return next;
  }

  function readSession(token) {
    const file = sessionFile(token);
    if (!fs.existsSync(file)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function writeSession(token, session) {
    const file = sessionFile(token);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(session));
    fs.renameSync(tmp, file);
  }

  function requireSession(token) {
    const session = readSession(token);
    if (!session) {
      throw new rules.RuleError(404, 'INVALID_LINK', 'This link is not valid, or it has been removed. Ask your teacher for a new one.');
    }
    return session;
  }

  function newId(bytes) {
    return crypto.randomBytes(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function keysMatch(expected, given) {
    const left = Buffer.from(String(expected));
    const right = Buffer.from(String(given || ''));
    if (left.length !== right.length) {
      return false;
    }
    return crypto.timingSafeEqual(left, right);
  }

  function reconcile(token, session) {
    let changed = false;
    session.submissions.forEach(submission => {
      submission.files.forEach(file => {
        const dir = fileDir(token, file.fileId);
        if (!fs.existsSync(dir)) {
          return;
        }
        const have = new Set(file.received || []);
        fs.readdirSync(dir).forEach(name => {
          const match = /^chunk-(\d+)$/.exec(name);
          if (match) {
            have.add(Number(match[1]));
          }
        });
        const received = Array.from(have).filter(index => index >= 0 && index < file.totalChunks).sort((a, b) => a - b);
        if (received.length !== (file.received || []).length) {
          file.received = received;
          changed = true;
        }
      });
    });
    if (changed) {
      writeSession(token, session);
    }
    return session;
  }

  return {
    withLock,
    createSession(fields) {
      const token = newId(9);
      const session = Object.assign({
        token,
        manageKey: newId(24),
        createdAt: Date.now(),
        submissions: []
      }, fields);
      writeSession(token, session);
      return session;
    },
    read(token) {
      const session = requireSession(token);
      return reconcile(token, session);
    },
    save(token, session) {
      writeSession(token, session);
    },
    assertManage(session, header) {
      if (!keysMatch(session.manageKey, header)) {
        throw new rules.RuleError(401, 'UNAUTHORIZED', 'This browser does not have the management key for that link.');
      }
    },
    fileDirectory: fileDir,
    chunkPath(token, fileId, index) {
      return path.join(fileDir(token, fileId), 'chunk-' + String(index).padStart(6, '0'));
    },
    finalPath(token, fileId) {
      return path.join(fileDir(token, fileId), 'complete');
    },
    removeFileTree(token, fileId) {
      const dir = fileDir(token, fileId);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  };
}

module.exports = { createStore };
