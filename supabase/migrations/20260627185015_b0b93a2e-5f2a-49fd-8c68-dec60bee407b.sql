
-- Update the homepage slider widget to pull from real posts.
UPDATE public.pages
SET builder_data = jsonb_set(
  builder_data,
  '{sections}',
  (
    SELECT jsonb_agg(
      CASE WHEN sec ? 'children' THEN
        jsonb_set(sec, '{children}', (
          SELECT jsonb_agg(
            CASE WHEN col ? 'children' THEN
              jsonb_set(col, '{children}', (
                SELECT jsonb_agg(
                  CASE
                    WHEN w->>'type' = 'slider' AND (w->'content'->>'source') IS DISTINCT FROM 'posts' THEN
                      jsonb_set(
                        w,
                        '{content}',
                        (w->'content')
                          || jsonb_build_object(
                            'source', 'posts',
                            'limit', 5,
                            'orderBy', 'newest',
                            'showExcerpt', true,
                            'cta_pl', 'Czytaj więcej',
                            'cta_en', 'Read more'
                          )
                      )
                    ELSE w
                  END
                )
                FROM jsonb_array_elements(col->'children') AS w
              ))
            ELSE col END
          )
          FROM jsonb_array_elements(sec->'children') AS col
        ))
      ELSE sec END
    )
    FROM jsonb_array_elements(builder_data->'sections') AS sec
  )
)
WHERE id = '858afcbf-c22b-4b4d-a9b0-766d6b7867ff'
  AND builder_data ? 'sections';
