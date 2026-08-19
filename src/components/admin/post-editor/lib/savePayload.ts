// Czyste reguły ZAPISU wpisu, wyjęte 1:1 z `usePostEditorForm` (zachowanie bez
// zmian). Trzy z nich decydują o tym, czy praca redaktora w ogóle dojdzie do
// bazy, a żadnej nie dało się wywołać z testu, dopóki siedziały wewnątrz hooka:
//
//   * `buildPostUpdateFields` - mapa 53 kolumn wysyłanych przy każdym zapisie.
//     Pole, które z niej wypadnie, przestaje się zapisywać CICHO: formularz
//     pokazuje wartość, autosave raportuje sukces, a kolumna w bazie zostaje
//     stara. Repo już raz zapłaciło za tę klasę defektu (K10: zmiana koloru
//     kategorii kasowała opisy PL/EN, bo ekran wysyłał kolumny, których nie
//     wczytywał). Tutaj ryzyko jest odwrotne i równie ciche.
//   * `replaceFormImageUrls` - musi ZWRÓCIĆ TĘ SAMĄ REFERENCJĘ, gdy nie ma
//     żadnego trafienia. Nowy obiekt oznaczałby zmianę stanu formularza, a ta
//     wyzwala kolejny autosave - i tak w pętli.
//   * `nextOptimisticBase` - baza optimistic-locka. Za stara wartość powoduje
//     fałszywy EDIT_CONFLICT przy następnym zapisie.
import { replaceDataUrlImages } from "@/lib/blocks/persistImages";
import type { PostForm } from "../types";

/**
 * Kolumny wysyłane do `updatePost` przy każdym zapisie (autosave i jawnym).
 *
 * Świadomie NIEOBECNE: `published_at` i `sponsored_marked_at` są stemplowane
 * przez serwer i tylko do odczytu - odesłanie ich przepisywałoby datę pierwszej
 * publikacji i ślad rozliczalności deklaracji komercyjnej przy każdym autozapisie.
 * `updated_at` też nie jest wysyłane: klient przekazuje je osobno jako
 * `baseUpdatedAt` (optimistic-lock), nie jako wartość do zapisania.
 */
export function buildPostUpdateFields(snapshot: PostForm) {
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

/** Nazwy kolumn wysyłanych przy zapisie - kontrakt dla testu kompletności. */
export type PostUpdateFieldName = keyof ReturnType<typeof buildPostUpdateFields>;

/**
 * Nakłada na migawkę dokumenty po wgraniu wklejonych grafik. Podmienia TYLKO
 * te, które faktycznie się zmieniły - migawka bez trafień zostaje tą samą
 * referencją, więc zapis nie generuje sztucznej różnicy.
 */
export function applyPersistedImages(
  snapshot: PostForm,
  blocks: { doc: PostForm["blocks_data"]; changed: boolean },
  builder: { doc: PostForm["builder_data"]; changed: boolean },
): PostForm {
  let next = snapshot;
  if (blocks.changed) next = { ...next, blocks_data: blocks.doc };
  if (builder.changed) next = { ...next, builder_data: builder.doc };
  return next;
}

/**
 * Przepisuje adresy grafik (dataUrl -> URL storage) w BIEŻĄCYM stanie
 * formularza, który mógł już zawierać nowsze zmiany tekstu niż zapisywana
 * migawka.
 *
 * ZWRACA TĘ SAMĄ REFERENCJĘ, gdy żaden dokument się nie zmienił. To nie
 * mikrooptymalizacja: nowy obiekt formularza to dla autosave'u nowa wartość,
 * więc niezmieniony formularz uruchamiałby kolejny zapis, ten kolejny znowu
 * wołałby tę funkcję - i edytor zapisywałby w kółko.
 */
export function replaceFormImageUrls(
  form: PostForm | null,
  replacements: Map<string, string>,
): PostForm | null {
  if (!form) return form;
  const blocksJson = form.blocks_data;
  const builderJson = form.builder_data;
  const nextBlocks = blocksJson ? replaceDataUrlImages(blocksJson, replacements) : blocksJson;
  const nextBuilder = builderJson ? replaceDataUrlImages(builderJson, replacements) : builderJson;
  if (nextBlocks === blocksJson && nextBuilder === builderJson) return form;
  return { ...form, blocks_data: nextBlocks, builder_data: nextBuilder };
}

/**
 * Przesuwa bazę optimistic-locka na `updated_at` faktycznie zapisany przez
 * serwer. Brak wartości w odpowiedzi ZOSTAWIA dotychczasową bazę - wyzerowanie
 * jej kazałoby serwerowi odrzucić następny zapis jako konflikt.
 */
export function nextOptimisticBase(
  savedUpdatedAt: string | null | undefined,
  currentBase: string | null,
): string | null {
  return savedUpdatedAt ?? currentBase;
}
