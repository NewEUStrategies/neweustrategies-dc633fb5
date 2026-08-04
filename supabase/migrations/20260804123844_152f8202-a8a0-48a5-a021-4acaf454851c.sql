UPDATE public.newsletter_settings
SET popup_showcase_images = '[
  {"url":"https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/newsletter%2Fpopup%2Fraporty.jpg","caption_pl":"Raporty i analizy","caption_en":"Reports and analysis"},
  {"url":"https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/newsletter%2Fpopup%2Fspotkania.jpg","caption_pl":"Spotkania eksperckie","caption_en":"Expert meetings"},
  {"url":"https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/newsletter%2Fpopup%2Fwywiady.jpg","caption_pl":"Wywiady","caption_en":"Interviews"},
  {"url":"https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/newsletter%2Fpopup%2Fspolecznosc.jpg","caption_pl":"Społeczność","caption_en":"Community"}
]'::jsonb,
    updated_at = now()
WHERE coalesce(jsonb_array_length(popup_showcase_images), 0) = 0;