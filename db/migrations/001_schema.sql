-- Shared mark book for one sitting: a class, an exam, and a subject.
-- Requires PostgreSQL 13+ (gen_random_uuid). Applied on first database start.

CREATE TABLE schools (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teachers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools (id),
  full_name  text NOT NULL CHECK (btrim(full_name) <> ''),
  email      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id)
);

CREATE UNIQUE INDEX teachers_email_unique
  ON teachers (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX teachers_school_id_idx ON teachers (school_id);

CREATE TABLE students (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES schools (id),
  admission_number text NOT NULL CHECK (btrim(admission_number) <> ''),
  full_name        text NOT NULL CHECK (btrim(full_name) <> ''),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, admission_number),
  UNIQUE (id, school_id)
);

CREATE TABLE sittings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools (id),
  teacher_id uuid NOT NULL,
  class_name text NOT NULL CHECK (btrim(class_name) <> ''),
  exam_name  text NOT NULL CHECK (btrim(exam_name) <> ''),
  subject    text NOT NULL CHECK (btrim(subject) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  FOREIGN KEY (teacher_id, school_id)
    REFERENCES teachers (id, school_id)
);

CREATE INDEX sittings_school_created_idx
  ON sittings (school_id, created_at DESC);

CREATE INDEX sittings_teacher_id_idx ON sittings (teacher_id);

CREATE TABLE sitting_students (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sitting_id     uuid NOT NULL,
  student_id     uuid NOT NULL,
  school_id      uuid NOT NULL,
  list_position  integer NOT NULL CHECK (list_position > 0),
  serial_label   text NOT NULL CHECK (btrim(serial_label) <> ''),
  display_name   text NOT NULL CHECK (btrim(display_name) <> ''),
  attendance     text NOT NULL DEFAULT 'present'
                   CHECK (attendance IN ('present', 'absent')),
  other_comments text NOT NULL DEFAULT '',
  saved_at       timestamptz,
  UNIQUE (sitting_id, student_id),
  UNIQUE (sitting_id, list_position),
  UNIQUE (sitting_id, serial_label),
  FOREIGN KEY (sitting_id, school_id)
    REFERENCES sittings (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, school_id)
    REFERENCES students (id, school_id)
);

CREATE INDEX sitting_students_saved_idx
  ON sitting_students (sitting_id)
  WHERE saved_at IS NOT NULL;

CREATE INDEX sitting_students_student_id_idx
  ON sitting_students (student_id);

CREATE TABLE question_scores (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sitting_student_id uuid NOT NULL
                       REFERENCES sitting_students (id) ON DELETE CASCADE,
  position           integer NOT NULL CHECK (position > 0),
  question_number    text NOT NULL CHECK (btrim(question_number) <> ''),
  mistakes           text NOT NULL DEFAULT '',
  max_marks          numeric(6,2) NOT NULL CHECK (max_marks >= 0),
  obtained_marks     numeric(6,2) NOT NULL
                       CHECK (obtained_marks >= 0 AND obtained_marks <= max_marks),
  UNIQUE (sitting_student_id, position)
);

CREATE INDEX question_scores_paper_idx
  ON question_scores (sitting_student_id);

CREATE FUNCTION reject_scores_when_absent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sitting_students
    WHERE id = NEW.sitting_student_id
      AND attendance = 'absent'
  ) THEN
    RAISE EXCEPTION
      'Absent papers cannot have question scores (sitting_student %)',
      NEW.sitting_student_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER question_scores_reject_absent
  BEFORE INSERT OR UPDATE ON question_scores
  FOR EACH ROW
  EXECUTE FUNCTION reject_scores_when_absent();

CREATE FUNCTION clear_scores_when_marked_absent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.attendance = 'absent'
     AND (TG_OP = 'INSERT' OR OLD.attendance IS DISTINCT FROM 'absent') THEN
    DELETE FROM question_scores WHERE sitting_student_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sitting_students_clear_scores_when_absent
  AFTER INSERT OR UPDATE OF attendance ON sitting_students
  FOR EACH ROW
  EXECUTE FUNCTION clear_scores_when_marked_absent();

CREATE VIEW mark_list AS
SELECT
  ss.sitting_id,
  ss.list_position,
  ss.serial_label,
  st.admission_number,
  ss.display_name AS name,
  ss.attendance,
  CASE
    WHEN ss.saved_at IS NULL THEN NULL
    WHEN ss.attendance = 'absent' THEN 0::numeric(6,2)
    ELSE COALESCE(SUM(qs.obtained_marks), 0)::numeric(6,2)
  END AS marks,
  CASE
    WHEN ss.attendance = 'absent' THEN 0::numeric(6,2)
    ELSE COALESCE(SUM(qs.max_marks), 0)::numeric(6,2)
  END AS max_marks,
  ss.saved_at
FROM sitting_students ss
JOIN students st ON st.id = ss.student_id
LEFT JOIN question_scores qs ON qs.sitting_student_id = ss.id
GROUP BY
  ss.id,
  ss.sitting_id,
  ss.list_position,
  ss.serial_label,
  st.admission_number,
  ss.display_name,
  ss.attendance,
  ss.saved_at;
