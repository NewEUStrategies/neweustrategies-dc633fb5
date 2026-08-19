// Czyste reguły ZAPISU wpisu. Do 18.08 wszystkie cztery siedziały w środku
// `usePostEditorForm` (530 linii, 0 z 36 funkcji wywołanych w teście) i nie było
// jak ich sprawdzić bez renderowania całego edytora z routerem i klientem
// Supabase.
import { describe, expect, it } from "vitest";
import {
  applyPersistedImages,
  buildPostUpdateFields,
  nextOptimisticBase,
  replaceFormImageUrls,
  type PostUpdateFieldName,
} from "../savePayload";
import type { PostForm } from "../../types";

/** Kompletny formularz - wszystkie pola jawnie, bez „reszta zostanie domyślna". */
function form(overrides: Partial<PostForm> = {}): PostForm {
  return {
    id: "post-1",
    slug: "moj-wpis",
    updated_at: "2026-08-18T10:00:00.000Z",
    status: "draft",
    author_id: "author-1",
    editor: "blocks",
    title_pl: "Tytuł",
    title_en: "Title",
    excerpt_pl: "Zajawka",
    excerpt_en: "Excerpt",
    content_pl: "<p>Treść</p>",
    content_en: "<p>Body</p>",
    cover_image_url: "https://example.com/cover.jpg",
    audio_url_pl: null,
    audio_url_en: null,
    tts_voice_pl: null,
    tts_voice_en: null,
    read_minutes: 5,
    published_at: "2026-08-01T00:00:00.000Z",
    publish_at: null,
    builder_data: null,
    blocks_data: null,
    parent_page_id: "",
    post_format: "standard",
    layout_overrides: null,
    takeaways_pl: ["a", "b", "c"],
    takeaways_en: ["a", "b", "c"],
    takeaways_variant: "card",
    toc_override: null,
    custom_meta: null,
    related_override: null,
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: false,
    seo_og_image_url: null,
    og_image_generated_url: null,
    organization_id: null,
    organization_name: null,
    organization_logo_url: null,
    organization_website: null,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_advertiser_name: null,
    sponsored_advertiser_url: null,
    sponsored_payer_name: null,
    sponsored_note_pl: null,
    sponsored_note_en: null,
    sponsored_affiliate: false,
    sponsored_political: false,
    sponsored_political_process: null,
    sponsored_sponsor_controller: null,
    sponsored_order_ref: null,
    sponsored_marked_at: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildPostUpdateFields - kompletność mapy zapisu", () => {
  it("wysyła DOKŁADNIE te 51 kolumn (lista jest kontraktem, nie opisem)", () => {
    // Ta lista jest jawna i posortowana CELOWO. Pole, które wypadnie z mapy
    // zapisu, przestaje się zapisywać CICHO: formularz nadal pokazuje wartość,
    // autosave nadal raportuje sukces, a kolumna w bazie zostaje stara. Bez tej
    // asercji taką regresję zauważyłby dopiero redaktor - po utracie pracy.
    const expected: PostUpdateFieldName[] = [
      "audio_url_en",
      "audio_url_pl",
      "blocks_data",
      "builder_data",
      "content_en",
      "content_pl",
      "cover_image_url",
      "custom_meta",
      "editor",
      "excerpt_en",
      "excerpt_pl",
      "is_sponsored",
      "layout_overrides",
      "og_image_generated_url",
      "organization_id",
      "organization_logo_url",
      "organization_name",
      "organization_website",
      "parent_page_id",
      "post_format",
      "publish_at",
      "read_minutes",
      "related_override",
      "seo_canonical_url",
      "seo_description_en",
      "seo_description_pl",
      "seo_noindex",
      "seo_og_image_url",
      "seo_title_en",
      "seo_title_pl",
      "slug",
      "sponsored_advertiser_name",
      "sponsored_advertiser_url",
      "sponsored_affiliate",
      "sponsored_kind",
      "sponsored_note_en",
      "sponsored_note_pl",
      "sponsored_order_ref",
      "sponsored_payer_name",
      "sponsored_political",
      "sponsored_political_process",
      "sponsored_sponsor_controller",
      "status",
      "takeaways_en",
      "takeaways_pl",
      "takeaways_variant",
      "title_en",
      "title_pl",
      "toc_override",
      "tts_voice_en",
      "tts_voice_pl",
    ];
    expect(Object.keys(buildPostUpdateFields(form())).sort()).toEqual(expected);
  });

  it("NIE wysyła pól stemplowanych przez serwer", () => {
    const fields = buildPostUpdateFields(form()) as Record<string, unknown>;
    // `published_at`: odesłanie przepisywałoby datę pierwszej publikacji przy
    // każdym autozapisie, więc artykuł skakałby na górę archiwum i feedów.
    expect(fields).not.toHaveProperty("published_at");
    // `sponsored_marked_at`: to ŚLAD ROZLICZALNOŚCI deklaracji komercyjnej -
    // przepisywany na „teraz" przestałby cokolwiek dowodzić.
    expect(fields).not.toHaveProperty("sponsored_marked_at");
    // `updated_at` jedzie osobno jako `baseUpdatedAt` (optimistic-lock), nie
    // jako wartość do zapisania.
    expect(fields).not.toHaveProperty("updated_at");
    // `id` jest w payloadzie obok `fields`, nie w środku.
    expect(fields).not.toHaveProperty("id");
    // `author_id`: karta „Autorzy" zapisuje listę autorów osobną ścieżką.
    expect(fields).not.toHaveProperty("author_id");
  });

  it("przepisuje wartości bez zmian tam, gdzie nie ma domyślnej", () => {
    const fields = buildPostUpdateFields(
      form({
        slug: "inny-slug",
        status: "pending_review",
        title_pl: "Nowy tytuł",
        read_minutes: 12,
        publish_at: "2026-09-01T08:00:00.000Z",
      }),
    );
    expect(fields).toMatchObject({
      slug: "inny-slug",
      status: "pending_review",
      title_pl: "Nowy tytuł",
      read_minutes: 12,
      publish_at: "2026-09-01T08:00:00.000Z",
    });
  });

  it("null/undefined w polach z domyślną wartością nie leci do bazy jako null", () => {
    // Kolumny tablicowe i boolowskie mają w bazie NOT NULL DEFAULT; wysłanie
    // `null` byłoby naruszeniem ograniczenia, więc zapis padłby w całości.
    const fields = buildPostUpdateFields(
      form({
        takeaways_pl: undefined as unknown as string[],
        takeaways_en: undefined as unknown as string[],
        seo_noindex: undefined as unknown as boolean,
        is_sponsored: undefined as unknown as boolean,
        sponsored_affiliate: undefined as unknown as boolean,
        sponsored_political: undefined as unknown as boolean,
      }),
    );
    expect(fields.takeaways_pl).toEqual([]);
    expect(fields.takeaways_en).toEqual([]);
    expect(fields.seo_noindex).toBe(false);
    expect(fields.is_sponsored).toBe(false);
    expect(fields.sponsored_affiliate).toBe(false);
    expect(fields.sponsored_political).toBe(false);
  });

  it("pola nullowalne z `?? null` zachowują null zamiast undefined", () => {
    // `undefined` w JSON-ie zapisu ZNIKA z ładunku, więc kolumna nie zostałaby
    // wyczyszczona, mimo że redaktor skasował wartość w formularzu.
    const fields = buildPostUpdateFields(
      form({
        takeaways_variant: undefined as unknown as null,
        toc_override: undefined as unknown as null,
        custom_meta: undefined as unknown as null,
        related_override: undefined as unknown as null,
      }),
    );
    expect(fields.takeaways_variant).toBeNull();
    expect(fields.toc_override).toBeNull();
    expect(fields.custom_meta).toBeNull();
    expect(fields.related_override).toBeNull();
  });

  it("zachowuje `false` i pustą tablicę podane jawnie (nie podmienia na domyślne)", () => {
    const fields = buildPostUpdateFields(
      form({ takeaways_pl: [], seo_noindex: false, is_sponsored: false }),
    );
    expect(fields.takeaways_pl).toEqual([]);
    expect(fields.seo_noindex).toBe(false);
    expect(fields.is_sponsored).toBe(false);
  });

  it("zachowuje `true` w polach boolowskich", () => {
    const fields = buildPostUpdateFields(
      form({
        seo_noindex: true,
        is_sponsored: true,
        sponsored_affiliate: true,
        sponsored_political: true,
      }),
    );
    expect(fields.seo_noindex).toBe(true);
    expect(fields.is_sponsored).toBe(true);
    expect(fields.sponsored_affiliate).toBe(true);
    expect(fields.sponsored_political).toBe(true);
  });

  it("przenosi cały zestaw deklaracji komercyjnej", () => {
    // Deklaracja jest wymagana ustawowo (uśude art. 9, DSA art. 26,
    // rozp. 2024/900) - zgubione pole to nie kosmetyka, tylko brak oznaczenia.
    const fields = buildPostUpdateFields(
      form({
        is_sponsored: true,
        sponsored_kind: "sponsored",
        sponsored_advertiser_name: "Firma",
        sponsored_advertiser_url: "https://firma.example",
        sponsored_payer_name: "Płatnik",
        sponsored_note_pl: "Materiał sponsorowany",
        sponsored_note_en: "Sponsored content",
        sponsored_political: true,
        sponsored_political_process: "wybory",
        sponsored_sponsor_controller: "Kontroler",
        sponsored_order_ref: "ZL/2026/07",
      }),
    );
    expect(fields).toMatchObject({
      is_sponsored: true,
      sponsored_kind: "sponsored",
      sponsored_advertiser_name: "Firma",
      sponsored_advertiser_url: "https://firma.example",
      sponsored_payer_name: "Płatnik",
      sponsored_note_pl: "Materiał sponsorowany",
      sponsored_note_en: "Sponsored content",
      sponsored_political: true,
      sponsored_political_process: "wybory",
      sponsored_sponsor_controller: "Kontroler",
      sponsored_order_ref: "ZL/2026/07",
    });
  });

  it("przenosi snapshot organizacji obok jej referencji", () => {
    // Snapshot nie jest duplikacją z lenistwa: `crm_companies` czyta wyłącznie
    // staff CRM, więc publiczny render nie ma jak dołączyć tej tabeli.
    const fields = buildPostUpdateFields(
      form({
        organization_id: "org-1",
        organization_name: "Instytut",
        organization_logo_url: "https://example.com/logo.svg",
        organization_website: "https://instytut.example",
      }),
    );
    expect(fields).toMatchObject({
      organization_id: "org-1",
      organization_name: "Instytut",
      organization_logo_url: "https://example.com/logo.svg",
      organization_website: "https://instytut.example",
    });
  });
});

describe("applyPersistedImages", () => {
  const base = form();

  it("bez zmian zwraca TĘ SAMĄ referencję migawki", () => {
    const same = applyPersistedImages(
      base,
      { doc: null, changed: false },
      { doc: null, changed: false },
    );
    // Nowy obiekt to dla autosave'u nowa wartość - a więc kolejny zapis.
    expect(same).toBe(base);
  });

  it("podmienia tylko blocks_data, gdy zmienił się wyłącznie on", () => {
    const blocks = { pl: { version: 1, blocks: [] } } as unknown as PostForm["blocks_data"];
    const next = applyPersistedImages(
      base,
      { doc: blocks, changed: true },
      { doc: null, changed: false },
    );
    expect(next).not.toBe(base);
    expect(next.blocks_data).toBe(blocks);
    expect(next.builder_data).toBe(base.builder_data);
  });

  it("podmienia tylko builder_data, gdy zmienił się wyłącznie on", () => {
    const builder = { version: 1, sections: [] } as unknown as PostForm["builder_data"];
    const next = applyPersistedImages(
      base,
      { doc: null, changed: false },
      { doc: builder, changed: true },
    );
    expect(next.builder_data).toBe(builder);
    expect(next.blocks_data).toBe(base.blocks_data);
  });

  it("podmienia oba dokumenty naraz", () => {
    const blocks = { pl: { version: 1, blocks: [] } } as unknown as PostForm["blocks_data"];
    const builder = { version: 1, sections: [] } as unknown as PostForm["builder_data"];
    const next = applyPersistedImages(
      base,
      { doc: blocks, changed: true },
      { doc: builder, changed: true },
    );
    expect(next.blocks_data).toBe(blocks);
    expect(next.builder_data).toBe(builder);
  });

  it("nie rusza żadnego innego pola migawki", () => {
    const next = applyPersistedImages(
      base,
      { doc: null, changed: true },
      { doc: null, changed: true },
    );
    expect(next.title_pl).toBe(base.title_pl);
    expect(next.status).toBe(base.status);
    expect(next.slug).toBe(base.slug);
  });
});

describe("replaceFormImageUrls", () => {
  const dataUrl = "data:image/png;base64,AAAA";
  const publicUrl = "https://storage.example/posts/wklejka.png";

  it("null formularza przechodzi bez zmian", () => {
    expect(replaceFormImageUrls(null, new Map([[dataUrl, publicUrl]]))).toBeNull();
  });

  it("BRAK TRAFIEŃ zwraca TĘ SAMĄ referencję formularza", () => {
    // Najważniejsza asercja tego bloku. Nowy obiekt formularza to dla
    // `useAutosave` nowa wartość, więc niezmieniony formularz uruchamiałby
    // kolejny zapis, ten kolejny znowu wołałby tę funkcję - i edytor
    // zapisywałby w kółko, bez udziału redaktora.
    const f = form({
      blocks_data: {
        pl: { version: 1, blocks: [{ type: "paragraph", html: "<p>bez grafik</p>" }] },
      } as unknown as PostForm["blocks_data"],
    });
    expect(replaceFormImageUrls(f, new Map([[dataUrl, publicUrl]]))).toBe(f);
  });

  it("pusta mapa podmian też zwraca tę samą referencję", () => {
    const f = form({
      blocks_data: {
        pl: { version: 1, blocks: [{ type: "image", src: dataUrl }] },
      } as unknown as PostForm["blocks_data"],
    });
    expect(replaceFormImageUrls(f, new Map())).toBe(f);
  });

  it("formularz bez dokumentów zwraca tę samą referencję", () => {
    const f = form({ blocks_data: null, builder_data: null });
    expect(replaceFormImageUrls(f, new Map([[dataUrl, publicUrl]]))).toBe(f);
  });

  it("podmienia adres w blocks_data i zwraca NOWY obiekt", () => {
    const f = form({
      blocks_data: {
        pl: { version: 1, blocks: [{ type: "image", src: dataUrl }] },
      } as unknown as PostForm["blocks_data"],
    });
    const next = replaceFormImageUrls(f, new Map([[dataUrl, publicUrl]]));
    expect(next).not.toBe(f);
    expect(JSON.stringify(next?.blocks_data)).toContain(publicUrl);
    expect(JSON.stringify(next?.blocks_data)).not.toContain(dataUrl);
  });

  it("podmienia adres w builder_data", () => {
    const f = form({
      builder_data: {
        version: 1,
        sections: [{ id: "s1", kind: "section", children: [{ src: dataUrl }] }],
      } as unknown as PostForm["builder_data"],
    });
    const next = replaceFormImageUrls(f, new Map([[dataUrl, publicUrl]]));
    expect(next).not.toBe(f);
    expect(JSON.stringify(next?.builder_data)).toContain(publicUrl);
  });

  it("podmienia w OBU dokumentach jednym przejściem", () => {
    const f = form({
      blocks_data: {
        pl: { version: 1, blocks: [{ type: "image", src: dataUrl }] },
      } as unknown as PostForm["blocks_data"],
      builder_data: {
        version: 1,
        sections: [{ id: "s1", kind: "section", children: [{ src: dataUrl }] }],
      } as unknown as PostForm["builder_data"],
    });
    const next = replaceFormImageUrls(f, new Map([[dataUrl, publicUrl]]));
    expect(JSON.stringify(next?.blocks_data)).toContain(publicUrl);
    expect(JSON.stringify(next?.builder_data)).toContain(publicUrl);
  });

  it("nie rusza pól poza dokumentami", () => {
    const f = form({
      title_pl: "Zachowany tytuł",
      blocks_data: {
        pl: { version: 1, blocks: [{ type: "image", src: dataUrl }] },
      } as unknown as PostForm["blocks_data"],
    });
    const next = replaceFormImageUrls(f, new Map([[dataUrl, publicUrl]]));
    expect(next?.title_pl).toBe("Zachowany tytuł");
    expect(next?.slug).toBe(f.slug);
  });
});

describe("nextOptimisticBase", () => {
  const previous = "2026-08-18T10:00:00.000Z";
  const saved = "2026-08-18T10:05:00.000Z";

  it("przesuwa bazę na updated_at zwrócony przez serwer", () => {
    expect(nextOptimisticBase(saved, previous)).toBe(saved);
  });

  it("brak wartości w odpowiedzi ZOSTAWIA dotychczasową bazę", () => {
    // Wyzerowanie bazy kazałoby serwerowi odrzucić następny zapis jako konflikt
    // („ktoś inny zapisał w międzyczasie") - mimo że nikt inny nie zapisywał.
    expect(nextOptimisticBase(undefined, previous)).toBe(previous);
    expect(nextOptimisticBase(null, previous)).toBe(previous);
  });

  it("pierwszy zapis bez wcześniejszej bazy daje null, nie undefined", () => {
    expect(nextOptimisticBase(undefined, null)).toBeNull();
  });

  it("serwer może cofnąć bazę - reguła nie porównuje dat, tylko ufa serwerowi", () => {
    // Świadomie: to serwer jest właścicielem `updated_at`. Porównywanie dat po
    // stronie klienta wprowadziłoby drugie źródło prawdy.
    expect(nextOptimisticBase(previous, saved)).toBe(previous);
  });
});
