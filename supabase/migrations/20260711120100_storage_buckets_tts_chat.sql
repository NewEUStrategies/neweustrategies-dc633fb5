-- ============================================================================
-- Brakujące buckety storage (audyt platformy).
--
-- 1) chat-attachments: polityki storage.objects istnieją od 20260710092717,
--    ale sam bucket NIGDY nie został utworzony żadną migracją - każdy upload
--    załącznika czatu padał na createSignedUploadUrl. Bucket prywatny,
--    limit 30 MB (lustro klienta), allowlist MIME egzekwowany po stronie
--    serwera (dotąd tylko deklaratywnie w kliencie; bez SVG - aktywna treść).
--
-- 2) tts-cache: prywatny bucket na zsyntezowane MP3 endpointu /api/public/
--    post-tts. Dotąd każdy słuchacz tego samego artykułu płacił pełną
--    syntezę ElevenLabs od nowa (nagłówki cache na POST nic nie dają).
--    Dostęp wyłącznie service role - brak jakichkolwiek polityk klienckich.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments', 'chat-attachments', false, 31457280,
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp',
    'application/pdf',
    'text/plain','text/markdown','text/csv','application/rtf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tts-cache', 'tts-cache', false, 52428800, ARRAY['audio/mpeg'])
ON CONFLICT (id) DO NOTHING;
