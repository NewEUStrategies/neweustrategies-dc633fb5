import { describe, expect, it } from "vitest";
import type { SeoIssue } from "@/lib/seo/validation";
import { EDIT_CONFLICT_CODE } from "@/lib/content/saveConflict";
import { DISCLOSURE_ERROR_PREFIX } from "@/lib/content/sponsored";
import type { PostForm } from "../../types";
import {
  NON_PATCHED_FORM_FIELDS,
  buildPostPatch,
  isScheduledInPast,
  nextBaseUpdatedAt,
  resolveSlugOutcome,
  saveErrorDescriptor,
  seoSaveGate,
} from "../postPatch";

/**
 * KOMPLETNY formularz. Kompletność jest tu warunkiem sensu testu poniżej:
 * gdy ktoś doda pole do `PostForm`, ten obiekt przestanie się kompilować,
 * a test kompletności powie, czy nowe pole trafia do zapisu, czy świadomie
 * nie. Wartości są rozróżnialne, żeby zamiana dwóch pól miejscami była
 * widoczna w asercji.
 */
const FULL_FORM: PostForm = {
  id: "id-1",
  slug: "moj-wpis",
  updated_at: "2026-08-01T10:00:00.000Z",
  status: "draft",
  author_id: "author-1",
  editor: "blocks",
  title_pl: "Tytuł PL",
  title_en: "Title EN",
  excerpt_pl: "Zajawka PL",
  excerpt_en: "Excerpt EN",
  content_pl: "<p>PL</p>",
  content_en: "<p>EN</p>",
  cover_image_url: "https://example.test/cover.jpg",
  audio_url_pl: "https://example.test/pl.mp3",
  audio_url_en: "https://example.test/en.mp3",
  tts_voice_pl: "voice-pl",
  tts_voice_en: "voice-en",
  read_minutes: 7,
  published_at: "2026-07-01T10:00:00.000Z",
  publish_at: "2026-09-01T10:00:00.000Z",
  builder_data: null,
  blocks_data: null,
  parent_page_id: "parent-1",
  post_format: "standard",
  layout_overrides: null,
  takeaways_pl: ["a"],
  takeaways_en: ["b"],
  takeaways_variant: "card",
  toc_override: null,
  custom_meta: { k: "v" },
  related_override: { r: 1 },
  seo_title_pl: "SEO PL",
  seo_title_en: "SEO EN",
  seo_description_pl: "Opis PL",
  seo_description_en: "Desc EN",
  seo_canonical_url: "https://example.test/canon",
  seo_noindex: true,
  seo_og_image_url: "https://example.test/og.jpg",
  og_image_generated_url: "https://example.test/og-gen.jpg",
  organization_id: "org-1",
  organization_name: "Firma",
  organization_logo_url: "https://example.test/logo.svg",
  organization_website: "https://firma.test",
  is_sponsored: true,
  sponsored_kind: "sponsored",
  sponsored_advertiser_name: "Reklamodawca",
  sponsored_advertiser_url: "https://reklama.test",
  sponsored_payer_name: "Płatnik",
  sponsored_note_pl: "Nota PL",
  sponsored_note_en: "Note EN",
  sponsored_affiliate: true,
  sponsored_political: true,
  sponsored_political_process: "wybory",
  sponsored_sponsor_controller: "Administrator",
  sponsored_order_ref: "ZL/2026/1",
  sponsored_marked_at: "2026-06-01T10:00:00.000Z",
};

describe("buildPostPatch - kompletność payloadu", () => {
  it("wysyła KAŻDE pole formularza poza jawnie wyłączonymi", () => {
    // To jest właściwa treść tego testu: pole dodane do `PostForm`, a zapomniane
    // w patchu, znika z zapisu BEZ ŚLADU - redaktor wypełnia pole, widzi je
    // w edytorze do końca sesji, a po odświeżeniu jest puste. Żaden typ tego
    // nie łapie, bo patch jest osobnym obiektem literalnym.
    const patch = buildPostPatch(FULL_FORM);
    const covered = new Set([...Object.keys(patch), ...NON_PATCHED_FORM_FIELDS]);
    const missing = Object.keys(FULL_FORM).filter((k) => !covered.has(k));
    expect(missing, `pola formularza poza zapisem i poza listą wyłączeń: ${missing}`).toEqual([]);
  });

  it("NIE wysyła pól tylko do odczytu", () => {
    const patch = buildPostPatch(FULL_FORM) as Record<string, unknown>;
    for (const field of NON_PATCHED_FORM_FIELDS) {
      expect(field in patch, `${field} nie może iść w payloadzie zapisu`).toBe(false);
    }
  });

  it("REGRESJA: published_at nie wycieka do zapisu", () => {
    // Niezmienny znacznik PIERWSZEJ publikacji: porządkuje archiwum, RSS
    // i sitemapę. Gdyby klient go odsyłał, dałoby się cofnąć datę starego
    // artykułu i przestawić kolejność publicznych list.
    expect("published_at" in buildPostPatch(FULL_FORM)).toBe(false);
  });

  it("REGRESJA: sponsored_marked_at nie wycieka do zapisu", () => {
    // Data PIERWSZEJ deklaracji komercyjnej. Odsyłana przez klienta byłaby
    // przepisywana na „teraz" przy KAŻDYM autozapisie, a ślad rozliczalności
    // przestałby cokolwiek dowodzić (rozp. UE 2024/900 art. 12 ust. 4).
    expect("sponsored_marked_at" in buildPostPatch(FULL_FORM)).toBe(false);
  });

  it("przenosi wartości bez zniekształceń", () => {
    const patch = buildPostPatch(FULL_FORM);
    expect(patch.title_pl).toBe("Tytuł PL");
    expect(patch.title_en).toBe("Title EN");
    expect(patch.slug).toBe("moj-wpis");
    expect(patch.status).toBe("draft");
    expect(patch.read_minutes).toBe(7);
    expect(patch.custom_meta).toEqual({ k: "v" });
    expect(patch.sponsored_order_ref).toBe("ZL/2026/1");
  });
});

describe("buildPostPatch - wartości domyślne", () => {
  it("zamienia brak tablic i flag na wartości akceptowane przez bazę", () => {
    // Kolumny mają NOT NULL, a `updatePost` waliduje wejście Zodem: `undefined`
    // zamiast `[]` / `false` odrzuca CAŁY zapis, a nie pomija jedno pole.
    const patch = buildPostPatch({
      ...FULL_FORM,
      takeaways_pl: undefined as unknown as string[],
      takeaways_en: undefined as unknown as string[],
      takeaways_variant: undefined as unknown as null,
      toc_override: undefined as unknown as null,
      custom_meta: undefined as unknown as null,
      related_override: undefined as unknown as null,
      seo_noindex: undefined as unknown as boolean,
      is_sponsored: undefined as unknown as boolean,
      sponsored_affiliate: undefined as unknown as boolean,
      sponsored_political: undefined as unknown as boolean,
    });

    expect(patch.takeaways_pl).toEqual([]);
    expect(patch.takeaways_en).toEqual([]);
    expect(patch.takeaways_variant).toBeNull();
    expect(patch.toc_override).toBeNull();
    expect(patch.custom_meta).toBeNull();
    expect(patch.related_override).toBeNull();
    expect(patch.seo_noindex).toBe(false);
    expect(patch.is_sponsored).toBe(false);
    expect(patch.sponsored_affiliate).toBe(false);
    expect(patch.sponsored_political).toBe(false);
  });

  it("nie podmienia wartości fałszywych, które redaktor ustawił świadomie", () => {
    // `?? ` a nie `||`: pusta tablica punktów i wyłączona flaga to DECYZJE,
    // nie brak wartości. Operator `||` skasowałby je przy każdym zapisie.
    const patch = buildPostPatch({
      ...FULL_FORM,
      takeaways_pl: [],
      seo_noindex: false,
      is_sponsored: false,
      read_minutes: 0,
    });
    expect(patch.takeaways_pl).toEqual([]);
    expect(patch.seo_noindex).toBe(false);
    expect(patch.is_sponsored).toBe(false);
    expect(patch.read_minutes).toBe(0);
  });
});

describe("nextBaseUpdatedAt", () => {
  it("przesuwa bazę optimistic-locka na znacznik zwrócony przez serwer", () => {
    expect(
      nextBaseUpdatedAt("2026-08-01T10:00:00.000Z", { updatedAt: "2026-08-02T10:00:00.000Z" }),
    ).toBe("2026-08-02T10:00:00.000Z");
  });

  it("ZOSTAWIA poprzednią bazę, gdy serwer nie odesłał znacznika", () => {
    // Wyzerowanie dawałoby fałszywy EDIT_CONFLICT przy następnym zapisie,
    // a podstawienie „teraz" - odwrotnie: przepuszczałoby ciche nadpisanie
    // cudzej pracy.
    const prev = "2026-08-01T10:00:00.000Z";
    expect(nextBaseUpdatedAt(prev, {})).toBe(prev);
    expect(nextBaseUpdatedAt(prev, { updatedAt: null })).toBe(prev);
    expect(nextBaseUpdatedAt(prev, null)).toBe(prev);
    expect(nextBaseUpdatedAt(prev, undefined)).toBe(prev);
  });

  it("brak bazy i brak odpowiedzi daje null, nie undefined", () => {
    expect(nextBaseUpdatedAt(null, {})).toBeNull();
  });
});

describe("resolveSlugOutcome", () => {
  it("bez kolizji: slug zostaje, nawigacji nie ma", () => {
    expect(resolveSlugOutcome("moj-wpis", "moj-wpis", "moj-wpis")).toEqual({
      slug: "moj-wpis",
      collided: false,
      mustNavigate: false,
    });
  });

  it("REGRESJA: przy kolizji wygrywa slug ZAPISANY, nie wpisany w formularzu", () => {
    // `uniqueSlug` dopisuje sufiks. Nawigacja na slug z formularza załadowałaby
    // CUDZY wpis, który go posiada - z perspektywy redaktora edytor
    // „podmieniłby" mu artykuł pod ręką.
    expect(resolveSlugOutcome("moj-wpis", "moj-wpis-2", "moj-wpis")).toEqual({
      slug: "moj-wpis-2",
      collided: true,
      mustNavigate: true,
    });
  });

  it("zmiana slugu bez kolizji też przenosi trasę", () => {
    expect(resolveSlugOutcome("nowy-slug", "nowy-slug", "stary-slug")).toEqual({
      slug: "nowy-slug",
      collided: false,
      mustNavigate: true,
    });
  });

  it("brak slugu w odpowiedzi serwera nie kasuje slugu z formularza", () => {
    expect(resolveSlugOutcome("moj-wpis", undefined, "moj-wpis").slug).toBe("moj-wpis");
    expect(resolveSlugOutcome("moj-wpis", null, "moj-wpis").collided).toBe(false);
  });
});

describe("saveErrorDescriptor", () => {
  it("rozpoznaje konflikt edycji", () => {
    expect(saveErrorDescriptor(new Error(EDIT_CONFLICT_CODE))).toEqual({ kind: "conflict" });
  });

  it("rozpoznaje odrzuconą publikację niekompletnej deklaracji i WYMIENIA braki", () => {
    // Serwer odpowiada kodem, nie zdaniem. „Zapis odrzucony" bez wskazania pól
    // kazałoby redaktorowi zgadywać, którego z kilkunastu pól ujawnienia brakuje.
    const descriptor = saveErrorDescriptor(
      new Error(`${DISCLOSURE_ERROR_PREFIX}advertiser,advertiserUrl`),
    );
    expect(descriptor).toEqual({ kind: "disclosureGaps", gaps: ["advertiser", "advertiserUrl"] });
  });

  it("konflikt wygrywa nad ujawnieniem, gdy błąd niesie oba znaczniki", () => {
    // Kolejność ma znaczenie dla komunikatu: konflikt znaczy „twoja treść
    // została, ale ktoś był szybszy", a braki ujawnienia - „popraw i zapisz
    // ponownie". Pomylenie ich każe redaktorowi poprawiać pola, których
    // poprawianie i tak nic nie da, dopóki nie odświeży wpisu.
    const both = new Error(`${EDIT_CONFLICT_CODE} ${DISCLOSURE_ERROR_PREFIX}advertiser`);
    expect(saveErrorDescriptor(both)).toEqual({ kind: "conflict" });
  });

  it("nierozpoznany błąd daje null - leci dalej surowy, nie przykryty ogólnikiem", () => {
    expect(saveErrorDescriptor(new Error("cokolwiek innego"))).toBeNull();
    expect(saveErrorDescriptor(null)).toBeNull();
    expect(saveErrorDescriptor(undefined)).toBeNull();
    expect(saveErrorDescriptor("napis")).toBeNull();
  });
});

describe("seoSaveGate", () => {
  const issue = (severity: SeoIssue["severity"]): SeoIssue => ({ severity }) as unknown as SeoIssue;

  it("błąd blokuje zapis", () => {
    expect(seoSaveGate([issue("error")])).toEqual({ kind: "blocked" });
  });

  it("błąd wygrywa nad ostrzeżeniami", () => {
    expect(seoSaveGate([issue("warning"), issue("error")])).toEqual({ kind: "blocked" });
  });

  it("same ostrzeżenia przepuszczają zapis i podają LICZBĘ pól", () => {
    expect(seoSaveGate([issue("warning"), issue("warning")])).toEqual({ kind: "warn", count: 2 });
  });

  it("brak uwag przechodzi bez komunikatu", () => {
    expect(seoSaveGate([])).toEqual({ kind: "ok" });
  });
});

describe("isScheduledInPast", () => {
  const now = Date.parse("2026-09-10T12:00:00.000Z");

  it("zaplanowany na przeszłość jest oznaczany", () => {
    // Taki wpis CZEKA na przebieg `publish_due_posts()`, a nie jest
    // opublikowany - bez ostrzeżenia wygląda w panelu jak zgubiony.
    expect(
      isScheduledInPast({ status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" }, now),
    ).toBe(true);
  });

  it("termin dokładnie „teraz” liczy się jako miniony", () => {
    expect(
      isScheduledInPast({ status: "scheduled", publish_at: "2026-09-10T12:00:00.000Z" }, now),
    ).toBe(true);
  });

  it("zaplanowany na przyszłość nie jest oznaczany", () => {
    expect(
      isScheduledInPast({ status: "scheduled", publish_at: "2026-09-20T10:00:00.000Z" }, now),
    ).toBe(false);
  });

  it("inne statusy nie dotyczą tej reguły, nawet z przeszłym publish_at", () => {
    expect(
      isScheduledInPast({ status: "draft", publish_at: "2026-09-01T10:00:00.000Z" }, now),
    ).toBe(false);
    expect(
      isScheduledInPast({ status: "published", publish_at: "2026-09-01T10:00:00.000Z" }, now),
    ).toBe(false);
  });

  it("brak formularza, brak terminu i termin nieparsowalny nie dają fałszywego alarmu", () => {
    expect(isScheduledInPast(null, now)).toBe(false);
    expect(isScheduledInPast({ status: "scheduled", publish_at: null }, now)).toBe(false);
    expect(isScheduledInPast({ status: "scheduled", publish_at: "nie-data" }, now)).toBe(false);
  });
});
