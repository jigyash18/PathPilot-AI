-- Prepared for review only. Do not execute automatically.
--
-- This migration is intentionally fail-closed around pre-existing objects:
-- existing nullable credential columns and a correctly shaped session table or
-- index are accepted; same-named incompatible objects raise an error instead
-- of being silently reused.

BEGIN;

ALTER TABLE pathpilot_users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE pathpilot_users ADD COLUMN IF NOT EXISTS password_hash text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pathpilot_users'
      AND column_name = 'email'
      AND (data_type <> 'text' OR is_nullable <> 'YES')
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pathpilot_users'
      AND column_name = 'password_hash'
      AND (data_type <> 'text' OR is_nullable <> 'YES')
  ) THEN
    RAISE EXCEPTION 'pathpilot_users credential columns have an incompatible type or nullability';
  END IF;
END
$$;

DO $$
DECLARE
  existing_index text;
BEGIN
  SELECT pg_get_indexdef(indexrelid)
    INTO existing_index
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
    AND indexrelname = 'pathpilot_users_email_uq';

  IF existing_index IS NOT NULL AND (
    existing_index NOT LIKE '%ON public.pathpilot_users%'
    OR existing_index NOT LIKE '%lower(email)%'
    OR existing_index NOT LIKE '%WHERE (email IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'pathpilot_users_email_uq exists with an incompatible definition';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS pathpilot_users_email_uq
  ON pathpilot_users USING btree (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS pathpilot_sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES pathpilot_users(id),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  remember_me boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('id', 'integer', 'NO'),
      ('user_id', 'integer', 'NO'),
      ('token_hash', 'text', 'NO'),
      ('expires_at', 'timestamp with time zone', 'NO'),
      ('remember_me', 'boolean', 'NO'),
      ('created_at', 'timestamp with time zone', 'NO'),
      ('last_used_at', 'timestamp with time zone', 'YES')
    ) AS expected(column_name, data_type, is_nullable)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
     AND actual.table_name = 'pathpilot_sessions'
     AND actual.column_name = expected.column_name
    WHERE actual.column_name IS NULL
       OR actual.data_type <> expected.data_type
       OR actual.is_nullable <> expected.is_nullable
  ) THEN
    RAISE EXCEPTION 'pathpilot_sessions exists with an incompatible column definition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.pathpilot_sessions'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.pathpilot_users'::regclass
      AND constraint_row.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.pathpilot_sessions'::regclass AND attname = 'user_id')
      ]::smallint[]
      AND constraint_row.confkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.pathpilot_users'::regclass AND attname = 'id')
      ]::smallint[]
  ) THEN
    RAISE EXCEPTION 'pathpilot_sessions.user_id must reference pathpilot_users.id';
  END IF;
END
$$;

DO $$
DECLARE
  existing_index text;
BEGIN
  SELECT pg_get_indexdef(indexrelid)
    INTO existing_index
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
    AND indexrelname = 'pathpilot_sessions_token_hash_uq';

  IF existing_index IS NOT NULL AND (
    existing_index NOT LIKE '%ON public.pathpilot_sessions%'
    OR existing_index NOT LIKE '%(token_hash)%'
    OR existing_index NOT LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'pathpilot_sessions_token_hash_uq exists with an incompatible definition';
  END IF;
END
$$;

DO $$
DECLARE
  existing_index text;
BEGIN
  SELECT pg_get_indexdef(indexrelid)
    INTO existing_index
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
    AND indexrelname = 'pathpilot_sessions_user_idx';

  IF existing_index IS NOT NULL AND (
    existing_index NOT LIKE '%ON public.pathpilot_sessions%'
    OR existing_index NOT LIKE '%(user_id)%'
  ) THEN
    RAISE EXCEPTION 'pathpilot_sessions_user_idx exists with an incompatible definition';
  END IF;
END
$$;

DO $$
DECLARE
  existing_index text;
BEGIN
  SELECT pg_get_indexdef(indexrelid)
    INTO existing_index
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
    AND indexrelname = 'pathpilot_sessions_expiry_idx';

  IF existing_index IS NOT NULL AND (
    existing_index NOT LIKE '%ON public.pathpilot_sessions%'
    OR existing_index NOT LIKE '%(expires_at)%'
  ) THEN
    RAISE EXCEPTION 'pathpilot_sessions_expiry_idx exists with an incompatible definition';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS pathpilot_sessions_token_hash_uq
  ON pathpilot_sessions USING btree (token_hash);

CREATE INDEX IF NOT EXISTS pathpilot_sessions_user_idx
  ON pathpilot_sessions USING btree (user_id);

CREATE INDEX IF NOT EXISTS pathpilot_sessions_expiry_idx
  ON pathpilot_sessions USING btree (expires_at);

COMMIT;
