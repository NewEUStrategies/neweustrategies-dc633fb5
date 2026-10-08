import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import type { NlDoc } from "@/lib/newsletter-builder/types";
import {
  resolvePopupFields,
  type PopupFieldConfig,
  type PopupFieldKey,
} from "@/lib/newsletter/popupFields";
import { defaultPopupDesign, type PopupDesign } from "@/lib/newsletter/popupDesign";

type NewsletterPopupTrigger = "delay" | "scroll" | "exit-intent";
type NewsletterPopupLayout = "stacked" | "split" | "showcase";

/** Kafel galerii w wariancie popupu "showcase". */
export interface NewsletterShowcaseImage {
  url: string;
  caption_pl: string;
  caption_en: string;
  /** Tytul kafla (opcjonalny, renderowany pod opisem). */
  title_pl?: string;
  title_en?: string;
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
  /** Warstwa prezentacji popupu rejestracji - paleta jasna, siatka, układ. */
  popup_design: PopupDesign;
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
    popup_title_pl: "Załóż konto",
    popup_title_en: "Create an account",
    popup_description_pl: "Poznaj kulisy europejskich strategii. Dołącz do unikalnej społeczności.",
    popup_description_en:
      "Explore the behind-the-scenes of European strategies. Become a member of a unique community!",
    popup_cta_pl: "Załóż konto",
    popup_cta_en: "Create account",
    popup_layout: "stacked",
    popup_side_image_url: null,
    popup_extended_fields: false,
    popup_require_terms: false,
    popup_terms_html_pl: 'Akceptuję <a href="/regulamin">regulamin</a>.',
    popup_terms_html_en: 'I accept the <a href="/terms">terms &amp; conditions</a>.',
    popup_mailing_lists: [],
    popup_showcase_images: [],
    // Puste = w galerii zostaje samo logo (poziome, z menu admina).
    popup_showcase_brand_pl: "",
    popup_showcase_brand_en: "",
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
    popup_design: defaultPopupDesign(),
    popup_note_pl: "Zakładając konto potwierdzasz adres e-mail. Zero spamu.",
    popup_note_en: "Creating an account confirms your e-mail. Zero spam.",
    popup_require_privacy: true,
    popup_privacy_html_pl: null,
    popup_privacy_html_en: null,
    // Domyślna paleta ciemna zgodna z marką: --brand (#FA9346) jako akcent,
    // ciemny atrament na akcencie (WCAG AA na pomarańczu), głębsze tło niż
    // czysta czerń i jaśniejszy tekst pomocniczy (kontrast > 7:1).
    popup_bg_color: "#0b0b0f",
    popup_text_color: "#ffffff",
    popup_muted_color: "#a8a8b3",
    popup_accent_color: "#FA9346",
    popup_accent_text_color: "#141414",
    popup_overlay_color: "rgba(8,8,12,0.72)",
    popup_border_radius_px: 6,
    popup_eyebrow_pl: "Newsletter",
    popup_eyebrow_en: "Newsletter",
    mode: "both",
    inline_doc: null,
    popup_doc: null,
    sender_name: null,
    sender_email: null,
  };
}

/**
 * Ciała odczytu i zapisu wiersza `newsletter_settings` (scalenie z domyślnymi,
 * dedup lotu, zapis z panelu) żyją w `newsletterSettingsData.ts`, ładowanym
 * LENIWIE (P3.8): ten moduł jedzie w chunku wejściowym przez rejestr prefetchu
 * widgetów, a przeglądarka sięga po te ciała dopiero przy pierwszym pobraniu
 * (odświeżenie przy zatrzasku interakcji/ciszy, popup, nawigacja SPA) albo
 * zapisie. Serwer (rozgrzewka SSR) ładuje ten sam moduł tak samo.
 */
const settingsData = () => import("./newsletterSettingsData");

/**
 * Fabryka zapytania o ustawienia newslettera - JEDNO źródło klucza dla hooka
 * i dla SSR-owego prefetchu widgetu (`lib/builder/prefetch`). Bez rozgrzania
 * formularz wychodził z serwera pusty (komponent zwraca `null`, dopóki
 * ustawienia się nie wczytają), więc czytelnik i crawler widzieli pustą kolumnę.
 *
 * PEŁNY kształt - czytają go popup rejestracji, panel admina i
 * `registrationFields` (`popup_fields` dla `AuthPortal`/`ClubAccessGate`).
 */
export function newsletterSettingsQueryOptions() {
  return queryOptions({
    queryKey: ["newsletter-settings"] as const,
    queryFn: () => settingsData().then((data) => data.fetchNewsletterSettings()),
    staleTime: 60_000,
  });
}

export function useNewsletterSettings() {
  return useQuery(newsletterSettingsQueryOptions());
}

/**
 * Etykieta pola rejestracji w kształcie, z którego `buildRegistrationFieldsApi`
 * (`registrationFields.ts`) liczy `label()` - tylko klucz i dwie etykiety, bez
 * `enabled`/`required`/placeholderów, których formularze inline nie czytają.
 */
export type NewsletterFieldLabelRow = Pick<PopupFieldConfig, "key" | "label_pl" | "label_en">;

/**
 * Pola rejestracji, których etykiety czytają formularze inline (mapa
 * `REGISTRATION_KEY` w `newsletterFieldLabels.ts` jest typowana tym zbiorem,
 * więc mapowanie na pole spoza projekcji nie przejdzie typechecku). Hasło,
 * powtórzenie hasła, lista i zgoda newslettera to pola popupu/rejestracji -
 * w stanie odwodnionym formularza inline byłyby martwym balastem.
 */
export const NEWSLETTER_INLINE_LABEL_KEYS = [
  "first_name",
  "last_name",
  "email",
  "job",
  "linkedin",
  "phone",
  "company",
] as const satisfies readonly PopupFieldKey[];
export type NewsletterInlineLabelKey = (typeof NEWSLETTER_INLINE_LABEL_KEYS)[number];
const INLINE_LABEL_KEYS: ReadonlySet<PopupFieldKey> = new Set(NEWSLETTER_INLINE_LABEL_KEYS);

/**
 * Ustawienia czytane przez formularze INLINE: `NewsletterForm` (tryb, zgoda,
 * nagłówek, opis, komunikat sukcesu, `inline_doc`), `NewsletterDocRenderer`
 * (te same teksty + listy mailingowe dokumentu inline) i `JoinUsForm`
 * (włącznik, nagłówek, opis). Listy mailingowe jadą WYŁĄCZNIE razem z
 * `inline_doc` - bez dokumentu nikt ich w formularzu nie renderuje.
 *
 * `field_labels`: etykiety pól liczone dotąd z `popup_fields` pełnego klucza
 * (`useNewsletterFieldLabels` -> `useRegistrationFields`); formularze inline
 * liczą je z projekcji (`useNewsletterFieldLabelsFrom`). Projekcja niesie
 * wyłącznie klucz i dwie etykiety pól z `NEWSLETTER_INLINE_LABEL_KEYS` (nazwa
 * pola odróżnia je od kolumny popupu) - bez nich formularz inline musiałby
 * czytać PEŁNY klucz w pierwszym renderze.
 */
export type NewsletterInlineSettings = Pick<
  NewsletterSettings,
  | "enabled"
  | "mode"
  | "inline_doc"
  | "heading_pl"
  | "heading_en"
  | "description_pl"
  | "description_en"
  | "policy_html_pl"
  | "policy_html_en"
  | "success_message_pl"
  | "success_message_en"
> &
  Partial<Pick<NewsletterSettings, "popup_mailing_lists">> & {
    field_labels: NewsletterFieldLabelRow[];
  };

/**
 * Pola czytane przez `NewsletterDocRenderer` - spełnia je i projekcja inline,
 * i pełny wiersz (popup renderuje ten sam dokumentowy formularz).
 */
export type NewsletterDocSettings = Omit<NewsletterInlineSettings, "field_labels">;

/**
 * DIETA STANU ODWODNIONEGO (P2.5, HW-3c): projekcja ustawień newslettera dla
 * formularza inline. Pełny wiersz (`popup_doc`, `popup_fields`,
 * `popup_design`, galeria, paleta popupu...) to ~8,9 KB surowych bajtów w
 * strumieniu stanu każdej strony z formularzem, a popup czyta go dopiero po
 * ~15 s, poza oknem pomiaru. Klucz `["newsletter-settings", "inline"]` leży
 * pod prefiksem pełnego, więc zapis w adminie (`useSaveNewsletterSettings`)
 * unieważnia oba wpisy.
 */
export function projectNewsletterInlineSettings(s: NewsletterSettings): NewsletterInlineSettings {
  const out: NewsletterInlineSettings = {
    enabled: s.enabled,
    mode: s.mode,
    inline_doc: s.inline_doc,
    heading_pl: s.heading_pl,
    heading_en: s.heading_en,
    description_pl: s.description_pl,
    description_en: s.description_en,
    policy_html_pl: s.policy_html_pl,
    policy_html_en: s.policy_html_en,
    success_message_pl: s.success_message_pl,
    success_message_en: s.success_message_en,
    field_labels: s.popup_fields
      .filter((f) => INLINE_LABEL_KEYS.has(f.key))
      .map(({ key, label_pl, label_en }) => ({ key, label_pl, label_en })),
  };
  if (s.inline_doc) out.popup_mailing_lists = s.popup_mailing_lists;
  return out;
}

/**
 * Zapytanie formularza inline (projekcja w `queryFn`: SSR, hydratacja i
 * refetch mają ten sam kształt). Popup, admin i `registrationFields` zostają
 * na pełnym `newsletterSettingsQueryOptions`.
 *
 * Odbiorcy: `NewsletterForm` i `JoinUsForm` (także etykiety pól -
 * `useNewsletterFieldLabelsFrom(field_labels)`, nie `useNewsletterFieldLabels`,
 * który czyta pełny klucz) oraz rejestr prefetchu widgetów `newsletter` i
 * `join-us` (`lib/builder/prefetch.ts`) - SSR grzeje dokładnie ten klucz.
 */
export function newsletterInlineSettingsQueryOptions() {
  return queryOptions({
    queryKey: ["newsletter-settings", "inline"] as const,
    queryFn: () => settingsData().then((data) => data.fetchNewsletterInlineSettings()),
    staleTime: 60_000,
  });
}

export function useNewsletterInlineSettings() {
  return useQuery(newsletterInlineSettingsQueryOptions());
}

export function useSaveNewsletterSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NewsletterSettings>) =>
      settingsData().then((data) => data.saveNewsletterSettings(patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["newsletter-settings"] }),
  });
}
