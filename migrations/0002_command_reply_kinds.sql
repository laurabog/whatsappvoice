alter table outbound_messages
  drop constraint if exists outbound_messages_reply_kind_check;

alter table outbound_messages
  add constraint outbound_messages_reply_kind_check
    check (reply_kind in (
      'processing_ack',
      'summary',
      'transcript',
      'failure',
      'help',
      'status',
      'sender_label',
      'unsupported_text',
      'delete_confirmation'
    ));
