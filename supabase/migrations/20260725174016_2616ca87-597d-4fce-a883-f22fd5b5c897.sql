CREATE INDEX IF NOT EXISTS messages_conv_created_id_desc_idx
  ON public.messages (conversation_id, created_at DESC, id DESC);