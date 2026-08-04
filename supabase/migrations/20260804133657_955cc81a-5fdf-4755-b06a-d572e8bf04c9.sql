UPDATE public.newsletter_settings
SET popup_showcase_images = (
  SELECT jsonb_agg(
    CASE img->>'url'
      WHEN 'https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/newsletter%2Fpopup%2Fraporty.jpg'
        THEN img || jsonb_build_object('title_pl','Raporty i analizy','title_en','Reports and analysis','caption_pl','Cotygodniowe opracowania polityki europejskiej','caption_en','Weekly briefings on European policy')
      WHEN 'https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/newsletter%2Fpopup%2Fspotkania.jpg'
        THEN img || jsonb_build_object('title_pl','Spotkania eksperckie','title_en','Expert meetings','caption_pl','Debaty i okrągłe stoły z decydentami','caption_en','Debates and roundtables with decision makers')
      WHEN 'https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/newsletter%2Fpopup%2Fwywiady.jpg'
        THEN img || jsonb_build_object('title_pl','Wywiady','title_en','Interviews','caption_pl','Rozmowy z liderami opinii i praktykami','caption_en','Conversations with opinion leaders and practitioners')
      ELSE img || jsonb_build_object('title_pl','Społeczność','title_en','Community','caption_pl','Sieć ekspertów i partnerów w całej Europie','caption_en','A network of experts and partners across Europe')
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(popup_showcase_images::jsonb) WITH ORDINALITY AS t(img, ord)
)
WHERE popup_showcase_images IS NOT NULL
  AND jsonb_typeof(popup_showcase_images::jsonb) = 'array'
  AND jsonb_array_length(popup_showcase_images::jsonb) > 0;