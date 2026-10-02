WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY message_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM public.email_send_log
   WHERE status = 'pending'
     AND message_id IS NOT NULL
     AND (metadata ->> 'idempotency_key') IS NOT NULL
)
UPDATE public.email_send_log AS l
   SET metadata = l.metadata - 'idempotency_key'
  FROM ranked
 WHERE l.id = ranked.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS email_send_log_idempotent_pending_uidx
  ON public.email_send_log (message_id)
  WHERE status = 'pending' AND (metadata ->> 'idempotency_key') IS NOT NULL;

COMMENT ON INDEX public.email_send_log_idempotent_pending_uidx IS
  'Zajęcie klucza idempotencji /platform/email/transactional/send: jeden wiersz pending z kluczem (metadata.idempotency_key) na message_id. message_id = SHA-256(przestrzeń trasy, wywołujący, klucz), więc unikalność obejmuje parę (wywołujący, klucz). Przegrana w wyścigu (23505) jest obsługiwana w trasie jak powtórzenie.';