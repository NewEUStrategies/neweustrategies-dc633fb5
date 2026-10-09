// Odczyt i zapis wiersza `newsletter_settings` - moduł ładowany LENIWIE
// (P3.8, zamknięcie bootu).
//
// PO CO OSOBNY MODUŁ. `useNewsletterSettings.ts` jedzie w chunku wejściowym
// (rejestr prefetchu widgetów `lib/builder/prefetch.ts` grzeje klucz formularza
// inline), więc każde ciało, które tam leży, płaci każdy pierwszy widok każdej
// strony. Przeglądarka nie potrzebuje go jednak w boocie: formularz inline
// przychodzi z danymi z SSR (odświeżenie dopiero przy zatrzasku interakcji/
// ciszy - `router.tsx`), popup montuje się przy tym samym zatrzasku, a zapis
// jest wyłącznie w panelu. Fabryki zapytań i hook zapisu zostają tam, gdzie
// były (te same klucze, ten sam publiczny interfejs), a do tego modułu sięgają
// importem dynamicznym w `queryFn`/`mutationFn`.
//
// Import statyczny działa tylko w jedną stronę: stąd do `useNewsletterSettings`
// (domyślne, projekcja, typy - i tak są w boocie). Odwrotny kierunek byłby
// krawędzią statyczną z chunku wejściowego i wciągnąłby ten moduł z powrotem.
import { supabase } from "@/integrations/supabase/client";
import { resolvePopupFields } from "@/lib/newsletter/popupFields";
import { resolvePopupDesign } from "@/lib/newsletter/popupDesign";
import {
  defaultNewsletterSettings,
  projectNewsletterInlineSettings,
  type NewsletterInlineSettings,
  type NewsletterMailingList,
  type NewsletterSettings,
  type NewsletterShowcaseImage,
} from "./useNewsletterSettings";

let inflight: Promise<NewsletterSettings> | null = null;

/**
 * Odczyt wiersza scalonego z wartościami domyślnymi - wspólne ciało pełnego
 * zapytania i projekcji formularza inline.
 *
 * DEDUP W LOCIE (P3.8 #7, wzorzec `fetchSiteDesignTokensRow`). Pełny klucz
 * (popup) i projekcja (formularz inline) czytają TEN SAM wiersz tym samym
 * URL-em; gdy oba odświeżają się naraz (np. przy otwarciu zatrzasku
 * interakcji/ciszy), szły dwa identyczne GET-y. W przeglądarce równoległe
 * wywołania dzielą jeden lot; serwer obsługuje wielu najemców jednym modułem,
 * więc tam dedupu nie ma. Lot zakończony nie zwalnia miejsca cudzemu lotowi
 * (porównanie tożsamości), a zapis w panelu odcina lot sprzed zapisu
 * (`saveNewsletterSettings`).
 */
export function fetchNewsletterSettings(): Promise<NewsletterSettings> {
  if (typeof window === "undefined") return loadNewsletterSettings();
  if (!inflight) {
    const flight = loadNewsletterSettings().finally(() => {
      if (inflight === flight) inflight = null;
    });
    inflight = flight;
  }
  return inflight;
}

/** Projekcja formularza inline z tego samego (współdzielonego) odczytu. */
export async function fetchNewsletterInlineSettings(): Promise<NewsletterInlineSettings> {
  return projectNewsletterInlineSettings(await fetchNewsletterSettings());
}

async function loadNewsletterSettings(): Promise<NewsletterSettings> {
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
    popup_mailing_lists: Array.isArray(lists) ? (lists as unknown as NewsletterMailingList[]) : [],
    popup_showcase_images: Array.isArray(showcase)
      ? (showcase as unknown as NewsletterShowcaseImage[])
      : [],
    popup_fields: resolvePopupFields(row.popup_fields),
    popup_design: resolvePopupDesign(row.popup_design),
    popup_note_pl: typeof row.popup_note_pl === "string" ? row.popup_note_pl : def.popup_note_pl,
    popup_note_en: typeof row.popup_note_en === "string" ? row.popup_note_en : def.popup_note_en,
  };
}

/**
 * Zapis ustawień z panelu (ciało `useSaveNewsletterSettings`). Po udanym
 * zapisie lot odczytu rozpoczęty PRZED nim nie może już obsłużyć odświeżenia
 * po inwalidacji (recenzja P3.8, m4): dołączenie do niego zapisałoby w cache'u
 * ustawienia sprzed zapisu na cały `staleTime`.
 */
export async function saveNewsletterSettings(patch: Partial<NewsletterSettings>): Promise<void> {
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
  inflight = null;
}
