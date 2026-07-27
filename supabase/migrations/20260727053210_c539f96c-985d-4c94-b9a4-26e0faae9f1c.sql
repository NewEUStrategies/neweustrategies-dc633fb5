
DO $$
DECLARE
  v_current jsonb;
  v_newsletter jsonb;
  v_new_sections jsonb;
  boxed jsonb := jsonb_build_object('layout', jsonb_build_object('contentWidth','boxed','width',1400));

  -- helper wrappers built via jsonb_build_object inline below
BEGIN
  SELECT builder_data INTO v_current FROM public.pages WHERE slug='analizy' LIMIT 1;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Brak strony analizy'; END IF;

  -- keep existing newsletter section (last one)
  v_newsletter := v_current->'sections'->(jsonb_array_length(v_current->'sections')-1);

  v_new_sections := jsonb_build_array(
    -- 1) HERO (boxed 1400)
    jsonb_build_object(
      'id', 'sec-hero-'||substr(md5(random()::text),1,8),
      'kind','section',
      'layout', jsonb_build_object('contentWidth','boxed','width',1400),
      'children', jsonb_build_array(
        jsonb_build_object(
          'id','col-hero','kind','column','span',jsonb_build_object('desktop',12),
          'children', jsonb_build_array(
            jsonb_build_object('id','kicker-a','kind','widget','type','text',
              'content', jsonb_build_object('align','center','size','sm',
                'text_pl','<span style="color:#f57c1f;font-weight:600;letter-spacing:.08em;text-transform:uppercase;">New European Strategies</span>',
                'text_en','<span style="color:#f57c1f;font-weight:600;letter-spacing:.08em;text-transform:uppercase;">New European Strategies</span>')),
            jsonb_build_object('id','h1-a','kind','widget','type','heading',
              'content', jsonb_build_object('align','center','sizePreset','display','tag','h1',
                'text_pl','Analizy','text_en','Analyses','variant','gradient')),
            jsonb_build_object('id','lead-a','kind','widget','type','text',
              'content', jsonb_build_object('align','center','size','lg',
                'text_pl','Autorska analiza wydarzeń politycznych, gospodarczych i społecznych - spojrzenie ekspertów.',
                'text_en','In-depth analysis of political, economic and social developments - expert perspectives.'))
          )
        )
      )
    ),

    -- 2) HERO CATEGORIES 3 | 6 | 3
    jsonb_build_object(
      'id','sec-cats-'||substr(md5(random()::text),1,8),
      'kind','section',
      'layout', jsonb_build_object('contentWidth','boxed','width',1400),
      'children', jsonb_build_array(
        -- LEFT COL 3: Transport + Energetyka
        jsonb_build_object('id','col-left','kind','column','span',jsonb_build_object('desktop',3),
          'children', jsonb_build_array(
            jsonb_build_object('id','sl-tr','kind','widget','type','section-label',
              'content', jsonb_build_object(
                'label_pl','Transport','label_en','Transportation',
                'color','transport','variant','left-bar',
                'action_pl','Zobacz więcej','action_en','See more',
                'href','/category/transport')),
            jsonb_build_object('id','pl-tr','kind','widget','type','post-list',
              'content', jsonb_build_object('category','transport','columns',1,'limit',2,'variant','list')),
            jsonb_build_object('id','sl-en','kind','widget','type','section-label',
              'content', jsonb_build_object(
                'label_pl','Energetyka','label_en','Energy',
                'color','brand','variant','left-bar',
                'action_pl','Zobacz więcej','action_en','See more',
                'href','/category/energetyka')),
            jsonb_build_object('id','pl-en','kind','widget','type','post-list',
              'content', jsonb_build_object('category','energetyka','columns',1,'limit',2,'variant','list'))
          )),
        -- CENTER COL 6: Geopolityka (hero overlay + grid)
        jsonb_build_object('id','col-center','kind','column','span',jsonb_build_object('desktop',6),
          'children', jsonb_build_array(
            jsonb_build_object('id','sl-geo','kind','widget','type','section-label',
              'content', jsonb_build_object(
                'label_pl','Wojskowość i cyberbezpieczeństwo','label_en','Military & Cybersecurity',
                'color','military','variant','left-bar',
                'action_pl','Zobacz więcej','action_en','See more',
                'href','/category/geopolityka')),
            jsonb_build_object('id','pl-geo-hero','kind','widget','type','post-list',
              'content', jsonb_build_object('category','geopolityka','columns',1,'limit',1,'variant','overlay')),
            jsonb_build_object('id','pl-geo-grid','kind','widget','type','post-list',
              'content', jsonb_build_object('category','geopolityka','columns',3,'limit',3,'variant','card'))
          )),
        -- RIGHT COL 3: Dyplomacja + Gospodarka
        jsonb_build_object('id','col-right','kind','column','span',jsonb_build_object('desktop',3),
          'children', jsonb_build_array(
            jsonb_build_object('id','sl-dp','kind','widget','type','section-label',
              'content', jsonb_build_object(
                'label_pl','Dyplomacja','label_en','Diplomacy',
                'color','diplomacy','variant','left-bar',
                'action_pl','Zobacz więcej','action_en','See more',
                'href','/category/dyplomacja')),
            jsonb_build_object('id','pl-dp','kind','widget','type','post-list',
              'content', jsonb_build_object('category','dyplomacja','columns',1,'limit',2,'variant','list')),
            jsonb_build_object('id','sl-go','kind','widget','type','section-label',
              'content', jsonb_build_object(
                'label_pl','Finanse i Gospodarka','label_en','Finance & Economy',
                'color','finance','variant','left-bar',
                'action_pl','Zobacz więcej','action_en','See more',
                'href','/category/gospodarka')),
            jsonb_build_object('id','pl-go','kind','widget','type','post-list',
              'content', jsonb_build_object('category','gospodarka','columns',1,'limit',2,'variant','list'))
          ))
      )
    ),

    -- 3) LATEST full-width section-label + 3-col grid
    jsonb_build_object(
      'id','sec-latest-'||substr(md5(random()::text),1,8),
      'kind','section',
      'layout', jsonb_build_object('contentWidth','boxed','width',1400),
      'children', jsonb_build_array(
        jsonb_build_object('id','col-latest','kind','column','span',jsonb_build_object('desktop',12),
          'children', jsonb_build_array(
            jsonb_build_object('id','sl-latest','kind','widget','type','section-label',
              'content', jsonb_build_object(
                'label_pl','Najnowsze analizy','label_en','Latest analyses',
                'color','brand','variant','left-bar',
                'action_pl','Zobacz więcej','action_en','See more',
                'href','/blog')),
            jsonb_build_object('id','pl-latest','kind','widget','type','post-list',
              'content', jsonb_build_object('category','','columns',3,'limit',6,'variant','card'))
          ))
      )
    )
  );

  -- append preserved newsletter section
  IF v_newsletter IS NOT NULL AND v_newsletter->'children' IS NOT NULL THEN
    v_new_sections := v_new_sections || jsonb_build_array(v_newsletter);
  END IF;

  UPDATE public.pages
     SET builder_data = jsonb_build_object('version', 1, 'sections', v_new_sections),
         updated_at = now()
   WHERE slug='analizy';
END $$;
