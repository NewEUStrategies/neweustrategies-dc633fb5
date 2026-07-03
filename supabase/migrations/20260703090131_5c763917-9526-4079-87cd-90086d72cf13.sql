UPDATE pages
SET builder_data = jsonb_set(
  jsonb_set(
    builder_data,
    '{sections,1,children,0,order}',
    '{"mobile": 2}'::jsonb,
    true
  ),
  '{sections,1,children,1,order}',
  '{"mobile": 1}'::jsonb,
  true
)
WHERE id = '858afcbf-c22b-4b4d-a9b0-766d6b7867ff'
  AND deleted_at IS NULL;