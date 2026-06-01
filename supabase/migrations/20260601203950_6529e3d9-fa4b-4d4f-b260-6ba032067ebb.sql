UPDATE public.pages
SET builder_data = jsonb_set(
  builder_data,
  '{sections,1,children,1,children}',
  $j$[
    {
      "id": "slider-hero-001",
      "kind": "widget",
      "type": "slider",
      "content": {
        "source": "posts",
        "variant": "hero-overlay",
        "ratio": "16/9",
        "rounded": "lg",
        "autoplay": true,
        "intervalMs": 5500,
        "overlayOpacity": 0.55,
        "limit": 5,
        "orderBy": "newest",
        "categoryId": "",
        "tagSlugs": "",
        "excludeIds": "",
        "showExcerpt": true,
        "cta_pl": "Czytaj więcej",
        "cta_en": "Read more",
        "items": []
      }
    }
  ]$j$::jsonb,
  false
), updated_at = now()
WHERE id = 'f6a17dcc-ed23-47be-ab11-08eebd907df6';