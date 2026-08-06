WITH payload AS (
  SELECT jsonb_build_object(
    'enabled', true,
    'show_labels', true,
    'hide_on_scroll', true,
    'offset_bottom', 12,
    'radius', 6,
    'background_light', '#ffffff',
    'background_dark', '#111318',
    'icon_light', '#6b7280',
    'icon_dark', '#9aa3b2',
    'use_item_color', true,
    'items', jsonb_build_array(
      jsonb_build_object('id','network','label_key','mobileBottomBar.itemLabels.network','label_pl','','label_en','','icon','users','href','/network','color','#2f6df6','color_dark','#7aa7ff','badge','network','enabled',true),
      jsonb_build_object('id','chats','label_key','mobileBottomBar.itemLabels.chats','label_pl','','label_en','','icon','messages-square','href','/messages','color','#0a8f6d','color_dark','#3fd7ab','badge','chat','enabled',true),
      jsonb_build_object('id','home','label_key','mobileBottomBar.itemLabels.home','label_pl','','label_en','','icon','home','href','/','color','#b85410','color_dark','#fa9346','badge','none','enabled',true),
      jsonb_build_object('id','saved','label_key','mobileBottomBar.itemLabels.saved','label_pl','','label_en','','icon','bookmark','href','/reading-list','color','#6d3fd4','color_dark','#b79bff','badge','none','enabled',true),
      jsonb_build_object('id','profile','label_key','mobileBottomBar.itemLabels.profile','label_pl','','label_en','','icon','circle-user','href','/profile','color','#be123c','color_dark','#fb7185','badge','none','enabled',true)
    )
  ) AS value
)
INSERT INTO public.site_settings (tenant_id, key, value)
SELECT t.id, 'mobile_bottom_bar', p.value
FROM public.tenants t
CROSS JOIN payload p
ON CONFLICT (tenant_id, key) DO UPDATE
SET value = CASE
  WHEN COALESCE(jsonb_array_length(site_settings.value -> 'items'), 0) = 0
    OR site_settings.value -> 'items' @> '[{"href": "/analizy"}]'::jsonb
    THEN EXCLUDED.value
  ELSE site_settings.value || jsonb_build_object('enabled', true, 'radius', 6)
END;