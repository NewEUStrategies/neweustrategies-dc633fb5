UPDATE public.membership_tiers
SET benefits = replace(
                 replace(
                   replace(
                     replace(benefits::text,
                       'Pogłębiony digest członkowski', 'Pogłębiony biuletyn członkowski'),
                     'in-depth digest', 'in-depth briefing'),
                   'Digest członkowski', 'Biuletyn członkowski'),
                 'Member digest', 'Member briefing')::jsonb
WHERE benefits::text ILIKE '%digest%';