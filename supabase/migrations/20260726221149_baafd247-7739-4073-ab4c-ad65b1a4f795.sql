UPDATE public.pages
SET builder_data = '{
  "version": 1,
  "sections": [
    {
      "id": "sec-title",
      "kind": "section",
      "layout": { "width": 1200, "contentWidth": "boxed" },
      "children": [
        {
          "id": "col-title",
          "kind": "column",
          "span": { "desktop": 12 },
          "children": [
            {
              "id": "w-h3-sup",
              "kind": "widget",
              "type": "heading",
              "content": {
                "tag": "h3",
                "align": "center",
                "text_en": "What would you like to",
                "text_pl": "W jakiej sprawie chcesz się",
                "variant": "muted",
                "sizePreset": "lg"
              }
            },
            {
              "id": "w-h1-main",
              "kind": "widget",
              "type": "heading",
              "content": {
                "tag": "h1",
                "align": "center",
                "text_en": "contact us about?",
                "text_pl": "z nami skontaktować?",
                "variant": "gradient",
                "sizePreset": "display"
              }
            }
          ]
        }
      ]
    },
    {
      "id": "sec-emails",
      "kind": "section",
      "layout": { "width": 1200, "contentWidth": "boxed" },
      "children": [
        {
          "id": "col-e1",
          "kind": "column",
          "span": { "desktop": 3 },
          "children": [
            {
              "id": "w-e1-div",
              "kind": "widget",
              "type": "divider",
              "content": { "color": "#f57c1f", "thickness": 2, "width": 100, "align": "center", "spacing": 8 }
            },
            {
              "id": "w-e1-t",
              "kind": "widget",
              "type": "heading",
              "content": {
                "tag": "h4",
                "align": "center",
                "text_en": "Media inquiries",
                "text_pl": "Zapytania do mediów",
                "variant": "default",
                "sizePreset": "md"
              }
            },
            {
              "id": "w-e1-l",
              "kind": "widget",
              "type": "button",
              "content": {
                "href": "mailto:media@neweuropeanstrategies.com",
                "align": "center",
                "label_pl": "media@neweuropeanstrategies.com",
                "label_en": "media@neweuropeanstrategies.com",
                "variant": "link",
                "size": "sm"
              }
            }
          ]
        },
        {
          "id": "col-e2",
          "kind": "column",
          "span": { "desktop": 3 },
          "children": [
            {
              "id": "w-e2-div",
              "kind": "widget",
              "type": "divider",
              "content": { "color": "#f57c1f", "thickness": 2, "width": 100, "align": "center", "spacing": 8 }
            },
            {
              "id": "w-e2-t",
              "kind": "widget",
              "type": "heading",
              "content": {
                "tag": "h4",
                "align": "center",
                "text_en": "Institutional cooperation",
                "text_pl": "Współpraca instytucjonalna",
                "variant": "default",
                "sizePreset": "md"
              }
            },
            {
              "id": "w-e2-l",
              "kind": "widget",
              "type": "button",
              "content": {
                "href": "mailto:partnership@neweuropeanstrategies.com",
                "align": "center",
                "label_pl": "partnership@neweuropeanstrategies.com",
                "label_en": "partnership@neweuropeanstrategies.com",
                "variant": "link",
                "size": "sm"
              }
            }
          ]
        },
        {
          "id": "col-e3",
          "kind": "column",
          "span": { "desktop": 3 },
          "children": [
            {
              "id": "w-e3-div",
              "kind": "widget",
              "type": "divider",
              "content": { "color": "#f57c1f", "thickness": 2, "width": 100, "align": "center", "spacing": 8 }
            },
            {
              "id": "w-e3-t",
              "kind": "widget",
              "type": "heading",
              "content": {
                "tag": "h4",
                "align": "center",
                "text_en": "Media patronage",
                "text_pl": "Patronaty medialne",
                "variant": "default",
                "sizePreset": "md"
              }
            },
            {
              "id": "w-e3-l",
              "kind": "widget",
              "type": "button",
              "content": {
                "href": "mailto:patronage@neweuropeanstrategies.com",
                "align": "center",
                "label_pl": "patronage@neweuropeanstrategies.com",
                "label_en": "patronage@neweuropeanstrategies.com",
                "variant": "link",
                "size": "sm"
              }
            }
          ]
        },
        {
          "id": "col-e4",
          "kind": "column",
          "span": { "desktop": 3 },
          "children": [
            {
              "id": "w-e4-div",
              "kind": "widget",
              "type": "divider",
              "content": { "color": "#f57c1f", "thickness": 2, "width": 100, "align": "center", "spacing": 8 }
            },
            {
              "id": "w-e4-t",
              "kind": "widget",
              "type": "heading",
              "content": {
                "tag": "h4",
                "align": "center",
                "text_en": "General inquiries",
                "text_pl": "Pytania ogólne",
                "variant": "default",
                "sizePreset": "md"
              }
            },
            {
              "id": "w-e4-l",
              "kind": "widget",
              "type": "button",
              "content": {
                "href": "mailto:inquiries@neweuropeanstrategies.com",
                "align": "center",
                "label_pl": "inquiries@neweuropeanstrategies.com",
                "label_en": "inquiries@neweuropeanstrategies.com",
                "variant": "link",
                "size": "sm"
              }
            }
          ]
        }
      ]
    },
    {
      "id": "sec-body",
      "kind": "section",
      "layout": { "width": 1200, "contentWidth": "boxed" },
      "children": [
        {
          "id": "col-form",
          "kind": "column",
          "span": { "desktop": 7 },
          "children": [
            {
              "id": "w-form-title",
              "kind": "widget",
              "type": "heading",
              "content": {
                "tag": "h4",
                "align": "left",
                "text_en": "Contact form",
                "text_pl": "Formularz kontaktowy",
                "variant": "default",
                "sizePreset": "md"
              }
            },
            {
              "id": "w-contact-form",
              "kind": "widget",
              "type": "contact-form",
              "content": {
                "variant": "plain",
                "showEmail": "1",
                "showMessage": "1",
                "showSubject": "1",
                "requireEmail": "1",
                "showLastName": "1",
                "showFirstName": "1",
                "requireMessage": "1",
                "requireSubject": "1",
                "requireLastName": "0",
                "requireFirstName": "1"
              }
            }
          ]
        },
        {
          "id": "col-side",
          "kind": "column",
          "span": { "desktop": 5 },
          "children": [
            {
              "id": "w-social-title",
              "kind": "widget",
              "type": "heading",
              "content": {
                "tag": "h4",
                "align": "left",
                "text_en": "Join our expert community",
                "text_pl": "Dołącz do społeczności eksperckiej",
                "variant": "default",
                "sizePreset": "md"
              }
            },
            {
              "id": "w-social",
              "kind": "widget",
              "type": "social-icons",
              "content": {
                "layout": "list",
                "x": "https://x.com/NewEUStrategies",
                "size": 20,
                "shape": "md",
                "bgMode": "none",
                "youtube": "https://www.youtube.com/c/HistorycznyAmbasador",
                "facebook": "https://www.facebook.com/NewEuropeanStrategies",
                "linkedin": "https://www.linkedin.com/company/new-european-strategies",
                "instagram": "https://www.instagram.com/neweuropeanstrategies/",
                "colorMode": "official",
                "showEmpty": "hide",
                "themeAdapt": "auto",
                "ctaFacebook": "Like",
                "ctaX": "Follow",
                "ctaYoutube": "Subscribe",
                "ctaInstagram": "Follow",
                "ctaLinkedin": "Follow"
              }
            },
            {
              "id": "w-newsletter",
              "kind": "widget",
              "type": "newsletter",
              "content": {}
            }
          ]
        }
      ]
    }
  ]
}'::jsonb,
updated_at = now()
WHERE slug = 'kontakt';