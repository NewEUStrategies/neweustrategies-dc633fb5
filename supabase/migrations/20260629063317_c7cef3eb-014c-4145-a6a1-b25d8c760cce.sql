
WITH label_map(label, iso) AS (VALUES
  ('hindi','IN'),('english','GB'),('arabic','SA'),('french','FR'),('polish','PL'),
  ('spanish','ES'),('russian','RU'),('japanese','JP'),('portuguese','PT'),('greek','GR'),
  ('italian','IT'),('turkish','TR'),('scandinavian','SE'),('german','DE'),('chinese','CN'),
  ('ukrainian','UA'),('balkan','RS'),('serbian','RS')
),
legacy AS (
  SELECT nd.id, nd.name_normalized, lm.iso
  FROM public.name_dictionary nd
  JOIN label_map lm ON lower(nd.origin) = lm.label
)
DELETE FROM public.name_dictionary
WHERE id IN (
  SELECT l.id FROM legacy l
  WHERE EXISTS (
    SELECT 1 FROM public.name_dictionary nd2
    WHERE nd2.name_normalized = l.name_normalized
      AND nd2.origin_country = l.iso
      AND nd2.id <> l.id
  )
);

UPDATE public.name_dictionary SET origin = m.iso, origin_country = m.iso
FROM (VALUES
  ('hindi','IN'),('english','GB'),('arabic','SA'),('french','FR'),('polish','PL'),
  ('spanish','ES'),('russian','RU'),('japanese','JP'),('portuguese','PT'),('greek','GR'),
  ('italian','IT'),('turkish','TR'),('scandinavian','SE'),('german','DE'),('chinese','CN'),
  ('ukrainian','UA'),('balkan','RS'),('serbian','RS')
) AS m(label, iso)
WHERE lower(name_dictionary.origin) = m.label;
