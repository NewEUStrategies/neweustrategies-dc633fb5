-- Dodaje kolumny audio_url_pl i audio_url_en do postów. Gdy wypełnione,
-- widget "Posłuchaj artykułu" w sidebarze odtwarza wgrany plik MP3 zamiast
-- generować narrację przez ElevenLabs (per język niezależnie).
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS audio_url_pl text,
  ADD COLUMN IF NOT EXISTS audio_url_en text;

COMMENT ON COLUMN public.posts.audio_url_pl IS
  'Opcjonalny URL do własnego MP3 (PL). Gdy ustawiony, sidebar player nie wywoła TTS dla języka PL.';
COMMENT ON COLUMN public.posts.audio_url_en IS
  'Opcjonalny URL do własnego MP3 (EN). Gdy ustawiony, sidebar player nie wywoła TTS dla języka EN.';
