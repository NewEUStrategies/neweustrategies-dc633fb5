import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NewsletterPopupTrigger = "delay" | "scroll" | "exit-intent";
export type NewsletterPopupLayout = "stacked" | "split";

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
}

export function defaultNewsletterSettings(): NewsletterSettings {
  return {
    tenant_id: "",
    heading_pl: "Zapisz się do newslettera",
    heading_en: "Subscribe to our Newsletter",
    description_pl: "Otrzymuj najnowsze artykuły prosto na swoją skrzynkę.",
    description_en: "Get the latest articles delivered to your inbox.",
    policy_html_pl: 'Zapisując się akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Możesz wypisać się w każdej chwili.',
    policy_html_en: 'By signing up, you agree to our <a href="/privacy-policy">Privacy Policy</a>. You may unsubscribe at any time.',
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
    popup_description_en: "Explore the behind-the-scenes of European strategies. Become a member of a unique community!",
    popup_cta_pl: "Zapisz się",
    popup_cta_en: "Subscribe",
    popup_layout: "stacked",
    popup_side_image_url: null,
    popup_extended_fields: false,
    popup_require_terms: false,
    popup_terms_html_pl: 'Akceptuję <a href="/regulamin">regulamin</a>.',
    popup_terms_html_en: 'I accept the <a href="/terms">terms &amp; conditions</a>.',
    popup_mailing_lists: [],
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
      return {
        ...def,
        ...(data as unknown as Partial<NewsletterSettings>),
        popup_mailing_lists: Array.isArray(lists) ? (lists as unknown as NewsletterMailingList[]) : [],
      };
    },
    staleTime: 60_000,
  });
}

export function useSaveNewsletterSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<NewsletterSettings>) => {
      const { data: existing } = await supabase.from("newsletter_settings").select("tenant_id").maybeSingle();
      const body = patch as unknown as Record<string, unknown>;
      const client = supabase as unknown as {
        from: (t: string) => {
          update: (b: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> };
          insert: (b: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      };
      if (existing) {
        const { error } = await client.from("newsletter_settings").update(body).eq("tenant_id", existing.tenant_id);
        if (error) throw error;
      } else {
        const { error } = await client.from("newsletter_settings").insert(body);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["newsletter-settings"] }),
  });
}
