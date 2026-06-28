UPDATE site_design_tokens
SET global_colors = jsonb_set(
  jsonb_set(
    jsonb_set(global_colors,
      '{input-hover-bg}', '{"light":"#fff7ed","dark":"#1f2937"}'::jsonb),
    '{input-placeholder}', '{"light":"#94a3b8","dark":"#64748b"}'::jsonb),
  '{input-hover-border}', '{"light":"#FDB078","dark":"#FDB078"}'::jsonb
);