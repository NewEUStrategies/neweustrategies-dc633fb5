UPDATE pages
SET builder_data = REPLACE(REPLACE(REPLACE(REPLACE(builder_data::text,
    'Krótkie bio…',''),
    'Krótkie bio...',''),
    'Krótkie bio.',''),
    'Krótkie bio','')::jsonb
WHERE builder_data::text ILIKE '%Krótkie bio%';

UPDATE pages
SET content_pl = REPLACE(REPLACE(REPLACE(REPLACE(content_pl::text,
    'Krótkie bio…',''),
    'Krótkie bio...',''),
    'Krótkie bio.',''),
    'Krótkie bio','')::jsonb
WHERE content_pl::text ILIKE '%Krótkie bio%';

UPDATE pages
SET content_en = REPLACE(REPLACE(content_en::text,
    'Short bio…',''),
    'Short bio...','')::jsonb
WHERE content_en::text ILIKE '%Short bio%';