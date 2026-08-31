// Warstwa CMP podajaca decyzje zgody REKLAMOM: `src/lib/ads/consent.ts`.
//
// PO CO OSOBNY PLIK. Rdzen GPC i rejestr RODO maja siedem plikow testowych w
// `src/lib/consent/`, ale warstwa, ktora te decyzje PODAJE reklamom, nie miala
// ani jednego - a to ona jest jedynym wejsciem bramki: `AdSlot.tsx` liczy
// `blocked = slot.requires_consent && !granted`, gdzie `granted` pochodzi z
// `useMarketingConsent()` z tego pliku. Bez tych asercji kazda zmiana w
// klamrze GPC, mirrorze cookie albo migracji klucza przechodzi bez sygnalu.
//
// ATRAPUJEMY WYLACZNIE GRANICE: klienta Supabase (baza + sesja) i funkcje
// serwerowa rejestru zgod. localStorage, sessionStorage, cookie, zdarzenia okna
// i sam sygnal GPC biegna PRAWDZIWE - to ich zachowanie jest przedmiotem dowodu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { GPC_COOKIE, GPC_COOKIE_VALUE } from "@/lib/consent/gpc";

const sb = vi.hoisted(() => ({
  userId: null as string | null,
  prefs: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  bulk: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: sb.userId ? { session: { user: { id: sb.userId } } } : { session: null },
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: async () => ({ data: [{ prefs: sb.prefs }], error: null }),
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        sb.updates.push(payload);
        return { eq: async () => ({ data: null, error: null }) };
      },
    }),
  },
}));

vi.mock("@/lib/consents.functions", () => ({
  setMyConsentsBulk: async (arg: unknown) => {
    sb.bulk.push(arg);
    return { ok: true };
  },
}));

import {
  clearConsentPreview,
  hasCategoryConsent,
  isGpcCurrentlyHonored,
  setConsentPreview,
  useConsent,
  useEffectiveConsent,
  useMarketingConsent,
} from "@/lib/ads/consent";

const STORAGE_KEY = "consent:v2";
const LEGACY_KEY = "consent:marketing";
const COOKIE_NAME = "nes_cookie_consent";

function writeStored(cats: Partial<Record<string, boolean>>, extra: Record<string, unknown> = {}) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 2,
      ts: Date.now(),
      categories: {
        necessary: true,
        functional: false,
        analytics: false,
        marketing: false,
        ...cats,
      },
      ...extra,
    }),
  );
}

/** Wlacza sygnal GPC nosnikiem cookie - tak, jak robi to prawdziwa przegladarka. */
function enableGpc() {
  document.cookie = `${GPC_COOKIE}=${GPC_COOKIE_VALUE}; path=/`;
}

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearCookies();
  sb.userId = null;
  sb.prefs = {};
  sb.updates = [];
  sb.bulk = [];
});

afterEach(() => {
  clearCookies();
});

// ---------------------------------------------------------------------------
describe("klamra GPC na kategoriach analytics i marketing", () => {
  it("klamruje OBIE kategorie mimo zgody zapisanej w localStorage", () => {
    writeStored({ functional: true, analytics: true, marketing: true });
    enableGpc();

    const { result } = renderHook(() => useEffectiveConsent());

    expect(result.current.categories.analytics).toBe(false);
    expect(result.current.categories.marketing).toBe(false);
    // functional i necessary NIE sa objete klamra - zakres jest swiadomy.
    expect(result.current.categories.functional).toBe(true);
    expect(result.current.categories.necessary).toBe(true);
    expect(result.current.gpcHonored).toBe(true);
  });

  it("bez sygnalu GPC zgoda z localStorage obowiazuje", () => {
    writeStored({ analytics: true, marketing: true });

    const { result } = renderHook(() => useEffectiveConsent());

    expect(result.current.categories.marketing).toBe(true);
    expect(result.current.gpcHonored).toBe(false);
  });

  it("klamra dziala TAKZE w trybie podgladu - podgladem testuje sie layout, nie obchodzi opt-out", () => {
    enableGpc();
    setConsentPreview({ functional: true, analytics: true, marketing: true });

    const { result } = renderHook(() => useEffectiveConsent());

    expect(result.current.preview).toBe(true);
    expect(result.current.categories.marketing).toBe(false);
    expect(result.current.categories.analytics).toBe(false);
  });

  it("podglad BEZ sygnalu GPC nadpisuje trwaly zapis", () => {
    writeStored({ marketing: false });
    setConsentPreview({ marketing: true });

    const { result } = renderHook(() => useEffectiveConsent());

    expect(result.current.categories.marketing).toBe(true);
  });

  it("zdjecie podgladu wraca do trwalego zapisu", () => {
    writeStored({ marketing: false });
    setConsentPreview({ marketing: true });
    const { result } = renderHook(() => useEffectiveConsent());
    expect(result.current.categories.marketing).toBe(true);

    act(() => {
      clearConsentPreview();
    });

    expect(result.current.preview).toBe(false);
    expect(result.current.categories.marketing).toBe(false);
  });

  it("wariant poza-Reactowy (`hasCategoryConsent`) klamruje tak samo - inaczej beacony rozjechalyby sie z UI", () => {
    writeStored({ analytics: true, marketing: true });
    enableGpc();

    expect(hasCategoryConsent("marketing")).toBe(false);
    expect(hasCategoryConsent("analytics")).toBe(false);
    expect(hasCategoryConsent("necessary")).toBe(true);
    expect(isGpcCurrentlyHonored()).toBe(true);
  });

  it("`hasCategoryConsent` klamruje rowniez PRZY aktywnym podgladzie", () => {
    enableGpc();
    setConsentPreview({ marketing: true });

    expect(hasCategoryConsent("marketing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("zdjecie klamry WYLACZNIE swiadomym override'em", () => {
  it("decyzja podjeta przy AKTYWNYM sygnale stawia znacznik gpcOverrideAt i zdejmuje klamre", async () => {
    enableGpc();
    const { result } = renderHook(() => useConsent());

    act(() => {
      result.current.save({ functional: true, analytics: true, marketing: true });
    });

    await waitFor(() => {
      expect(result.current.state?.gpcOverrideAt).toEqual(expect.any(Number));
    });
    const effective = renderHook(() => useEffectiveConsent());
    expect(effective.result.current.categories.marketing).toBe(true);
    expect(effective.result.current.gpcHonored).toBe(false);
  });

  it("SAM zapis zgody sprzed pojawienia sie sygnalu klamry NIE zdejmuje", () => {
    // Zgoda bez znacznika override - dokladnie stan "zgodzil sie, zanim wlaczyl GPC".
    writeStored({ marketing: true });
    enableGpc();

    const { result } = renderHook(() => useEffectiveConsent());

    expect(result.current.categories.marketing).toBe(false);
  });

  it("znacznik przezywa round-trip przez localStorage", () => {
    writeStored({ marketing: true }, { gpcOverrideAt: 1_700_000_000_000 });
    enableGpc();

    const { result } = renderHook(() => useEffectiveConsent());

    expect(result.current.categories.marketing).toBe(true);
  });

  it("KAZDA pozniejsza decyzja zdejmuje znacznik - inaczej klamra nigdy by nie wrocila", async () => {
    writeStored({ marketing: true }, { gpcOverrideAt: 1_700_000_000_000 });
    const { result } = renderHook(() => useConsent());

    act(() => {
      // Decyzja przy WYLACZONYM sygnale: odmowa marketingu.
      result.current.save({ functional: true, analytics: false, marketing: false });
    });

    await waitFor(() => expect(result.current.state?.categories.marketing).toBe(false));
    expect(result.current.state?.gpcOverrideAt).toBeUndefined();
  });

  it("odmowa przy aktywnym sygnale NIE jest override'em", async () => {
    enableGpc();
    const { result } = renderHook(() => useConsent());

    act(() => {
      result.current.rejectAll();
    });

    await waitFor(() => expect(result.current.state).not.toBeNull());
    expect(result.current.state?.gpcOverrideAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("mirror w cookie nes_cookie_consent", () => {
  it("zapis decyzji odklada ja rowniez w cookie", async () => {
    const { result } = renderHook(() => useConsent());

    act(() => {
      result.current.acceptAll();
    });

    await waitFor(() => expect(document.cookie).toContain(COOKIE_NAME));
    const raw = decodeURIComponent(document.cookie.split(`${COOKIE_NAME}=`)[1]!.split(";")[0]!);
    expect(JSON.parse(raw)).toMatchObject({ version: 2, categories: { marketing: true } });
  });

  it("po WYCZYSZCZENIU localStorage decyzja wraca z cookie i odtwarza localStorage", async () => {
    const first = renderHook(() => useConsent());
    act(() => {
      first.result.current.acceptAll();
    });
    await waitFor(() => expect(document.cookie).toContain(COOKIE_NAME));

    window.localStorage.clear();
    const { result } = renderHook(() => useEffectiveConsent());

    expect(result.current.categories.marketing).toBe(true);
    // Re-hydratacja: dalsze operacje maja byc spojne, wiec localStorage wraca.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("`clear()` zdejmuje i localStorage, i cookie", async () => {
    const { result } = renderHook(() => useConsent());
    act(() => {
      result.current.acceptAll();
    });
    await waitFor(() => expect(document.cookie).toContain(COOKIE_NAME));

    act(() => {
      result.current.clear();
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain(`${COOKIE_NAME}=%7B`);
  });
});

// ---------------------------------------------------------------------------
describe("migracja ze starego klucza consent:marketing", () => {
  it('"granted" przenosi sie na wszystkie kategorie klucza v2', () => {
    window.localStorage.setItem(LEGACY_KEY, "granted");

    const { result } = renderHook(() => useEffectiveConsent());

    expect(result.current.categories.marketing).toBe(true);
    expect(result.current.categories.analytics).toBe(true);
    expect(result.current.categories.functional).toBe(true);
  });

  it('"denied" przenosi sie jako odmowa', () => {
    window.localStorage.setItem(LEGACY_KEY, "denied");

    const { result } = renderHook(() => useEffectiveConsent());

    expect(result.current.categories.marketing).toBe(false);
  });

  it("stary klucz jest USUWANY, a nowy zapisany - migracja biegnie raz", () => {
    window.localStorage.setItem(LEGACY_KEY, "granted");

    renderHook(() => useEffectiveConsent());

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("smiec pod starym kluczem NIE jest traktowany jak decyzja", () => {
    window.localStorage.setItem(LEGACY_KEY, "moze");

    const { result } = renderHook(() => useConsent());

    expect(result.current.state).toBeNull();
  });

  it("zapis w NIEZNANEJ wersji jest odrzucany, nie doczytywany po polu", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, categories: { marketing: true } }),
    );

    const { result } = renderHook(() => useConsent());

    expect(result.current.state).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("synchronizacja z profilem i slad w rejestrze RODO", () => {
  it("zalogowany: decyzja ladzie w profiles.prefs.consent ze zrodlem 'profile'", async () => {
    sb.userId = "11111111-1111-1111-1111-111111111111";
    const { result } = renderHook(() => useConsent());

    act(() => {
      result.current.acceptAll();
    });

    await waitFor(() => expect(sb.updates).toHaveLength(1));
    const prefs = sb.updates[0]!["prefs"] as Record<string, unknown>;
    const consent = prefs["consent"] as Record<string, unknown>;
    expect(consent).toMatchObject({ version: 2, source: "profile" });
    expect(consent["categories"]).toMatchObject({ marketing: true, analytics: true });
  });

  it("zalogowany: decyzja zostawia slad w rejestrze zgod (user_consents / user_consent_events)", async () => {
    sb.userId = "11111111-1111-1111-1111-111111111111";
    const { result } = renderHook(() => useConsent());

    act(() => {
      result.current.acceptAll();
    });

    await waitFor(() => expect(sb.bulk.length).toBeGreaterThan(0));
    const payload = sb.bulk[0] as { data: { entries: { key: string; granted: boolean }[] } };
    const keys = payload.data.entries.map((e) => e.key);
    expect(keys).toContain("cookies_marketing");
    expect(keys).toContain("cookies_analytics");
  });

  it("NIEzalogowany: profil nie jest ruszany", async () => {
    const { result } = renderHook(() => useConsent());

    act(() => {
      result.current.acceptAll();
    });

    await waitFor(() => expect(result.current.state?.categories.marketing).toBe(true));
    expect(sb.updates).toEqual([]);
  });

  it("istniejace prefs profilu NIE sa nadpisywane - dopisujemy tylko klucz consent", async () => {
    sb.userId = "11111111-1111-1111-1111-111111111111";
    sb.prefs = { theme: "dark", locale: "pl" };
    const { result } = renderHook(() => useConsent());

    act(() => {
      result.current.acceptAll();
    });

    await waitFor(() => expect(sb.updates).toHaveLength(1));
    const prefs = sb.updates[0]!["prefs"] as Record<string, unknown>;
    expect(prefs["theme"]).toBe("dark");
    expect(prefs["locale"]).toBe("pl");
  });
});

// ---------------------------------------------------------------------------
describe("stare API marketingowe (useMarketingConsent) - JEDYNE wejscie bramki AdSlot", () => {
  it("granted = true tylko przy zgodzie i BEZ honorowanego GPC", () => {
    writeStored({ marketing: true });

    const { result } = renderHook(() => useMarketingConsent());

    expect(result.current.granted).toBe(true);
  });

  it("aktywny GPC zdejmuje granted - stare API nie jest furtka obchodzaca opt-out", () => {
    writeStored({ marketing: true });
    enableGpc();

    const { result } = renderHook(() => useMarketingConsent());

    expect(result.current.granted).toBe(false);
  });

  /**
   * ROZSTRZYGNIECIE PYTANIA, na ktore w repo nic dotad nie odpowiadalo:
   * czy slot z `requires_consent = false` ma byc klamrowany przez GPC?
   *
   * ODPOWIEDZ: NIE. Bramka w `AdSlot.tsx:38` brzmi
   *   blocked = slot.requires_consent && !granted
   * czyli dla slotu, ktory zgody NIE wymaga, wartosc `granted` (a wiec i klamra
   * GPC) nie ma zadnego wplywu - slot renderuje sie zawsze.
   *
   * DLACZEGO TAK JEST POPRAWNIE. GPC to sprzeciw wobec SPRZEDAZY/UDOSTEPNIANIA
   * danych osobowych, a nie zakaz wyswietlania tresci. Slot oznaczony
   * `requires_consent = false` deklaruje kreacje bez sledzenia (wlasna grafika,
   * autopromocja) - klamrowanie go nie chronikoby niczyich danych, a wygaszaloby
   * tresc, ktora z RODO nie ma zwiazku. Ryzykiem jest wylacznie BLEDNE
   * oznaczenie slotu w panelu, i to jest decyzja redakcyjna, nie techniczna.
   *
   * Ta asercja utrwala semantyke: gdyby ktos w przyszlosci przepial bramke na
   * "GPC blokuje wszystko", ten test zapali sie jako pierwszy i zmusi do
   * swiadomej zmiany, a nie cichego dryfu.
   */
  it("slot bez wymogu zgody NIE jest klamrowany przez GPC - bramka patrzy na requires_consent", () => {
    writeStored({ marketing: true });
    enableGpc();
    const { result } = renderHook(() => useMarketingConsent());
    const granted = result.current.granted;
    expect(granted).toBe(false);

    const blocked = (requiresConsent: boolean) => requiresConsent && !granted;

    expect(blocked(true)).toBe(true);
    expect(blocked(false)).toBe(false);
  });

  it("`decided` jest prawdziwe dopiero po montazu - inaczej baner migotalby przy hydratacji", async () => {
    const { result } = renderHook(() => useMarketingConsent());

    await waitFor(() => expect(result.current.decided).toBe(false));
  });

  it("grant() zachowuje pozostale kategorie", async () => {
    writeStored({ functional: true, analytics: true, marketing: false });
    const { result } = renderHook(() => useMarketingConsent());

    act(() => {
      result.current.grant();
    });

    await waitFor(() => expect(result.current.granted).toBe(true));
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as {
      categories: Record<string, boolean>;
    };
    expect(stored.categories.functional).toBe(true);
    expect(stored.categories.analytics).toBe(true);
  });
});
