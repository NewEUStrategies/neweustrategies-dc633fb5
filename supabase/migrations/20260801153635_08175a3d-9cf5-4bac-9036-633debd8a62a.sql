-- Poprawki tłumaczeń EN w widgetach strony /o-nas.
-- Wartości EN były pozostawione na szablonowych domyślnych ("Join us",
-- "fast/easy/effective") albo zawierały polski tekst, więc /en/o-nas
-- renderowało nagłówki niezgodne z polską wersją.
create or replace function pg_temp.patch_widget_content(doc jsonb, patches jsonb)
returns jsonb
language plpgsql
as $$
declare
  key text;
  item jsonb;
  arr jsonb := '[]'::jsonb;
  out_doc jsonb;
begin
  if jsonb_typeof(doc) = 'array' then
    for item in select value from jsonb_array_elements(doc) loop
      arr := arr || jsonb_build_array(pg_temp.patch_widget_content(item, patches));
    end loop;
    return arr;
  elsif jsonb_typeof(doc) = 'object' then
    out_doc := doc;
    if doc ? 'id' and doc ? 'content' and patches ? (doc->>'id') then
      out_doc := jsonb_set(out_doc, '{content}', (doc->'content') || (patches->(doc->>'id')));
    end if;
    for key in select jsonb_object_keys(out_doc) loop
      if jsonb_typeof(out_doc->key) in ('array','object') then
        out_doc := jsonb_set(out_doc, array[key], pg_temp.patch_widget_content(out_doc->key, patches));
      end if;
    end loop;
    return out_doc;
  end if;
  return doc;
end;
$$;

update public.pages
set builder_data = pg_temp.patch_widget_content(builder_data, jsonb_build_object(
      'ac9cbcdf-5b10-4f48-acd5-143d5ab2e5cf', jsonb_build_object(
        'textBefore_en', 'Get to know',
        'highlight_en', 'us better',
        'textAfter_en', '',
        'rotateWords_en', jsonb_build_array('quickly','easily','effectively')),
      '479c43dd-072d-45c1-90fd-9a792d5203a4', jsonb_build_object(
        'textBefore_en', 'What initiatives',
        'highlight_en', 'do we create',
        'textAfter_en', '?',
        'rotateWords_en', jsonb_build_array('quickly','easily','effectively')),
      '6742c71a-2673-46b6-98ea-9c6cb6da2a53', jsonb_build_object(
        'textBefore_en', 'Meet our',
        'highlight_en', 'team',
        'textAfter_en', '',
        'rotateWords_en', jsonb_build_array('quickly','easily','effectively')),
      'fe47a674-ea73-45ee-b47d-08767d1f8d69', jsonb_build_object(
        'text_en', 'PROGRAMME COUNCILS'),
      'c127db5e-7e90-4f68-a369-d2c199041599', jsonb_build_object(
        'text_en', 'ANALYSTS')
    )),
    updated_at = now()
where slug = 'o-nas';