UPDATE public.site_design_tokens
SET global_colors = jsonb_set(
  jsonb_set(global_colors, '{input-border,light}', '"#e2e8f0"'),
  '{input-border,dark}',
  '"#1f1f1f"'
)
WHERE global_colors ? 'input-border';