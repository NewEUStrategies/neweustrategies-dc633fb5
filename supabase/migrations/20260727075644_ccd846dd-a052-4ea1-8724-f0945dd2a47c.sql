UPDATE public.site_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{builder_data}',
  '{
    "version": 1,
    "sections": [
      {
        "id": "ftr-main",
        "kind": "section",
        "style": { "padding": { "desktop": "96px 24px 48px", "mobile": "56px 20px 32px" } },
        "layout": { "width": 1400, "htmlTag": "div", "contentWidth": "boxed", "gap": 48 },
        "children": [
          {
            "id": "ftr-col-brand",
            "kind": "column",
            "span": { "desktop": 5, "tablet": 12, "mobile": 12 },
            "children": [
              {
                "id": "ftr-logo",
                "kind": "widget",
                "type": "image",
                "content": {
                  "src": "https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/07167e87-2e0f-42e8-ac5e-72445a2d4b0a/17e16093-10a6-430c-8d80-2406bff8a15f/theme/logo/1782319297295-zx9she.svg",
                  "srcDark": "https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/07167e87-2e0f-42e8-ac5e-72445a2d4b0a/17e16093-10a6-430c-8d80-2406bff8a15f/theme/logo/1782319304300-bkjt7n.svg",
                  "href": "/",
                  "alt_pl": "New European Strategies",
                  "alt_en": "New European Strategies",
                  "maxWidth": "220px"
                }
              },
              {
                "id": "ftr-mission",
                "kind": "widget",
                "type": "text",
                "content": {
                  "html_pl": "<p style=\"max-width:420px;margin-top:20px;line-height:1.6;\">Niezależny think-tank kształtujący debatę o bezpieczeństwie, gospodarce i polityce zagranicznej Europy.</p>",
                  "html_en": "<p style=\"max-width:420px;margin-top:20px;line-height:1.6;\">An independent think-tank shaping the debate on European security, economy and foreign policy.</p>"
                }
              },
              {
                "id": "ftr-contact",
                "kind": "widget",
                "type": "text",
                "content": {
                  "html_pl": "<p style=\"margin-top:24px;line-height:1.8;font-size:0.875rem;\"><strong>E-mail:</strong> kontakt@neweustrategies.pl<br/><strong>Adres:</strong> ul. Marszałkowska 111, 00-102 Warszawa<br/><strong>NIP:</strong> 000-00-00-000 &nbsp; <strong>REGON:</strong> 000000000 &nbsp; <strong>KRS:</strong> 0000000000</p>",
                  "html_en": "<p style=\"margin-top:24px;line-height:1.8;font-size:0.875rem;\"><strong>Email:</strong> kontakt@neweustrategies.pl<br/><strong>Address:</strong> ul. Marszałkowska 111, 00-102 Warsaw, Poland<br/><strong>Tax ID (NIP):</strong> 000-00-00-000 &nbsp; <strong>REGON:</strong> 000000000 &nbsp; <strong>KRS:</strong> 0000000000</p>"
                }
              },
              {
                "id": "ftr-social",
                "kind": "widget",
                "type": "social-icons",
                "content": {
                  "size": 18,
                  "email": "kontakt@neweustrategies.pl",
                  "facebook": "https://facebook.com/neweuropeanstrategies",
                  "twitter": "https://twitter.com/",
                  "youtube": "https://youtube.com/",
                  "instagram": "https://instagram.com/",
                  "linkedin": "https://linkedin.com/",
                  "spotify": "https://spotify.com/"
                }
              }
            ]
          },
          {
            "id": "ftr-col-know",
            "kind": "column",
            "span": { "desktop": 3, "tablet": 6, "mobile": 12 },
            "children": [
              { "id": "ftr-know-h", "kind": "widget", "type": "heading",
                "content": { "tag": "h4", "text_pl": "Poznaj nas lepiej", "text_en": "Know us better" } },
              { "id": "ftr-know-1", "kind": "widget", "type": "nav-link",
                "content": { "href": "/o-nas", "variant": "text", "label_pl": "O nas", "label_en": "About us" } },
              { "id": "ftr-know-2", "kind": "widget", "type": "nav-link",
                "content": { "href": "/kontakt", "variant": "text", "label_pl": "Kontakt", "label_en": "Contact" } },
              { "id": "ftr-know-3", "kind": "widget", "type": "nav-link",
                "content": { "href": "/dolacz-do-newslettera", "variant": "text", "label_pl": "Dołącz do newslettera", "label_en": "Join the newsletter" } },
              { "id": "ftr-know-4", "kind": "widget", "type": "nav-link",
                "content": { "href": "/wspieraj-nas", "variant": "text", "label_pl": "Wspieraj nas", "label_en": "Support us" } }
            ]
          },
          {
            "id": "ftr-col-work",
            "kind": "column",
            "span": { "desktop": 4, "tablet": 6, "mobile": 12 },
            "children": [
              { "id": "ftr-work-h", "kind": "widget", "type": "heading",
                "content": { "tag": "h4", "text_pl": "Współpraca", "text_en": "Work with us" } },
              { "id": "ftr-work-1", "kind": "widget", "type": "nav-link",
                "content": { "href": "/reklamuj-sie-u-nas", "variant": "text", "label_pl": "Reklamuj się u nas", "label_en": "Advertise with us" } },
              { "id": "ftr-work-2", "kind": "widget", "type": "nav-link",
                "content": { "href": "/wydarzenia", "variant": "text", "label_pl": "Wydarzenia", "label_en": "Events" } },
              { "id": "ftr-work-3", "kind": "widget", "type": "nav-link",
                "content": { "href": "/programs", "variant": "text", "label_pl": "Projekty i programy", "label_en": "Projects & programs" } },
              { "id": "ftr-work-4", "kind": "widget", "type": "nav-link",
                "content": { "href": "/polityka-prywatnosci", "variant": "text", "label_pl": "Polityka prywatności", "label_en": "Privacy policy" } }
            ]
          }
        ]
      },
      {
        "id": "ftr-copy",
        "kind": "section",
        "style": { "padding": { "desktop": "24px", "mobile": "20px" } },
        "layout": { "width": 1400, "htmlTag": "div", "contentWidth": "boxed" },
        "children": [
          {
            "id": "ftr-copy-col",
            "kind": "column",
            "span": { "desktop": 12 },
            "children": [
              {
                "id": "ftr-copy-w",
                "kind": "widget",
                "type": "copyright",
                "content": {
                  "text_pl": "Wszelkie prawa zastrzeżone.",
                  "text_en": "All rights reserved.",
                  "showYear": true,
                  "brand": "New European Strategies"
                }
              }
            ]
          }
        ]
      }
    ]
  }'::jsonb,
  true
),
updated_at = now()
WHERE key = 'footer';

-- Update chrome copy to think-tank tone (larger vertical rhythm handled by section padding above).
UPDATE public.site_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{chrome}',
  COALESCE(value->'chrome', '{}'::jsonb) || jsonb_build_object(
    'copyright_pl', '© {year} New European Strategies · Niezależny think-tank',
    'copyright_en', '© {year} New European Strategies · Independent think-tank',
    'show_year', true,
    'show_separator', true,
    'layout', 'default',
    'back_to_top', true
  ),
  true
)
WHERE key = 'footer';