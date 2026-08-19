// Trzy reguły edytora wyjęte z `usePostEditorForm`: adres wpisu po zapisie,
// klasyfikacja błędu zapisu i bramki (SEO / checklista / przeterminowany
// harmonogram). Wszystkie zwracają DANE albo KLUCZE i18n, nigdy gotowego tekstu,
// więc te testy nie zależą od copy - a bramka i18n dalej pilnuje PL/EN.
import { describe, expect, it } from "vitest";
import { EDIT_CONFLICT_CODE } from "@/lib/content/saveConflict";
// Prefiksy bierzemy z KODU, nie z literalu w tescie: zaszyty string przechodzilby
// dalej, gdyby serwer zmienil format, a klasyfikacja przestalaby rozpoznawac blad.
import { DISCLOSURE_ERROR_PREFIX } from "@/lib/content/sponsored";
import type { PublishChecklist } from "@/lib/content/publishChecklist";
import type { SeoIssue } from "@/lib/seo/validation";
import { resolveCanonicalSlug } from "../slugNavigation";
import { classifySaveError } from "../saveErrors";
import { isScheduledInPast, missingRequiredKeys, seoSaveDecision } from "../editorGates";
import type { PostForm } from "../../types";

// ---------------------------------------------------------------------------
// resolveCanonicalSlug
// ---------------------------------------------------------------------------

describe("resolveCanonicalSlug", () => {
  it("slug niezmieniony: żadnego ostrzeżenia, żadnej nawigacji", () => {
    expect(
      resolveCanonicalSlug({
        savedSlug: "moj-wpis",
        snapshotSlug: "moj-wpis",
        routeSlug: "moj-wpis",
      }),
    ).toEqual({ canonicalSlug: "moj-wpis", slugChanged: false, needsNavigate: false });
  });

  it("serwer znormalizował slug: ostrzeżenie ORAZ nawigacja na slug ZAPISANY", () => {
    // To jest sedno tej reguły. `uniqueSlug` dopisuje sufiks przy kolizji.
    // Nawigacja na slug WPISANY w formularzu („moj-wpis") załadowałaby CUDZY
    // wpis, który ten slug już posiada - redaktor zobaczyłby w edytorze obcą
    // treść, a następny autosave zapisałby ją na tamtym wierszu.
    expect(
      resolveCanonicalSlug({
        savedSlug: "moj-wpis-2",
        snapshotSlug: "moj-wpis",
        routeSlug: "moj-wpis",
      }),
    ).toEqual({ canonicalSlug: "moj-wpis-2", slugChanged: true, needsNavigate: true });
  });

  it("redaktor zmienił slug, serwer przyjął: bez ostrzeżenia, ale z nawigacją", () => {
    // Adres trasy jest jeszcze stary, więc trzeba przekierować - ale nic się
    // nie „zepsuło", więc ostrzeżenia nie ma.
    expect(
      resolveCanonicalSlug({
        savedSlug: "nowy-slug",
        snapshotSlug: "nowy-slug",
        routeSlug: "stary-slug",
      }),
    ).toEqual({ canonicalSlug: "nowy-slug", slugChanged: false, needsNavigate: true });
  });

  it("brak sluga w odpowiedzi cofa się do sluga z migawki, nie do pustego", () => {
    // Nawigacja na pusty slug wyrzuciłaby redaktora z edytora.
    expect(
      resolveCanonicalSlug({
        savedSlug: undefined,
        snapshotSlug: "moj-wpis",
        routeSlug: "moj-wpis",
      }),
    ).toEqual({ canonicalSlug: "moj-wpis", slugChanged: false, needsNavigate: false });
    expect(
      resolveCanonicalSlug({ savedSlug: null, snapshotSlug: "moj-wpis", routeSlug: "inny" }),
    ).toMatchObject({ canonicalSlug: "moj-wpis", needsNavigate: true });
  });

  it("pusty string ze serwera to WARTOŚĆ, nie brak (?? nie łapie pustego)", () => {
    // Dokumentuje granicę operatora `??`: pusty slug z serwera przechodzi dalej.
    // Serwer takiego nie zwraca (kolumna jest NOT NULL i generowana), ale gdyby
    // zaczął, reguła ma się zachować przewidywalnie.
    expect(
      resolveCanonicalSlug({ savedSlug: "", snapshotSlug: "moj-wpis", routeSlug: "moj-wpis" }),
    ).toEqual({ canonicalSlug: "", slugChanged: true, needsNavigate: true });
  });
});

// ---------------------------------------------------------------------------
// classifySaveError
// ---------------------------------------------------------------------------

describe("classifySaveError", () => {
  it("rozpoznaje konflikt optimistic-locka", () => {
    const result = classifySaveError(new Error(`${EDIT_CONFLICT_CODE}: ktoś inny zapisał`));
    expect(result.conflict).toBe(true);
    expect(result.disclosureGaps).toEqual([]);
  });

  it("rozpoznaje braki deklaracji komercyjnej i zwraca KODY pól", () => {
    // Serwer odpowiada kodami, nie zdaniem - tylko klient zna język panelu.
    const result = classifySaveError(new Error(`${DISCLOSURE_ERROR_PREFIX} kind, advertiser`));
    expect(result.conflict).toBe(false);
    expect(result.disclosureGaps).toEqual(["kind", "advertiser"]);
  });

  it("oba warunki naraz - rozpoznanie jest NIEZALEŻNE", () => {
    // Oba kody jadą w tym samym `message`. Rozpoznanie tylko pierwszego kazałoby
    // redaktorowi zgadywać, czego brakuje.
    // Kolejnosc jest istotna: `parseDisclosureError` czyta OD swojego prefiksu
    // do konca komunikatu, wiec kody brakow musza byc na koncu - i tak je
    // sklada serwer.
    const result = classifySaveError(
      new Error(`${EDIT_CONFLICT_CODE}: konflikt. ${DISCLOSURE_ERROR_PREFIX} advertiserUrl`),
    );
    expect(result.conflict).toBe(true);
    expect(result.disclosureGaps).toEqual(["advertiserUrl"]);
  });

  it("zwykły błąd sieci nie jest ani konfliktem, ani brakiem deklaracji", () => {
    const result = classifySaveError(new Error("Failed to fetch"));
    expect(result).toEqual({ conflict: false, disclosureGaps: [] });
  });

  it("nie-Error na wejściu nie wysypuje klasyfikacji", () => {
    // Błąd przechodzi granicę server-fn i nie zawsze jest instancją Error.
    expect(classifySaveError("EDIT_CONFLICT: string zamiast Error").conflict).toBe(true);
    expect(classifySaveError(null)).toEqual({ conflict: false, disclosureGaps: [] });
    expect(classifySaveError(undefined)).toEqual({ conflict: false, disclosureGaps: [] });
    expect(classifySaveError({ code: 500 })).toEqual({ conflict: false, disclosureGaps: [] });
  });
});

// ---------------------------------------------------------------------------
// seoSaveDecision
// ---------------------------------------------------------------------------

function seoIssue(severity: SeoIssue["severity"], lang: SeoIssue["lang"] = "pl"): SeoIssue {
  return {
    lang,
    kind: "title",
    severity,
    chars: 70,
    charLimit: 60,
    px: 600,
    pxLimit: 580,
  };
}

describe("seoSaveDecision", () => {
  it("brak problemów: zapis wolny, zero ostrzeżeń", () => {
    expect(seoSaveDecision([])).toEqual({ blocked: false, warningCount: 0 });
  });

  it("problem `error` BLOKUJE zapis", () => {
    expect(seoSaveDecision([seoIssue("error")])).toMatchObject({ blocked: true });
  });

  it("problemy `warning` NIE blokują - tylko się liczą", () => {
    // Zrównanie ostrzeżeń z błędami zablokowałoby publikację z powodu paru
    // pikseli; pominięcie ich przepuściłoby tytuł ucięty w wynikach Google.
    expect(seoSaveDecision([seoIssue("warning"), seoIssue("warning", "en")])).toEqual({
      blocked: false,
      warningCount: 2,
    });
  });

  it("mieszanka: blokada od błędu, licznik tylko od ostrzeżeń", () => {
    const decision = seoSaveDecision([seoIssue("error"), seoIssue("warning")]);
    expect(decision.blocked).toBe(true);
    // Licznik nie może zliczać błędu - komunikat mówi „N ostrzeżeń".
    expect(decision.warningCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// missingRequiredKeys
// ---------------------------------------------------------------------------

function checklist(missing: Array<PublishChecklist["items"][number]["id"]>): PublishChecklist {
  const items = missing.map((id) => ({ id, level: "required" as const, ok: false }));
  return {
    items,
    missingRequired: items,
    missingRecommended: [],
    requiredOk: items.length === 0,
    score: 0,
  };
}

describe("missingRequiredKeys", () => {
  it("zwraca KLUCZE i18n, nie przetłumaczony tekst", () => {
    // Gdyby zwracała tekst, test wiązałby się z copy, a bramka i18n przestałaby
    // być jedynym miejscem pilnującym PL/EN.
    expect(missingRequiredKeys(checklist(["titlePl", "cover"]))).toEqual([
      "adminPostPanes.publishChecklist.items.titlePl",
      "adminPostPanes.publishChecklist.items.cover",
    ]);
  });

  it("brak checklisty (formularz jeszcze się nie wczytał) daje pustą listę", () => {
    expect(missingRequiredKeys(null)).toEqual([]);
  });

  it("kompletna checklista daje pustą listę", () => {
    expect(missingRequiredKeys(checklist([]))).toEqual([]);
  });

  it("zachowuje kolejność pozycji z checklisty", () => {
    expect(missingRequiredKeys(checklist(["cover", "category", "titlePl"]))).toEqual([
      "adminPostPanes.publishChecklist.items.cover",
      "adminPostPanes.publishChecklist.items.category",
      "adminPostPanes.publishChecklist.items.titlePl",
    ]);
  });
});

// ---------------------------------------------------------------------------
// isScheduledInPast
// ---------------------------------------------------------------------------

describe("isScheduledInPast", () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");

  it("zaplanowany na przeszłość: tak", () => {
    // Taki wpis czeka na najbliższy przebieg schedulera, a redaktor widzi status
    // „zaplanowany" i zakłada, że wszystko jest w porządku.
    expect(
      isScheduledInPast({ status: "scheduled", publish_at: "2026-08-18T11:00:00.000Z" }, now),
    ).toBe(true);
  });

  it("zaplanowany DOKŁADNIE na teraz: tak (granica domknięta)", () => {
    expect(
      isScheduledInPast({ status: "scheduled", publish_at: "2026-08-18T12:00:00.000Z" }, now),
    ).toBe(true);
  });

  it("zaplanowany na przyszłość: nie", () => {
    expect(
      isScheduledInPast({ status: "scheduled", publish_at: "2026-08-18T13:00:00.000Z" }, now),
    ).toBe(false);
  });

  it("inny status niż `scheduled`: nie, choćby data była w przeszłości", () => {
    // Opublikowany wpis MA datę w przeszłości - to jest normalne, nie problem.
    const past = "2026-01-01T00:00:00.000Z";
    expect(isScheduledInPast({ status: "published", publish_at: past }, now)).toBe(false);
    expect(isScheduledInPast({ status: "draft", publish_at: past }, now)).toBe(false);
    expect(isScheduledInPast({ status: "archived", publish_at: past }, now)).toBe(false);
    expect(isScheduledInPast({ status: "pending_review", publish_at: past }, now)).toBe(false);
  });

  it("brak daty publikacji: nie", () => {
    expect(isScheduledInPast({ status: "scheduled", publish_at: null }, now)).toBe(false);
  });

  it("brak formularza: nie", () => {
    expect(isScheduledInPast(null, now)).toBe(false);
  });

  it("nieparsowalna data NIE jest przeszłością", () => {
    // NaN <= now jest fałszem; reguła zapisuje to jawnie, żeby dało się to
    // przeczytać zamiast wnioskować z semantyki NaN.
    expect(isScheduledInPast({ status: "scheduled", publish_at: "nie-data" }, now)).toBe(false);
    expect(isScheduledInPast({ status: "scheduled", publish_at: "" }, now)).toBe(false);
  });

  it("działa na pełnym formularzu, nie tylko na dwóch polach", () => {
    const full = {
      status: "scheduled",
      publish_at: "2026-08-01T00:00:00.000Z",
    } as Pick<PostForm, "status" | "publish_at">;
    expect(isScheduledInPast(full, now)).toBe(true);
  });
});
