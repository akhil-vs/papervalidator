'use strict';

const CHUNK_SIZE = 512 * 1024;
const MAX_FILES = 10;
const MIN_WINDOW_MS = 60 * 1000;
const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

const ALLOWED = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp']
};

class RuleError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}

function tokenOk(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function norm(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function windowPhase(now, opensAt, closesAt) {
  if (now < opensAt) {
    return 'scheduled';
  }
  if (now >= closesAt) {
    return 'closed';
  }
  return 'open';
}

function extensionOf(fileName) {
  const name = String(fileName || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot) : '';
}

function classifyFile(fileName, mime, size, maxFileBytes) {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RuleError(400, 'EMPTY_FILE', 'The selected file is empty. Choose the answer sheet again.');
  }
  if (size > maxFileBytes) {
    throw new RuleError(413, 'TOO_LARGE', 'That file is larger than the limit set by your teacher.');
  }
  const ext = extensionOf(fileName);
  const normalized = String(mime || '').toLowerCase().split(';')[0].trim();
  if (ALLOWED[normalized] && ALLOWED[normalized].indexOf(ext) !== -1) {
    return normalized;
  }
  if (normalized === '' || normalized === 'application/octet-stream') {
    const types = Object.keys(ALLOWED);
    for (let i = 0; i < types.length; i++) {
      if (ALLOWED[types[i]].indexOf(ext) !== -1) {
        return types[i];
      }
    }
  }
  throw new RuleError(400, 'BAD_TYPE', 'Upload a PDF or a photo (JPG, PNG, or WEBP).');
}

function validateNewSession(input, now) {
  const body = input || {};
  const className = cleanText(body.className, 80);
  const exam = cleanText(body.exam, 120);
  const subject = cleanText(body.subject, 80);
  const teacher = cleanText(body.teacher, 80);
  if (!className || !exam || !subject || !teacher) {
    throw new RuleError(400, 'BAD_REQUEST', 'Enter the class, exam, subject, and teacher before creating a link.');
  }
  const opensAt = Date.parse(body.opensAt);
  const closesAt = Date.parse(body.closesAt);
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt)) {
    throw new RuleError(400, 'BAD_REQUEST', 'Choose both an opening time and a closing time.');
  }
  if (closesAt <= opensAt) {
    throw new RuleError(400, 'BAD_REQUEST', 'The closing time must be after the opening time.');
  }
  if (closesAt - opensAt < MIN_WINDOW_MS) {
    throw new RuleError(400, 'BAD_REQUEST', 'Keep the upload window open for at least 1 minute.');
  }
  if (closesAt - opensAt > MAX_WINDOW_MS) {
    throw new RuleError(400, 'BAD_REQUEST', 'The upload window cannot be longer than 14 days.');
  }
  if (closesAt <= now) {
    throw new RuleError(400, 'BAD_REQUEST', 'The closing time is already in the past.');
  }
  const graceMinutes = Number(body.graceMinutes == null ? 15 : body.graceMinutes);
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 120) {
    throw new RuleError(400, 'BAD_REQUEST', 'The extra time to finish an interrupted upload must be between 0 and 120 minutes.');
  }
  const maxFileMb = Number(body.maxFileMb == null ? 20 : body.maxFileMb);
  if (!Number.isFinite(maxFileMb) || maxFileMb < 1 || maxFileMb > 50) {
    throw new RuleError(400, 'BAD_REQUEST', 'The maximum file size must be between 1 and 50 MB.');
  }
  const maxAttempts = Number(body.maxAttempts == null ? 2 : body.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new RuleError(400, 'BAD_REQUEST', 'Allow between 1 and 5 completed uploads per student.');
  }
  const students = normalizeStudents(body.students);
  return {
    className,
    exam,
    subject,
    teacher,
    opensAt,
    closesAt,
    graceMinutes: Math.round(graceMinutes),
    instructions: cleanText(body.instructions, 2000),
    maxFileBytes: Math.round(maxFileMb * 1024 * 1024),
    maxAttempts,
    students
  };
}

function normalizeStudents(value) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new RuleError(400, 'BAD_REQUEST', 'The class list is not in a usable format.');
  }
  if (value.length > 500) {
    throw new RuleError(400, 'BAD_REQUEST', 'A link can include at most 500 students.');
  }
  const seen = {};
  const students = [];
  value.forEach(row => {
    const admNo = cleanText(row && (row.admNo != null ? row.admNo : row.AdmNo), 40);
    const name = cleanText(row && (row.name != null ? row.name : row.Name), 80);
    const slNo = cleanText(row && (row.slNo != null ? row.slNo : (row.SlNo != null ? row.SlNo : row.SINo)), 20);
    if (!admNo || !name) {
      return;
    }
    const key = norm(admNo);
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    students.push({ slNo, admNo, name });
  });
  return students;
}

function validatePatch(session, input, now) {
  const body = input || {};
  const next = {
    opensAt: session.opensAt,
    closesAt: session.closesAt,
    graceMinutes: session.graceMinutes,
    instructions: session.instructions,
    students: session.students
  };
  if (body.opensAt != null) {
    next.opensAt = Date.parse(body.opensAt);
  }
  if (body.closesAt != null) {
    next.closesAt = Date.parse(body.closesAt);
  }
  if (!Number.isFinite(next.opensAt) || !Number.isFinite(next.closesAt)) {
    throw new RuleError(400, 'BAD_REQUEST', 'Choose both an opening time and a closing time.');
  }
  if (next.closesAt <= next.opensAt) {
    throw new RuleError(400, 'BAD_REQUEST', 'The closing time must be after the opening time.');
  }
  if (next.closesAt - next.opensAt < MIN_WINDOW_MS) {
    throw new RuleError(400, 'BAD_REQUEST', 'Keep the upload window open for at least 1 minute.');
  }
  if (next.closesAt - next.opensAt > MAX_WINDOW_MS) {
    throw new RuleError(400, 'BAD_REQUEST', 'The upload window cannot be longer than 14 days.');
  }
  if (next.closesAt <= now && body.closesAt != null && body.forceClose !== true) {
    throw new RuleError(400, 'BAD_REQUEST', 'The closing time is already in the past. Use close now to end the window immediately.');
  }
  if (body.graceMinutes != null) {
    const graceMinutes = Number(body.graceMinutes);
    if (!Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 120) {
      throw new RuleError(400, 'BAD_REQUEST', 'The extra time to finish an interrupted upload must be between 0 and 120 minutes.');
    }
    next.graceMinutes = Math.round(graceMinutes);
  }
  if (body.instructions != null) {
    next.instructions = cleanText(body.instructions, 2000);
  }
  if (body.students != null) {
    next.students = normalizeStudents(body.students);
  }
  return next;
}

function findStudent(session, admNo) {
  const key = norm(admNo);
  for (let i = 0; i < session.students.length; i++) {
    if (norm(session.students[i].admNo) === key) {
      return session.students[i];
    }
  }
  return null;
}

function completedCount(session, admNo) {
  const key = norm(admNo);
  return session.submissions.filter(item => norm(item.admNo) === key && item.status === 'complete').length;
}

function latestIncomplete(session, admNo) {
  const key = norm(admNo);
  for (let i = session.submissions.length - 1; i >= 0; i--) {
    const item = session.submissions[i];
    if (norm(item.admNo) === key && item.status === 'partial') {
      return item;
    }
  }
  return null;
}

function lastCompletedAt(session, admNo) {
  const key = norm(admNo);
  let latest = null;
  session.submissions.forEach(item => {
    if (norm(item.admNo) === key && item.status === 'complete' && item.completedAt) {
      if (latest == null || item.completedAt > latest) {
        latest = item.completedAt;
      }
    }
  });
  return latest;
}

function canStartSubmission(session, now) {
  return windowPhase(now, session.opensAt, session.closesAt) === 'open';
}

function canContinueSubmission(session, submission, now) {
  if (!submission || submission.status === 'abandoned') {
    return false;
  }
  if (submission.status === 'complete') {
    return true;
  }
  if (submission.createdAt > session.closesAt) {
    return false;
  }
  return now <= session.closesAt + session.graceMinutes * 60 * 1000;
}

function sameFileSet(existing, requested) {
  if (!existing || existing.length !== requested.length) {
    return false;
  }
  for (let i = 0; i < existing.length; i++) {
    if (existing[i].fileName !== requested[i].fileName || existing[i].size !== requested[i].size) {
      return false;
    }
  }
  return true;
}

function assertIdentity(session, admNo, name) {
  const cleanAdm = cleanText(admNo, 40);
  const cleanName = cleanText(name, 80);
  if (!cleanAdm || !cleanName) {
    throw new RuleError(400, 'BAD_REQUEST', 'Enter your name and admission number.');
  }
  if (session.students.length === 0) {
    return { admNo: cleanAdm, name: cleanName };
  }
  const match = findStudent(session, cleanAdm);
  if (!match) {
    throw new RuleError(403, 'UNKNOWN_STUDENT', 'This admission number is not on the class list for this link. Check the number or ask your teacher.');
  }
  return { admNo: match.admNo, name: match.name };
}

function describeFiles(files, maxFileBytes) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new RuleError(400, 'BAD_REQUEST', 'Choose the answer sheet file before uploading.');
  }
  if (files.length > MAX_FILES) {
    throw new RuleError(400, 'BAD_REQUEST', 'Upload at most ' + MAX_FILES + ' files (one PDF, or one photo per page).');
  }
  return files.map(file => {
    const size = Number(file && file.size);
    const mime = classifyFile(file && file.fileName, file && file.mime, size, maxFileBytes);
    const fileName = cleanText(file.fileName, 120);
    return {
      fileName,
      mime,
      size,
      chunkSize: CHUNK_SIZE,
      totalChunks: Math.ceil(size / CHUNK_SIZE)
    };
  });
}

function expectedChunkLength(file, index) {
  if (!Number.isInteger(index) || index < 0 || index >= file.totalChunks) {
    throw new RuleError(400, 'CHUNK_MISMATCH', 'That part of the file does not belong to this upload.');
  }
  const start = index * file.chunkSize;
  return Math.min(file.chunkSize, file.size - start);
}

function receivedBytes(file) {
  const got = new Set(file.received || []);
  let total = 0;
  got.forEach(index => {
    if (index >= 0 && index < file.totalChunks) {
      const start = index * file.chunkSize;
      total += Math.min(file.chunkSize, file.size - start);
    }
  });
  return total;
}

function missingChunks(file) {
  const got = new Set(file.received || []);
  const missing = [];
  for (let i = 0; i < file.totalChunks; i++) {
    if (!got.has(i)) {
      missing.push(i);
    }
  }
  return missing;
}

module.exports = {
  CHUNK_SIZE,
  MAX_FILES,
  MIN_WINDOW_MS,
  MAX_WINDOW_MS,
  RuleError,
  tokenOk,
  norm,
  windowPhase,
  classifyFile,
  validateNewSession,
  validatePatch,
  normalizeStudents,
  findStudent,
  completedCount,
  latestIncomplete,
  lastCompletedAt,
  canStartSubmission,
  canContinueSubmission,
  sameFileSet,
  assertIdentity,
  describeFiles,
  expectedChunkLength,
  receivedBytes,
  missingChunks
};
