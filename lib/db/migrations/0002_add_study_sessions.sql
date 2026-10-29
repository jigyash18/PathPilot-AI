-- Apply only after explicit approval and a verified backup.
-- Intentionally no IF NOT EXISTS: an existing object requires review, not reuse.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.pathpilot_study_sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.pathpilot_users(id),
  goal_id integer REFERENCES public.pathpilot_goals(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pathpilot_study_sessions_duration_check CHECK (
    ended_at - started_at BETWEEN interval '1 minute' AND interval '12 hours'
  )
);
CREATE UNIQUE INDEX pathpilot_study_sessions_request_uq
  ON public.pathpilot_study_sessions (user_id, request_id);
CREATE INDEX pathpilot_study_sessions_user_start_idx
  ON public.pathpilot_study_sessions (user_id, started_at);
CREATE INDEX pathpilot_study_sessions_user_end_idx
  ON public.pathpilot_study_sessions (user_id, ended_at);
CREATE INDEX pathpilot_study_sessions_goal_idx
  ON public.pathpilot_study_sessions (goal_id);
COMMIT;
