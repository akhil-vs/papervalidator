'use strict';

const assert = require('assert');
const rules = require('./exam-rules');

const now = Date.parse('2026-06-01T09:00:00Z');

assert.strictEqual(rules.windowPhase(now, now + 1000, now + 5000), 'scheduled');
assert.strictEqual(rules.windowPhase(now, now - 1000, now + 5000), 'open');
assert.strictEqual(rules.windowPhase(now, now - 5000, now - 1000), 'closed');
assert.strictEqual(rules.windowPhase(now, now - 5000, now), 'closed');

assert.throws(() => rules.validateNewSession({
  className: '10',
  exam: 'Mid',
  subject: 'Maths',
  teacher: 'Ada',
  opensAt: '2026-06-01T09:00:00Z',
  closesAt: '2026-06-01T08:00:00Z'
}, now), error => error.code === 'BAD_REQUEST');

const session = rules.validateNewSession({
  className: '10',
  exam: 'Mid',
  subject: 'Maths',
  teacher: 'Ada',
  opensAt: '2026-06-01T09:00:00Z',
  closesAt: '2026-06-01T10:00:00Z',
  students: [{ AdmNo: '12', Name: 'Meera', SlNo: '1' }, { admNo: '12', name: 'Duplicate' }]
}, now);
assert.strictEqual(session.students.length, 1);
assert.strictEqual(session.students[0].name, 'Meera');
assert.strictEqual(rules.classifyFile('Page.JPG', '', 100, 1024), 'image/jpeg');
assert.throws(() => rules.classifyFile('notes.txt', 'text/plain', 10, 1024), error => error.code === 'BAD_TYPE');

console.log('exam rule tests passed');
