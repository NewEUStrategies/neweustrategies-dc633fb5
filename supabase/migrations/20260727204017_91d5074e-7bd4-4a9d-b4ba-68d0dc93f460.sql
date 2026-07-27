
-- Translate/synchronize EN copy on the homepage builder (pages.slug='main')
-- by walking builder_data JSON and updating specific widgets by id.
CREATE OR REPLACE FUNCTION pg_temp.apply_widget_updates(doc jsonb, updates jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  wid text;
  patch jsonb;
  new_content jsonb;
BEGIN
  IF jsonb_typeof(doc) = 'object' THEN
    IF doc ? 'id' AND doc ? 'content' THEN
      wid := doc->>'id';
      IF updates ? wid THEN
        patch := updates->wid;
        new_content := (doc->'content') || patch;
        doc := jsonb_set(doc, '{content}', new_content, false);
      END IF;
    END IF;
    IF doc ? 'children' THEN
      doc := jsonb_set(doc, '{children}', pg_temp.apply_widget_updates(doc->'children', updates), false);
    END IF;
    IF doc ? 'sections' THEN
      doc := jsonb_set(doc, '{sections}', pg_temp.apply_widget_updates(doc->'sections', updates), false);
    END IF;
    RETURN doc;
  ELSIF jsonb_typeof(doc) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.apply_widget_updates(el, updates)), '[]'::jsonb)
            FROM jsonb_array_elements(doc) el);
  ELSE
    RETURN doc;
  END IF;
END $$;

UPDATE public.pages
SET builder_data = pg_temp.apply_widget_updates(builder_data, jsonb_build_object(
  '63775296-f096-46b7-a152-f41098f13bdb', jsonb_build_object('label_en','Latest report','action_en','more'),
  'dacc84d6-1ace-424a-9d00-84741689cd8c', jsonb_build_object('label_en','Upcoming events','action_en','more'),
  '855cda86-00c7-4730-bab1-64335696661a', jsonb_build_object('label_en','Expert opinions','action_en','more'),
  'dcb9761b-fbf5-4703-b24d-1cf902cf8f4d', jsonb_build_object('label_en','Explore our reports','action_en','more'),
  '6ea4b9eb-4600-46b5-8d00-e483ab22cd6e', jsonb_build_object('label_en','Interviews | Podcasts','action_en','more'),
  '29b3972a-3236-4139-95c0-b818159a29d3', jsonb_build_object('label_en','Military & Geopolitics','action_en','see more'),
  'ba82b29e-113f-46d3-98e4-dd4458201fad', jsonb_build_object('label_en','Book reviews','action_en','more'),
  'e63d9904-1e06-4646-857e-ceabdf0c6b03', jsonb_build_object('label_en','Transport & Energy','action_en','more'),
  'a777ce78-9978-4455-b322-23f82d4405e2', jsonb_build_object('label_en','Diplomacy','action_en','more'),
  'f31b068d-54dc-4148-aba9-d56c9aa25f21', jsonb_build_object('label_en','Cybersecurity','action_en','more'),
  'fe7b212f-d71a-424e-8a77-7be5f101fcea', jsonb_build_object('label_en','Content from our partners','action_en','More sponsored content'),
  '201c1d82-7e12-4837-ac08-1fba53f2fc67', jsonb_build_object(
    'textBefore_en','Join','highlight_en','us','textAfter_en','',
    'rotateWords_en', jsonb_build_array('fast','easy','effective')
  )
)),
title_en = 'Home',
updated_at = now()
WHERE slug = 'main';
