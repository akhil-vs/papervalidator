ALTER TABLE teachers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'teacher';
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS locked_until timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_role_check'
  ) THEN
    ALTER TABLE teachers
      ADD CONSTRAINT teachers_role_check
      CHECK (role IN ('coordinator', 'teacher'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('refresh', 'email_verification', 'password_reset')),
  token_hash text NOT NULL UNIQUE,
  family_id uuid,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_tokens_teacher_purpose_idx
  ON auth_tokens (teacher_id, purpose);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_attempts_lookup_idx
  ON auth_attempts (scope, subject, created_at DESC);
