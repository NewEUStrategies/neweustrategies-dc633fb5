WITH cur AS (
  SELECT
    s.tenant_id,
    s.key,
    s.value AS doc,
    s.value #> '{builder_data,sections,0,children,0,children,3,content}' AS content
  FROM public.site_settings s
  WHERE s.key = 'footer'
    AND s.value #>> '{builder_data,sections,0,children,0,children,3,id}' = 'ftr-social'
    AND s.value #>> '{builder_data,sections,0,children,0,children,3,type}' = 'social-icons'
),
fixed AS (
  SELECT
    cur.tenant_id,
    cur.key,
    jsonb_set(
      cur.doc,
      '{builder_data,sections,0,children,0,children,3,content}',
      (cur.content - 'twitter')
        || jsonb_build_object(
             'facebook',
             CASE
               WHEN COALESCE(cur.content ->> 'facebook', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'facebook'
               ELSE 'https://www.facebook.com/NewEuropeanStrategies'
             END,
             'x',
             CASE
               WHEN COALESCE(cur.content ->> 'x', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'x'
               WHEN COALESCE(cur.content ->> 'twitter', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'twitter'
               ELSE 'https://x.com/NewEUStrategies'
             END,
             'linkedin',
             CASE
               WHEN COALESCE(cur.content ->> 'linkedin', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'linkedin'
               ELSE 'https://www.linkedin.com/company/new-european-strategies'
             END,
             'instagram',
             CASE
               WHEN COALESCE(cur.content ->> 'instagram', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'instagram'
               ELSE 'https://www.instagram.com/neweuropeanstrategies'
             END,
             'youtube',
             CASE
               WHEN COALESCE(cur.content ->> 'youtube', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'youtube'
               ELSE ''
             END,
             'spotify',
             CASE
               WHEN COALESCE(cur.content ->> 'spotify', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'spotify'
               ELSE ''
             END,
             'email', 'office@neweuropeanstrategies.com'
           ),
      true
    ) AS doc
  FROM cur
)
UPDATE public.site_settings s
SET value = fixed.doc,
    updated_at = now()
FROM fixed
WHERE s.tenant_id = fixed.tenant_id
  AND s.key = fixed.key;