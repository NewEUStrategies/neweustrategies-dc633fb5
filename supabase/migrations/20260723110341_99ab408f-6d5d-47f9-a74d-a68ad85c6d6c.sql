UPDATE public.membership_tiers
SET benefits = (
  SELECT jsonb_agg(
    CASE
      WHEN idx = 0 THEN jsonb_build_object(
        'pl', 'Do 5 pogłębionych materiałów analitycznych miesięcznie',
        'en', 'Up to 5 in-depth analytical materials per month'
      ) || (elem - 'pl' - 'en')
      ELSE elem
    END
    ORDER BY idx
  )
  FROM jsonb_array_elements(benefits) WITH ORDINALITY AS t(elem, idx_1based)
  CROSS JOIN LATERAL (SELECT (idx_1based - 1)::int AS idx) s
)
WHERE key = 'reader'
  AND benefits IS NOT NULL
  AND jsonb_typeof(benefits) = 'array'
  AND jsonb_array_length(benefits) > 0;