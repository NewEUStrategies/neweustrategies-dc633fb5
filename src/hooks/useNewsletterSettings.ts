import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { NlDoc } from "@/lib/newsletter-builder/types";
import { resolvePopupFields, type PopupFieldConfig } from "@/lib/newsletter/popupFields";

type NewsletterPopupTrigger = "delay" | "scroll" | "exit-intent";
type NewsletterPopupLayout = "stacked" | "split" | "showcase";

/** Kafel galerii w wariancie popupu "showcase". */
export interface NewsletterShowcaseImage {
  url: string;
  caption_pl: string;
  caption_en: string;
}
export type NewsletterMode = "off" | "inline" | "popup" | "both";

export interface NewsletterMailingList {
  id: string;
  label_pl: string;
  label_en: string;
  [key: string]: string;
}

export interface NewsletterSettings {
  tenant_id: string;
  heading_pl: string;
  heading_en: string;
  description_pl: string;
  description_en: string;
  policy_html_pl: string | null;
  policy_html_en: string | null;
  success_message_pl: string;
  success_message_en: string;
  double_opt_in: boolean;
  enabled: boolean;
  // Popup
  popup_enabled: boolean;
  popup_trigger: NewsletterPopupTrigger;
  popup_delay_seconds: number;
  popup_scroll_percent: number;
  popup_frequency_days: number;
  popup_cover_url: string | null;
  popup_title_pl: string;
  popup_title_en: string;
  popup_description_pl: string;
  popup_description_en: string;
  popup_cta_pl: string;
  popup_cta_en: string;
  // Extended popup
  popup_layout: NewsletterPopupLayout;
  popup_side_image_url: string | null;
  popup_extended_fields: boolean;
  popup_require_terms: boolean;
  popup_terms_html_pl: string | null;
  popup_terms_html_en: string | null;
  popup_mailing_lists: NewsletterMailingList[];
  // Showcase layout (galeria + formularz)
  popup_showcase_images: NewsletterShowcaseImage[];
  popup_showcase_brand_pl: string;
  popup_showcase_brand_en: string;
  popup_showcase_tagline_pl: string;
  popup_showcase_tagline_en: string;
  popup_showcase_rotate_ms: number;
  popup_showcase_side: "left" | "right";
  popup_showcase_grad_from: string | null;
  popup_showcase_grad_to: string | null;
  popup_showcase_show_brand: boolean;
  popup_showcase_show_caption: boolean;
  popup_showcase_show_dots: boolean;
  // Konfiguracja pól formularza (prawa strona popupu) + notka i zgody
  popup_fields: PopupFieldConfig[];
  popup_note_pl: string | null;
  popup_note_en: string | null;
  popup_require_privacy: boolean;
  popup_privacy_html_pl: string | null;
  popup_privacy_html_en: string | null;
  // Style / branding
  popup_bg_color: string;
  popup_text_color: string;
  popup_muted_color: string;
  popup_accent_color: string;
  popup_accent_text_color: string;
  popup_overlay_color: string;
  popup_border_radius_px: number;
  popup_eyebrow_pl: string;
  popup_eyebrow_en: string;
  // Builder documents + globalne przelaczniki nowej wersji admin panelu.
  mode: NewsletterMode;
  inline_doc: NlDoc | null;
  popup_doc: NlDoc | null;
  sender_name: string | null;
  sender_email: string | null;
}

export function defaultNewsletterSettings(): NewsletterSettings {
  return {
    tenant_id: "",
    heading_pl: "Zapisz się do newslettera",
    heading_en: "Subscribe to our Newsletter",
    description_pl: "Otrzymuj najnowsze artykuły prosto na swoją skrzynkę.",
    description_en: "Get the latest articles delivered to your inbox.",
    policy_html_pl:
      'Zapisując się akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Możesz wypisać się w każdej chwili.',
    policy_html_en:
      'By signing up, you agree to our <a href="/privacy-policy">Privacy Policy</a>. You may unsubscribe at any time.',
    success_message_pl: "Dziękujemy! Sprawdź swoją skrzynkę.",
    success_message_en: "Thanks! Please check your inbox.",
    double_opt_in: false,
    enabled: true,
    popup_enabled: false,
    popup_trigger: "delay",
    popup_delay_seconds: 15,
    popup_scroll_percent: 50,
    popup_frequency_days: 7,
    popup_cover_url: null,
    popup_title_pl: "Dołącz do nas!",
    popup_title_en: "Join us!",
    popup_description_pl: "Poznaj kulisy europejskich strategii. Dołącz do unikalnej społeczności.",
    popup_description_en:
      "Explore the behind-the-scenes of European strategies. Become a member of a unique community!",
    popup_cta_pl: "Zapisz się",
    popup_cta_en: "Subscribe",
    popup_layout: "stacked",
    popup_side_image_url: null,
    popup_extended_fields: false,
    popup_require_terms: false,
    popup_terms_html_pl: 'Akceptuję <a href="/regulamin">regulamin</a>.',
    popup_terms_html_en: 'I accept the <a href="/terms">terms &amp; conditions</a>.',
    popup_mailing_lists: [],
    popup_showcase_images: [],
    popup_showcase_brand_pl: "Newsletter",
    popup_showcase_brand_en: "Newsletter",
    popup_showcase_tagline_pl: "Przestrzeń dla tych, którzy tworzą europejskie strategie.",
    popup_showcase_tagline_en: "A workspace for those who shape European strategies.",
    popup_showcase_rotate_ms: 2600,
    popup_showcase_side: "left",
    popup_showcase_grad_from: null,
    popup_showcase_grad_to: null,
    popup_showcase_show_brand: true,
    popup_showcase_show_caption: true,
    popup_showcase_show_dots: true,
    popup_fields: resolvePopupFields(null),
    popup_note_pl: "Zero spamu. Możesz się wypisać w każdej chwili.",
    popup_note_en: "Zero spam, unsubscribe at any time.",
    popup_require_privacy: true,
    popup_privacy_html_pl: null,
    popup_privacy_html_en: null,
    popup_bg_color: "#0a0a0a",
    popup_text_color: "#ffffff",
    popup_muted_color: "#b8b8b8",
    popup_accent_color: "#f97316",
    popup_accent_text_color: "#ffffff",
    popup_overlay_color: "rgba(0,0,0,0.7)",
    popup_border_radius_px: 16,
    popup_eyebrow_pl: "Newsletter",
    popup_eyebrow_en: "Newsletter",
    mode: "both",
    inline_doc: null,
    popup_doc: null,
    sender_name: null,
    sender_email: null,
  };
}

export function useNewsletterSettings() {
  return useQuery({
    queryKey: ["newsletter-settings"],
    queryFn: async (): Promise<NewsletterSettings> => {
      const { data, error } = await supabase.from("newsletter_settings").select("*").maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      const def = defaultNewsletterSettings();
      if (!data) return def;
      const row = data as Record<string, unknown>;
      const lists = row.popup_mailing_lists;
      const showcase = row.popup_showcase_images;
      return {
        ...def,
        ...(data as unknown as Partial<NewsletterSettings>),
        popup_mailing_lists: Array.isArray(lists)
          ? (lists as unknown as NewsletterMailingList[])
          : [],
        popup_showcase_images: Array.isArray(showcase)
          ? (showcase as unknown as NewsletterShowcaseImage[])
          : [],
        popup_fields: resolvePopupFields(row.popup_fields),
        popup_note_pl: typeof row.popup_note_pl === "string" ? row.popup_note_pl : def.popup_note_pl,
        popup_note_en: typeof row.popup_note_en === "string" ? row.popup_note_en : def.popup_note_en,
      };
    },
    staleTime: 60_000,
  });
}

export function useSaveNewsletterSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<NewsletterSettings>) => {
      const { data: existing } = await supabase
        .from("newsletter_settings")
        .select("tenant_id")
        .maybeSingle();
      const body = patch as unknown as Record<string, unknown>;
      const client = supabase as unknown as {
        from: (t: string) => {
          update: (b: Record<string, unknown>) => {
            eq: (c: string, v: string) => Promise<{ error: unknown }>;
          };
          insert: (b: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      };
      if (existing) {
        const { error } = await client
          .from("newsletter_settings")
          .update(body)
          .eq("tenant_id", existing.tenant_id);
        if (error) throw error;
      } else {
        const { error } = await client.from("newsletter_settings").insert(body);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["newsletter-settings"] }),
  });
}
