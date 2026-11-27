-- Local fixture for the mark-book profile. Runs once, on an empty database.

INSERT INTO schools (id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Riverside Secondary');

INSERT INTO teachers (id, school_id, full_name, email) VALUES
  (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'Anita Shah',
    'anita.shah@riverside.example'
  );

INSERT INTO students (id, school_id, admission_number, full_name) VALUES
  ('44444444-4444-4444-8444-000000000001', '11111111-1111-4111-8111-111111111111', 'A-1023', 'Meera Nair'),
  ('44444444-4444-4444-8444-000000000002', '11111111-1111-4111-8111-111111111111', 'A-1024', 'Rohan Das'),
  ('44444444-4444-4444-8444-000000000003', '11111111-1111-4111-8111-111111111111', 'A-1025', 'Iqbal Khan'),
  ('44444444-4444-4444-8444-000000000004', '11111111-1111-4111-8111-111111111111', 'A-1026', 'Lila George');

INSERT INTO sittings (id, school_id, teacher_id, class_name, exam_name, subject) VALUES
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'Class 8',
    'Mid Term',
    'Mathematics'
  );

INSERT INTO sitting_students (
  id, sitting_id, student_id, school_id,
  list_position, serial_label, display_name,
  attendance, other_comments, saved_at
) VALUES
  (
    '55555555-5555-4555-8555-000000000001',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000001',
    '11111111-1111-4111-8111-111111111111',
    1, '1', 'Meera Nair',
    'present', 'Show the working on the long question.',
    '2026-11-20 09:15:00+00'
  ),
  (
    '55555555-5555-4555-8555-000000000002',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000002',
    '11111111-1111-4111-8111-111111111111',
    2, '2', 'Rohan Das',
    'absent', 'Absent in the Exam',
    '2026-11-20 09:16:00+00'
  ),
  (
    '55555555-5555-4555-8555-000000000003',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000003',
    '11111111-1111-4111-8111-111111111111',
    3, '3', 'Iqbal Khan',
    'present', '',
    NULL
  ),
  (
    '55555555-5555-4555-8555-000000000004',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-000000000004',
    '11111111-1111-4111-8111-111111111111',
    4, '4', 'Lila George',
    'present', '',
    '2026-11-20 09:20:00+00'
  );

INSERT INTO question_scores (
  sitting_student_id, position, question_number, mistakes, max_marks, obtained_marks
) VALUES
  ('55555555-5555-4555-8555-000000000001', 1, '1', '', 5, 5),
  ('55555555-5555-4555-8555-000000000001', 2, '2', 'Sign error in step 2', 10, 3),
  ('55555555-5555-4555-8555-000000000003', 1, '1', 'Draft, not saved', 5, 4),
  ('55555555-5555-4555-8555-000000000004', 1, '1', '', 20, 18.5);
