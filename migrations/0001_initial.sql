create table if not exists users (
  id uuid primary key,
  whatsapp_user_id text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_blocked boolean not null default false
);

create table if not exists pending_sender_labels (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  label text not null,
  normalized_label text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists pending_sender_labels_user_expires_idx
  on pending_sender_labels (user_id, expires_at);

create index if not exists pending_sender_labels_unconsumed_user_idx
  on pending_sender_labels (user_id)
  where consumed_at is null;

create table if not exists inbound_messages (
  id uuid primary key,
  whatsapp_message_id text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  message_type text not null,
  received_at timestamptz not null default now(),
  whatsapp_timestamp timestamptz,
  media_id text,
  mime_type text,
  is_voice_note boolean,
  text_body text,
  status text not null,
  error_code text,
  constraint inbound_messages_status_check
    check (status in ('received', 'ignored', 'queued', 'processing', 'completed', 'failed'))
);

create index if not exists inbound_messages_user_received_idx
  on inbound_messages (user_id, received_at desc);

create table if not exists summary_jobs (
  id uuid primary key,
  inbound_message_id uuid not null unique references inbound_messages(id) on delete cascade,
  status text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  download_latency_ms integer,
  transcription_latency_ms integer,
  summary_latency_ms integer,
  total_latency_ms integer,
  error_code text,
  error_detail_sanitized text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint summary_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'retryable_failed', 'terminal_failed'))
);

create index if not exists summary_jobs_status_next_attempt_idx
  on summary_jobs (status, next_attempt_at);

create index if not exists summary_jobs_locked_at_idx
  on summary_jobs (locked_at);

create table if not exists summaries (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  inbound_message_id uuid not null unique references inbound_messages(id) on delete cascade,
  reference_code text,
  from_label text not null,
  from_label_confidence text not null,
  one_sentence_summary text not null,
  short_summary text not null,
  important_points_json jsonb not null default '[]'::jsonb,
  questions_or_requests_json jsonb not null default '[]'::jsonb,
  dates_or_commitments_json jsonb not null default '[]'::jsonb,
  reply_needed boolean not null,
  listening_recommendation text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  deleted_at timestamptz
);

create index if not exists summaries_user_created_idx
  on summaries (user_id, created_at desc);

create index if not exists summaries_active_expires_idx
  on summaries (expires_at)
  where deleted_at is null;

create unique index if not exists summaries_user_reference_code_idx
  on summaries (user_id, reference_code)
  where reference_code is not null;

create table if not exists transcripts (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  inbound_message_id uuid not null unique references inbound_messages(id) on delete cascade,
  summary_id uuid not null unique references summaries(id) on delete cascade,
  text text not null,
  character_count integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  deleted_at timestamptz
);

create index if not exists transcripts_user_created_idx
  on transcripts (user_id, created_at desc);

create index if not exists transcripts_active_expires_idx
  on transcripts (expires_at)
  where deleted_at is null;

create table if not exists outbound_messages (
  id uuid primary key,
  inbound_message_id uuid not null references inbound_messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  reply_kind text not null,
  chunk_index integer not null default 0,
  whatsapp_message_id text,
  status text not null,
  body_sha256 text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error_code text,
  constraint outbound_messages_status_check
    check (status in ('pending', 'sent', 'failed')),
  constraint outbound_messages_reply_kind_check
    check (reply_kind in (
      'processing_ack',
      'summary',
      'transcript',
      'failure',
      'help',
      'status',
      'delete_confirmation'
    ))
);

create unique index if not exists outbound_messages_idempotency_idx
  on outbound_messages (inbound_message_id, reply_kind, chunk_index);
