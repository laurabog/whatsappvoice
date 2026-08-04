alter table pending_sender_labels
  add column if not exists target_inbound_message_id uuid;

do $$
begin
  alter table pending_sender_labels
    add constraint pending_sender_labels_target_inbound_message_id_fkey
      foreign key (target_inbound_message_id)
      references inbound_messages(id)
      on delete cascade;
exception
  when duplicate_object then null;
end $$;

create index if not exists pending_sender_labels_target_unconsumed_idx
  on pending_sender_labels (target_inbound_message_id, created_at desc)
  where consumed_at is null
    and target_inbound_message_id is not null;

create index if not exists pending_sender_labels_user_target_unconsumed_idx
  on pending_sender_labels (user_id, target_inbound_message_id, created_at desc)
  where consumed_at is null;
