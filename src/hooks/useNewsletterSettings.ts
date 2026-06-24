import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NewsletterPopupTrigger = "delay" | "scroll" | "exit-intent";

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
    popup_title_pl: "Zostań w kontakcie",
    popup_title_en: "Stay in touch",
    popup_description_pl: "Cotygodniowy przegląd najlepszych treści.",
    popup_description_en: "A weekly digest of the best stories.",
    popup_cta_pl: "Zapisz się",
    popup_cta_en: "Subscribe",
  };
}

export function useNewsletterSettings() {
  return useQuery({
    queryKey: ["newsletter-settings"],
    queryFn: async (): Promise<NewsletterSettings> => {
      const { data, error } = await supabase.from("newsletter_settings").select("*").maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data as NewsletterSettings | null) ?? defaultNewsletterSettings();
    },
    staleTime: 60_000,
  });
}

export function useSaveNewsletterSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<NewsletterSettings>) => {
      const { data: existing } = await supabase.from("newsletter_settings").select("tenant_id").maybeSingle();
      if (existing) {
        const { error } = await supabase.from("newsletter_settings").update(patch).eq("tenant_id", existing.tenant_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("newsletter_settings").insert(patch);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["newsletter-settings"] }),
  });
}
