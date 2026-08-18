// Czyste reguły ZAPISU wpisu, wyniesione z `hooks/usePostEditorForm.ts`.
//
// Hook ma 530 linii i stał na 0% pokrycia, bo żeby dojść do którejkolwiek
// z tych reguł, test musiałby wpierw postawić router, react-query, sesję,
// klienta Supabase, i18n i toasty. Reguły są tymczasem czyste: to mapowanie
// formularza na payload i trzy rozstrzygnięcia po odpowiedzi serwera.
// Hook zostaje spinaczem stanu Reacta, te funkcje niosą kontrakt zapisu.
import { hasBlockingSeoIssues, type SeoIssue } from "@/lib/seo/validation";
import { isEditConflict } from "@/lib/content/saveConflict";
import { parseDisclosureError } from "@/lib/content/sponsored";
import type { PostForm } from "../types";

/**
 * Payload `fields` wysyłany do `updatePost`. Zbudowany z formularza, BEZ
 * różnicowania - serwer dostaje komplet kolumn przy każdym zapisie.
 *
 * Domyślne wartości nie są kosmetyką. `updatePost` waliduje wejście Zodem,
 * a kolumny tablicowe i flagi mają w bazie NOT NULL: przepuszczenie
 * `undefined` zamiast `[]` / `false` kończy się odrzuceniem całego zapisu,
 * a nie pominięciem jednego pola.
 */
export function buildPostPatch(snapshot: PostForm) {
  return {
    slug: snapshot.slug,
    status: snapshot.status,
    publish_at: snapshot.publish_at,
    editor: snapshot.editor,
    title_pl: snapshot.title_pl,
    title_en: snapshot.title_en,
    excerpt_pl: snapshot.excerpt_pl,
    excerpt_en: snapshot.excerpt_en,
    content_pl: snapshot.content_pl,
    content_en: snapshot.content_en,
    cover_image_url: snapshot.cover_image_url,
    audio_url_pl: snapshot.audio_url_pl,
    audio_url_en: snapshot.audio_url_en,
    tts_voice_pl: snapshot.tts_voice_pl,
    tts_voice_en: snapshot.tts_voice_en,
    read_minutes: snapshot.read_minutes,
    builder_data: snapshot.builder_data,
    blocks_data: snapshot.blocks_data as unknown as Record<string, unknown> | null,
    parent_page_id: snapshot.parent_page_id,
    post_format: snapshot.post_format,
    layout_overrides: snapshot.layout_overrides,
    takeaways_pl: snapshot.takeaways_pl ?? [],
    takeaways_en: snapshot.takeaways_en ?? [],
    takeaways_variant: snapshot.takeaways_variant ?? null,
    toc_override: snapshot.toc_override ?? null,
    custom_meta: snapshot.custom_meta ?? null,
    related_override: snapshot.related_override ?? null,
    seo_title_pl: snapshot.seo_title_pl,
    seo_title_en: snapshot.seo_title_en,
    seo_description_pl: snapshot.seo_description_pl,
    seo_description_en: snapshot.seo_description_en,
    seo_canonical_url: snapshot.seo_canonical_url,
    seo_noindex: snapshot.seo_noindex ?? false,
    seo_og_image_url: snapshot.seo_og_image_url,
    og_image_generated_url: snapshot.og_image_generated_url,
    organization_id: snapshot.organization_id,
    organization_name: snapshot.organization_name,
    organization_logo_url: snapshot.organization_logo_url,
    organization_website: snapshot.organization_website,
    is_sponsored: snapshot.is_sponsored ?? false,
    sponsored_kind: snapshot.sponsored_kind,
    sponsored_advertiser_name: snapshot.sponsored_advertiser_name,
    sponsored_advertiser_url: snapshot.sponsored_advertiser_url,
    sponsored_payer_name: snapshot.sponsored_payer_name,
    sponsored_note_pl: snapshot.sponsored_note_pl,
    sponsored_note_en: snapshot.sponsored_note_en,
    sponsored_affiliate: snapshot.sponsored_affiliate ?? false,
    sponsored_political: snapshot.sponsored_political ?? false,
    sponsored_political_process: snapshot.sponsored_political_process,
    sponsored_sponsor_controller: snapshot.sponsored_sponsor_controller,
    sponsored_order_ref: snapshot.sponsored_order_ref,
  };
}

/**
 * Kolumny, które NIGDY nie idą w payloadzie zapisu, choć siedzą w formularzu.
 * Lista jest jawna, bo każde z tych pól ma inny powód:
 *  - `id` i `updated_at` - identyfikator i baza optimistic-locka jadą osobnymi
 *    polami żądania (`id`, `baseUpdatedAt`), nie w `fields`,
 *  - `published_at` - niezmienny znacznik PIERWSZEJ publikacji; stempluje go
 *    wyłącznie serwer przy przejściu w `published` (patrz `isFirstPublish`).
 *    Przepuszczenie go z klienta pozwoliłoby cofnąć datę starego artykułu
 *    i przestawić kolejność w archiwum, RSS-ie i sitemapie,
 *  - `author_id` - autorzy mają własną ścieżkę zapisu (karta „Autorzy"),
 *  - `sponsored_marked_at` - znacznik PIERWSZEJ deklaracji komercyjnej,
 *    stemplowany przez serwer. Gdyby klient go odsyłał, KAŻDY autozapis
 *    przepisywałby datę deklaracji na „teraz" i ślad rozliczalności
 *    przestałby cokolwiek dowodzić (rozp. UE 2024/900 art. 12 ust. 4).
 */
export const NON_PATCHED_FORM_FIELDS = [
  "id",
  "updated_at",
  "published_at",
  "author_id",
  "sponsored_marked_at",
] as const satisfies readonly (keyof PostForm)[];

/**
 * Nowa baza optimistic-locka po odpowiedzi serwera.
 *
 * Gdy serwer nie odesłał `updatedAt`, baza ZOSTAJE bez zmian. Wyzerowanie jej
 * dawałoby fałszywy `EDIT_CONFLICT` przy następnym zapisie, a podstawienie
 * bieżącego czasu - odwrotnie: przepuszczałoby ciche nadpisanie cudzej pracy.
 */
export function nextBaseUpdatedAt(
  previous: string | null,
  result?: { updatedAt?: string | null } | null,
): string | null {
  return result?.updatedAt ?? previous;
}

export interface SlugOutcome {
  /** Slug faktycznie zapisany w bazie. */
  slug: string;
  /** Serwer znormalizował slug (kolizja) - trzeba to pokazać, nie przemilczeć. */
  collided: boolean;
  /** Trzeba przenieść trasę na zapisany slug. */
  mustNavigate: boolean;
}

/**
 * Rozstrzygnięcie slugu po zapisie.
 *
 * `uniqueSlug` na serwerze dopisuje sufiks przy kolizji, więc slug wpisany
 * w formularzu i slug zapisany mogą się różnić. Nawigacja MUSI iść na slug
 * ZAPISANY: przejście na slug z formularza załadowałoby CUDZY wpis, który go
 * posiada - z perspektywy redaktora edytor „podmieniłby" mu artykuł pod ręką.
 */
export function resolveSlugOutcome(
  requestedSlug: string,
  savedSlug: string | null | undefined,
  routeSlug: string,
): SlugOutcome {
  const slug = savedSlug ?? requestedSlug;
  return {
    slug,
    collided: slug !== requestedSlug,
    mustNavigate: slug !== routeSlug,
  };
}

export type SaveErrorDescriptor =
  { kind: "conflict" } | { kind: "disclosureGaps"; gaps: readonly string[] } | null;

/**
 * Klasyfikacja błędu zapisu na DESKRYPTOR, nie na gotowy komunikat - tekst
 * powstaje dopiero w warstwie widoku, bo tylko ona zna język panelu.
 *
 * Dwa rozpoznawane przypadki:
 *  - konflikt edycji (ktoś zapisał w międzyczasie),
 *  - odrzucona PUBLIKACJA niekompletnej deklaracji komercyjnej. Serwer
 *    odpowiada kodem, nie zdaniem, i wymienia BRAKUJĄCE pola - „zapis
 *    odrzucony" bez ich wskazania kazałoby redaktorowi zgadywać.
 *
 * `null` znaczy „nie umiem tego nazwać" - błąd leci dalej surowy, zamiast
 * zostać przykryty ogólnikiem.
 */
export function saveErrorDescriptor(err: unknown): SaveErrorDescriptor {
  if (isEditConflict(err)) return { kind: "conflict" };
  const gaps = parseDisclosureError(err);
  if (gaps.length > 0) return { kind: "disclosureGaps", gaps };
  return null;
}

export type SaveGateDecision =
  { kind: "blocked" } | { kind: "warn"; count: number } | { kind: "ok" };

/**
 * Bramka SEO przy JAWNYM zapisie („Zapisz”).
 *
 * `error` blokuje zapis (twarde przekroczenie limitu znaków), `warning` tylko
 * ostrzega o przycięciu w wynikach wyszukiwania.
 *
 * UWAGA DLA CZYTELNIKA: ta bramka stoi WYŁĄCZNIE na ścieżce „Zapisz”.
 * Ścieżki zmiany statusu („Publikuj", „Wyślij do recenzji", „Zatwierdź")
 * oraz autozapis jej NIE przechodzą - a publikacja jest operacją bardziej
 * doniosłą niż zapis roboczy. Funkcja utrwala stan ISTNIEJĄCY (zachowanie bez
 * zmian); czy asymetria jest zamierzona, to rozstrzygnięcie produktowe -
 * test poniżej przypina ją jawnie, żeby przestała być niewidoczna.
 */
export function seoSaveGate(issues: SeoIssue[]): SaveGateDecision {
  if (hasBlockingSeoIssues(issues)) return { kind: "blocked" };
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return warnings > 0 ? { kind: "warn", count: warnings } : { kind: "ok" };
}

/**
 * Czy wpis jest zaplanowany na termin, który już minął. Karta terminu pokazuje
 * wtedy ostrzeżenie: taki wpis czeka na przebieg `publish_due_posts()`, a nie
 * jest opublikowany, i bez tego sygnału wygląda jak zgubiony.
 */
export function isScheduledInPast(
  form: Pick<PostForm, "status" | "publish_at"> | null,
  nowMs: number,
): boolean {
  if (!form || form.status !== "scheduled" || !form.publish_at) return false;
  const at = new Date(form.publish_at).getTime();
  return !Number.isNaN(at) && at <= nowMs;
}
