-- Core application schema derived from lib/db/src/schema.
-- This is the first migration for an empty database. It intentionally excludes
-- auth additions (0001) and study analytics storage (0002).
-- Existing complete schemas are validated before any DDL; partial or
-- incompatible schemas fail closed. No existing rows are deleted or replaced.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  expected_table_count integer := 9;
  present_table_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('pathpilot_users'),
      ('pathpilot_goals'),
      ('pathpilot_tasks'),
      ('pathpilot_progress'),
      ('pathpilot_dependencies'),
      ('pathpilot_milestones'),
      ('pathpilot_milestone_tasks'),
      ('pathpilot_plan_versions'),
      ('pathpilot_plan_version_tasks')
    ) AS expected(table_name)
    JOIN pg_class relation_row
      ON relation_row.relnamespace = 'public'::regnamespace
     AND relation_row.relname = expected.table_name
    WHERE relation_row.relkind NOT IN ('r', 'p')
  ) THEN
    RAISE EXCEPTION 'A PathPilot core object exists but is not a table; baseline made no changes';
  END IF;

  SELECT count(*)::integer
    INTO present_table_count
  FROM (VALUES
    ('pathpilot_users'),
    ('pathpilot_goals'),
    ('pathpilot_tasks'),
    ('pathpilot_progress'),
    ('pathpilot_dependencies'),
    ('pathpilot_milestones'),
    ('pathpilot_milestone_tasks'),
    ('pathpilot_plan_versions'),
    ('pathpilot_plan_version_tasks')
  ) AS expected(table_name)
  WHERE to_regclass('public.' || expected.table_name) IS NOT NULL;

  IF present_table_count > 0 AND present_table_count < expected_table_count THEN
    RAISE EXCEPTION 'Partial PathPilot core schema found (% of % tables); baseline made no changes',
      present_table_count, expected_table_count;
  END IF;

  IF present_table_count = expected_table_count AND EXISTS (
    SELECT 1
    FROM (VALUES
      ('pathpilot_users', 'id', 'integer', 'NO'),
      ('pathpilot_users', 'name', 'text', 'NO'),
      ('pathpilot_users', 'available_hours', 'real', 'NO'),
      ('pathpilot_users', 'preferred_start', 'text', 'NO'),
      ('pathpilot_users', 'preferred_end', 'text', 'NO'),
      ('pathpilot_goals', 'id', 'integer', 'NO'),
      ('pathpilot_goals', 'user_id', 'integer', 'NO'),
      ('pathpilot_goals', 'goal_name', 'text', 'NO'),
      ('pathpilot_goals', 'goal_type', 'text', 'NO'),
      ('pathpilot_goals', 'deadline', 'date', 'NO'),
      ('pathpilot_goals', 'daily_hours', 'real', 'NO'),
      ('pathpilot_goals', 'priority', 'text', 'NO'),
      ('pathpilot_goals', 'description', 'text', 'NO'),
      ('pathpilot_goals', 'skills', 'ARRAY', 'NO'),
      ('pathpilot_tasks', 'id', 'integer', 'NO'),
      ('pathpilot_tasks', 'goal_id', 'integer', 'NO'),
      ('pathpilot_tasks', 'task_name', 'text', 'NO'),
      ('pathpilot_tasks', 'topic', 'text', 'NO'),
      ('pathpilot_tasks', 'duration_hours', 'real', 'NO'),
      ('pathpilot_tasks', 'priority', 'text', 'NO'),
      ('pathpilot_tasks', 'difficulty', 'text', 'NO'),
      ('pathpilot_tasks', 'status', 'text', 'NO'),
      ('pathpilot_tasks', 'scheduled_date', 'date', 'YES'),
      ('pathpilot_tasks', 'completion_percent', 'real', 'NO'),
      ('pathpilot_tasks', 'completed_at', 'date', 'YES'),
      ('pathpilot_progress', 'id', 'integer', 'NO'),
      ('pathpilot_progress', 'user_id', 'integer', 'NO'),
      ('pathpilot_progress', 'task_id', 'integer', 'NO'),
      ('pathpilot_progress', 'date', 'date', 'NO'),
      ('pathpilot_progress', 'status', 'text', 'NO'),
      ('pathpilot_progress', 'completion_percent', 'real', 'NO'),
      ('pathpilot_dependencies', 'id', 'integer', 'NO'),
      ('pathpilot_dependencies', 'task_id', 'integer', 'NO'),
      ('pathpilot_dependencies', 'depends_on', 'integer', 'NO'),
      ('pathpilot_milestones', 'id', 'integer', 'NO'),
      ('pathpilot_milestones', 'goal_id', 'integer', 'NO'),
      ('pathpilot_milestones', 'title', 'text', 'NO'),
      ('pathpilot_milestones', 'target_date', 'date', 'YES'),
      ('pathpilot_milestones', 'confirmed_at', 'timestamp with time zone', 'NO'),
      ('pathpilot_milestone_tasks', 'id', 'integer', 'NO'),
      ('pathpilot_milestone_tasks', 'milestone_id', 'integer', 'NO'),
      ('pathpilot_milestone_tasks', 'task_id', 'integer', 'NO'),
      ('pathpilot_plan_versions', 'id', 'integer', 'NO'),
      ('pathpilot_plan_versions', 'goal_id', 'integer', 'NO'),
      ('pathpilot_plan_versions', 'version', 'integer', 'NO'),
      ('pathpilot_plan_versions', 'daily_hours', 'real', 'NO'),
      ('pathpilot_plan_versions', 'deadline', 'date', 'NO'),
      ('pathpilot_plan_versions', 'created_at', 'timestamp with time zone', 'NO'),
      ('pathpilot_plan_version_tasks', 'id', 'integer', 'NO'),
      ('pathpilot_plan_version_tasks', 'plan_version_id', 'integer', 'NO'),
      ('pathpilot_plan_version_tasks', 'task_id', 'integer', 'NO'),
      ('pathpilot_plan_version_tasks', 'scheduled_date', 'date', 'YES'),
      ('pathpilot_plan_version_tasks', 'task_name', 'text', 'YES'),
      ('pathpilot_plan_version_tasks', 'topic', 'text', 'YES'),
      ('pathpilot_plan_version_tasks', 'duration_hours', 'real', 'YES')
    ) AS expected(table_name, column_name, data_type, is_nullable)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
     AND actual.table_name = expected.table_name
     AND actual.column_name = expected.column_name
    WHERE actual.column_name IS NULL
       OR actual.data_type <> expected.data_type
       OR actual.is_nullable <> expected.is_nullable
  ) THEN
    RAISE EXCEPTION 'Existing PathPilot core table columns do not match the Drizzle baseline; baseline made no changes';
  END IF;

  IF present_table_count = expected_table_count AND EXISTS (
    SELECT 1
    FROM (VALUES
      ('pathpilot_goals', 'user_id', 'pathpilot_users', 'id'),
      ('pathpilot_tasks', 'goal_id', 'pathpilot_goals', 'id'),
      ('pathpilot_progress', 'user_id', 'pathpilot_users', 'id'),
      ('pathpilot_progress', 'task_id', 'pathpilot_tasks', 'id'),
      ('pathpilot_dependencies', 'task_id', 'pathpilot_tasks', 'id'),
      ('pathpilot_dependencies', 'depends_on', 'pathpilot_tasks', 'id'),
      ('pathpilot_milestones', 'goal_id', 'pathpilot_goals', 'id'),
      ('pathpilot_milestone_tasks', 'milestone_id', 'pathpilot_milestones', 'id'),
      ('pathpilot_milestone_tasks', 'task_id', 'pathpilot_tasks', 'id'),
      ('pathpilot_plan_versions', 'goal_id', 'pathpilot_goals', 'id'),
      ('pathpilot_plan_version_tasks', 'plan_version_id', 'pathpilot_plan_versions', 'id'),
      ('pathpilot_plan_version_tasks', 'task_id', 'pathpilot_tasks', 'id')
    ) AS expected(table_name, column_name, foreign_table, foreign_column)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_constraint fk
      WHERE fk.contype = 'f'
        AND fk.conrelid = to_regclass('public.' || expected.table_name)
        AND fk.confrelid = to_regclass('public.' || expected.foreign_table)
        AND fk.conkey = ARRAY[(
          SELECT attnum FROM pg_attribute
          WHERE attrelid = to_regclass('public.' || expected.table_name)
            AND attname = expected.column_name AND NOT attisdropped
        )]::smallint[]
        AND fk.confkey = ARRAY[(
          SELECT attnum FROM pg_attribute
          WHERE attrelid = to_regclass('public.' || expected.foreign_table)
            AND attname = expected.foreign_column AND NOT attisdropped
        )]::smallint[]
        AND fk.confdeltype = 'a'
        AND fk.confupdtype = 'a'
    )
  ) THEN
    RAISE EXCEPTION 'Existing PathPilot core foreign keys do not match the Drizzle baseline; baseline made no changes';
  END IF;

  IF present_table_count = expected_table_count AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.pathpilot_dependencies'::regclass
      AND constraint_row.conname = 'pathpilot_dependency_not_self_ck'
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%task_id <> depends_on%'
  ) THEN
    RAISE EXCEPTION 'Existing PathPilot dependency check constraint does not match the Drizzle baseline; baseline made no changes';
  END IF;

  IF present_table_count = expected_table_count AND EXISTS (
    SELECT 1
    FROM (VALUES
      ('pathpilot_tasks_goal_idx', 'pathpilot_tasks', false, '(goal_id)'),
      ('pathpilot_progress_user_task_date_idx', 'pathpilot_progress', false, '(user_id, task_id, date)'),
      ('pathpilot_dependency_pair_uq', 'pathpilot_dependencies', true, '(task_id, depends_on)'),
      ('pathpilot_milestones_goal_idx', 'pathpilot_milestones', false, '(goal_id)'),
      ('pathpilot_milestone_task_uq', 'pathpilot_milestone_tasks', true, '(milestone_id, task_id)'),
      ('pathpilot_plan_versions_goal_version_uq', 'pathpilot_plan_versions', true, '(goal_id, version)'),
      ('pathpilot_plan_version_task_uq', 'pathpilot_plan_version_tasks', true, '(plan_version_id, task_id)')
    ) AS expected(index_name, table_name, is_unique, key_definition)
    JOIN pg_class index_row
      ON index_row.relnamespace = 'public'::regnamespace
     AND index_row.relname = expected.index_name
    LEFT JOIN pg_index index_definition ON index_definition.indexrelid = index_row.oid
    WHERE index_row.relkind <> 'i'
       OR index_definition.indexrelid IS NULL
       OR index_definition.indisunique <> expected.is_unique
       OR pg_get_indexdef(index_row.oid) NOT LIKE ('%ON public.' || expected.table_name || ' USING btree ' || expected.key_definition || '%')
  ) THEN
    RAISE EXCEPTION 'An existing PathPilot core index conflicts with the Drizzle baseline; baseline made no changes';
  END IF;

  IF present_table_count = expected_table_count AND EXISTS (
    SELECT 1
    FROM (VALUES
      ('pathpilot_users'),
      ('pathpilot_goals'),
      ('pathpilot_tasks'),
      ('pathpilot_progress'),
      ('pathpilot_dependencies'),
      ('pathpilot_milestones'),
      ('pathpilot_milestone_tasks'),
      ('pathpilot_plan_versions'),
      ('pathpilot_plan_version_tasks')
    ) AS expected(table_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint primary_key
      WHERE primary_key.conrelid = to_regclass('public.' || expected.table_name)
        AND primary_key.contype = 'p'
        AND primary_key.conkey = ARRAY[(
          SELECT attnum FROM pg_attribute
          WHERE attrelid = to_regclass('public.' || expected.table_name)
            AND attname = 'id' AND NOT attisdropped
        )]::smallint[]
    )
  ) THEN
    RAISE EXCEPTION 'Existing PathPilot core primary keys do not match the Drizzle baseline; baseline made no changes';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.pathpilot_users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  available_hours real NOT NULL DEFAULT 4,
  preferred_start text NOT NULL DEFAULT '09:00',
  preferred_end text NOT NULL DEFAULT '18:00'
);

CREATE TABLE IF NOT EXISTS public.pathpilot_goals (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.pathpilot_users(id),
  goal_name text NOT NULL,
  goal_type text NOT NULL,
  deadline date NOT NULL,
  daily_hours real NOT NULL,
  priority text NOT NULL,
  description text NOT NULL DEFAULT '',
  skills text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE TABLE IF NOT EXISTS public.pathpilot_tasks (
  id serial PRIMARY KEY,
  goal_id integer NOT NULL REFERENCES public.pathpilot_goals(id),
  task_name text NOT NULL,
  topic text NOT NULL DEFAULT 'Uncategorized',
  duration_hours real NOT NULL,
  priority text NOT NULL,
  difficulty text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  scheduled_date date,
  completion_percent real NOT NULL DEFAULT 0,
  completed_at date
);

CREATE TABLE IF NOT EXISTS public.pathpilot_progress (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.pathpilot_users(id),
  task_id integer NOT NULL REFERENCES public.pathpilot_tasks(id),
  date date NOT NULL,
  status text NOT NULL,
  completion_percent real NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.pathpilot_dependencies (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES public.pathpilot_tasks(id),
  depends_on integer NOT NULL REFERENCES public.pathpilot_tasks(id),
  CONSTRAINT pathpilot_dependency_not_self_ck CHECK (task_id <> depends_on)
);

CREATE TABLE IF NOT EXISTS public.pathpilot_milestones (
  id serial PRIMARY KEY,
  goal_id integer NOT NULL REFERENCES public.pathpilot_goals(id),
  title text NOT NULL,
  target_date date,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pathpilot_milestone_tasks (
  id serial PRIMARY KEY,
  milestone_id integer NOT NULL REFERENCES public.pathpilot_milestones(id),
  task_id integer NOT NULL REFERENCES public.pathpilot_tasks(id)
);

CREATE TABLE IF NOT EXISTS public.pathpilot_plan_versions (
  id serial PRIMARY KEY,
  goal_id integer NOT NULL REFERENCES public.pathpilot_goals(id),
  version integer NOT NULL,
  daily_hours real NOT NULL,
  deadline date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pathpilot_plan_version_tasks (
  id serial PRIMARY KEY,
  plan_version_id integer NOT NULL REFERENCES public.pathpilot_plan_versions(id),
  task_id integer NOT NULL REFERENCES public.pathpilot_tasks(id),
  scheduled_date date,
  task_name text,
  topic text,
  duration_hours real
);

CREATE INDEX IF NOT EXISTS pathpilot_tasks_goal_idx
  ON public.pathpilot_tasks USING btree (goal_id);
CREATE INDEX IF NOT EXISTS pathpilot_progress_user_task_date_idx
  ON public.pathpilot_progress USING btree (user_id, task_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS pathpilot_dependency_pair_uq
  ON public.pathpilot_dependencies USING btree (task_id, depends_on);
CREATE INDEX IF NOT EXISTS pathpilot_milestones_goal_idx
  ON public.pathpilot_milestones USING btree (goal_id);
CREATE UNIQUE INDEX IF NOT EXISTS pathpilot_milestone_task_uq
  ON public.pathpilot_milestone_tasks USING btree (milestone_id, task_id);
CREATE UNIQUE INDEX IF NOT EXISTS pathpilot_plan_versions_goal_version_uq
  ON public.pathpilot_plan_versions USING btree (goal_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS pathpilot_plan_version_task_uq
  ON public.pathpilot_plan_version_tasks USING btree (plan_version_id, task_id);

COMMIT;
