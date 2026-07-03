UPDATE pages
SET builder_data = jsonb_set(
  jsonb_set(
    jsonb_set(
      builder_data,
      '{sections,0,children,0,order}', '{"mobile":2}'::jsonb
    ),
    '{sections,0,children,1,order}', '{"mobile":1}'::jsonb
  ),
  '{sections,0,children,2,order}', '{"mobile":3}'::jsonb
)
WHERE id = '858afcbf-c22b-4b4d-a9b0-766d6b7867ff'
  AND builder_data->'sections'->0->'children'->0->>'id' = 'eb90ce72-3c2f-486b-84a9-87f7943df8d8';