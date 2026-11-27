create table exams (
  id text primary key,
  title text not null,
  class_name text not null,
  subject text not null,
  teacher_name text not null default '',
  teacher_key_hash text not null unique,
  student_token text not null unique,
  code_fails integer not null default 0,
  code_lock_until timestamptz,
  created_at timestamptz not null default now()
);

create table questions (
  id text primary key,
  exam_id text not null references exams (id) on delete cascade,
  position integer not null,
  label text not null,
  max_marks numeric(6, 2) not null,
  unique (exam_id, position)
);

create table students (
  id text primary key,
  exam_id text not null references exams (id) on delete cascade,
  roll_no text not null,
  name text not null,
  upload_code text not null,
  absent boolean not null default false,
  validated_at timestamptz,
  note text not null default '',
  unique (exam_id, roll_no),
  unique (exam_id, upload_code)
);

create table pages (
  id text primary key,
  student_id text not null references students (id) on delete cascade,
  position integer not null,
  filename text not null,
  mime text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

create table marks (
  student_id text not null references students (id) on delete cascade,
  question_id text not null references questions (id) on delete cascade,
  awarded numeric(6, 2),
  comment text not null default '',
  primary key (student_id, question_id)
);

create index students_exam_idx on students (exam_id);
create index questions_exam_idx on questions (exam_id);
create index pages_student_idx on pages (student_id);
create index marks_question_idx on marks (question_id);
