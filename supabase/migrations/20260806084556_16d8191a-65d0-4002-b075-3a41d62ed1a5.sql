UPDATE public.site_settings
SET value = value || jsonb_build_object('radius', 20, 'show_labels', false)
WHERE key = 'mobile_bottom_bar'
  AND (value ->> 'radius') = '6'
  AND (value ->> 'show_labels') = 'true';

UPDATE public.site_settings
SET value = value || jsonb_build_object('show_labels', false)
WHERE key = 'mobile_bottom_bar'
  AND (value ->> 'radius') <> '6'
  AND (value ->> 'show_labels') = 'true'
  AND value -> 'items' @> '[{"label_key": "mobileBottomBar.itemLabels.home"}]'::jsonb;