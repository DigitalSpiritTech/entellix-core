CREATE TABLE memory_events (
  id uuid PRIMARY KEY,
  raw_event text NOT NULL,
  source_context text,
  source_type text NOT NULL CHECK (source_type IN ('mcp', 'rest', 'backfill', 'hook', 'webhook')),
  source_trust_class text NOT NULL DEFAULT 'first_party' CHECK (source_trust_class IN ('first_party', 'external_included', 'integration')),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error text,
  raw_redacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_events_queue_idx ON memory_events (status, created_at);

CREATE TABLE memory_candidates (
  id uuid PRIMARY KEY,
  source_event_id uuid NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
  candidate_index integer NOT NULL CHECK (candidate_index >= 0),
  candidate_text text NOT NULL,
  provisional_type text NOT NULL,
  evidence_span text NOT NULL,
  reason_summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_classification', 'classified', 'committed', 'rejected', 'review', 'expired')),
  extractor_version text NOT NULL,
  extractor_model text NOT NULL,
  classification jsonb,
  disposition jsonb,
  evidence_redacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memory_candidates_event_index_uq ON memory_candidates (source_event_id, candidate_index);
CREATE INDEX memory_candidates_review_idx ON memory_candidates (status, created_at);

CREATE TABLE memories (
  id uuid PRIMARY KEY,
  source_candidate_id uuid UNIQUE REFERENCES memory_candidates(id) ON DELETE SET NULL,
  text text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('profile', 'organization')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed', 'superseded', 'expired')),
  memory_type text NOT NULL,
  owner_scope_type text NOT NULL CHECK (owner_scope_type IN ('user', 'org')),
  render_policy text NOT NULL CHECK (render_policy IN ('always', 'retrieval', 'pinned', 'never')),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_authority text NOT NULL CHECK (source_authority IN ('explicit', 'inferred', 'integration')),
  sensitivity text NOT NULL CHECK (sensitivity IN ('normal', 'sensitive', 'secret')),
  entity_ids uuid[] NOT NULL DEFAULT '{}',
  embedding double precision[],
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  expires_at timestamptz,
  superseded_by uuid REFERENCES memories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memories_active_idx ON memories (status, updated_at DESC);
CREATE INDEX memories_text_search_idx ON memories USING gin (to_tsvector('english', text));

CREATE TABLE memory_reviews (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES memory_candidates(id) ON DELETE CASCADE,
  action text NOT NULL,
  note text,
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_reviews_candidate_idx ON memory_reviews (candidate_id, created_at DESC);
