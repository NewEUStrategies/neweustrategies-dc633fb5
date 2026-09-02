// Warstwa zgód RODO po stronie klienta (`src/lib/notifications/useConsents.ts`).
//
// Do tej pory CAŁY moduł stał na zerze: 0/50 linii, 0/19 funkcji. To jest
// warstwa, przez którą przechodzi każda decyzja podlegająca art. 7 RODO, więc
// jej niepokrycie oznaczało, że żaden inwariant audytu nie był pilnowany
// maszynowo - ani „klient nie pisze wprost do rejestru", ani znaczenie kolumny
// `gpc`, ani klamra sygnału na wartości EFEKTYWNEJ.
//
// Zero danych osobowych w fixture'ach: identyfikatory są syntetyczne
// (`u-1`), adresów e-mail tu nie ma wcale.
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseFromStub } from "@/test/supabase";
import { CONSENT_CATALOG } from "@/lib/notifications/consentCatalog";

const h = vi.hoisted(() => ({
  user: { current: { id: "u-1" } as { id: string } | null },
  /** Czy przeglądarka WYSYŁA sygnał Global Privacy Control. */
  gpcActive: { current: false },
  /** Czy sygnał jest HONOROWANY (aktywny i bez świadomego override'u). */
  gpcHonored: { current: false },
  listMyConsents: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMyConsentEvents: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  setMyConsent: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

// `useServerFn` w teście jest tożsamością: przedmiotem dowodu jest TO, KTÓRA
// server-fn zostaje wywołana i z jakim ładunkiem, a nie transport TanStack Start.
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user.current }) }));

vi.mock("@/lib/ads/consent", () => ({
  useGpcSignal: () => ({
    active: h.gpcActive.current,
    source: h.gpcActive.current ? "navigator" : "none",
  }),
  useGpcHonored: () => h.gpcHonored.current,
}));

vi.mock("@/lib/consents.functions", () => ({
  listMyConsents: (...args: unknown[]) => h.listMyConsents(...args),
  listMyConsentEvents: (...args: unknown[]) => h.listMyConsentEvents(...args),
  setMyConsent: (...args: unknown[]) => h.setMyConsent(...args),
}));

// Atrapa klienta PostgREST istnieje TYLKO po to, żeby złapać regresję
// architektury: gdyby ktoś dopisał tu zapis wprost do `user_consents`, atrapa
// zapisze łańcuch, a asercje „zero łańcuchów" zgasną.
const stub = supabaseFromStub();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

import {
  buildConsentViews,
  useIsConsentGiven,
  useMyConsentEvents,
  useMyConsents,
  useSetMyConsent,
  useToggleConsent,
  type ConsentStateRow,
} from "../useConsents";

function row(over: Partial<ConsentStateRow> & { consent_key: string }): ConsentStateRow {
  return {
    given: true,
    version: "1.0",
    lang: "pl",
    gpc: false,
    given_at: "2026-08-01T10:00:00.000Z",
    withdrawn_at: null,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Ładunek przekazany do server-fn `setMyConsent` (jedyna droga do rejestru). */
function lastSetConsentPayload(): Record<string, unknown> {
  const call = h.setMyConsent.mock.calls.at(-1);
  const arg = call?.[0];
  if (!isRecord(arg) || !isRecord(arg.data)) {
    throw new Error("test: setMyConsent nie dostał ładunku w kształcie { data: {...} }");
  }
  return arg.data;
}

beforeEach(() => {
  stub.reset();
  h.user.current = { id: "u-1" };
  h.gpcActive.current = false;
  h.gpcHonored.current = false;
  h.listMyConsents.mockReset();
  h.listMyConsents.mockResolvedValue([]);
  h.listMyConsentEvents.mockReset();
  h.listMyConsentEvents.mockResolvedValue([]);
  h.setMyConsent.mockReset();
  h.setMyConsent.mockResolvedValue(null);
});

describe("buildConsentViews - kolejność i stan", () => {
  // Kolejność katalogu JEST treścią prawną: użytkownik czyta zgody w porządku,
  // w którym są opisane. Sortowanie po kluczu albo po danych z bazy rozjechałoby
  // panel z dokumentem polityki prywatności.
  it("zwraca pozycje w kolejności CONSENT_CATALOG, także dla pustego rejestru", () => {
    const views = buildConsentViews([], false);
    expect(views.map((v) => v.definition.key)).toEqual(CONSENT_CATALOG.map((c) => c.key));
  });

  it("nieokreślone wejście (jeszcze nie wczytane) też daje pełną listę", () => {
    const views = buildConsentViews(undefined, false);
    expect(views).toHaveLength(CONSENT_CATALOG.length);
    expect(views.every((v) => v.state === null)).toBe(true);
  });

  // `isCurrent` steruje ostrzeżeniem „nowa wersja zgody". Gdyby ignorował
  // wersję, bump treści prawnej nigdy nie poprosiłby o ponowną decyzję.
  it("isCurrent tylko przy zgodnej wersji", () => {
    const current = buildConsentViews([row({ consent_key: "marketing_email", version: "1.0" })]);
    const stale = buildConsentViews([row({ consent_key: "marketing_email", version: "0.9" })]);
    expect(current.find((v) => v.definition.key === "marketing_email")?.isCurrent).toBe(true);
    expect(stale.find((v) => v.definition.key === "marketing_email")?.isCurrent).toBe(false);
  });

  // Zgoda `required` (wiadomości transakcyjne) jest podstawą działania serwisu -
  // wiersz mówiący „nie" nie może jej wyłączyć, bo użytkownik przestałby
  // dostawać np. resetu hasła.
  it("required wymusza declared = true nawet wbrew wierszowi z bazy", () => {
    const views = buildConsentViews([row({ consent_key: "transactional", given: false })]);
    const transactional = views.find((v) => v.definition.key === "transactional");
    expect(transactional?.definition.required).toBe(true);
    expect(transactional?.effectiveGiven).toBe(true);
    // Rejestr zostaje wierny: widok nie przepisuje zapisanej wartości.
    expect(transactional?.state?.given).toBe(false);
  });

  // Brak decyzji != „nie" dla wszystkich: katalog może mieć `defaultGiven`.
  it("brak wiersza spada na defaultGiven, a bez niego na false", () => {
    const views = buildConsentViews([], false);
    expect(views.find((v) => v.definition.key === "marketing_email")?.effectiveGiven).toBe(false);
    expect(views.find((v) => v.definition.key === "marketing_email")?.state).toBeNull();
    // `transactional` ma defaultGiven: true w katalogu.
    expect(views.find((v) => v.definition.key === "transactional")?.effectiveGiven).toBe(true);
  });
});

describe("buildConsentViews - klamra GPC", () => {
  // NAJWAŻNIEJSZA RÓŻNICA TEJ FUNKCJI: klamra działa na wartości EFEKTYWNEJ,
  // a NIE na zapisanym stanie. Rejestr `user_consents` ma pozostać wiernym
  // śladem decyzji (audytor musi widzieć, że użytkownik kiedyś powiedział
  // „tak"), a UI ma pokazywać, co realnie obowiązuje dzisiaj.
  it("klamruje wartość efektywną, ale NIE dotyka zapisanego stanu", () => {
    const views = buildConsentViews([row({ consent_key: "cookies_analytics", given: true })], true);
    const analytics = views.find((v) => v.definition.key === "cookies_analytics");
    expect(analytics?.effectiveGiven).toBe(false);
    expect(analytics?.gpcClamped).toBe(true);
    expect(analytics?.state?.given).toBe(true);
  });

  it("klamruje wszystkie trzy klucze z GPC_CLAMPED_REGISTRY_KEYS", () => {
    const rows = [
      row({ consent_key: "cookies_analytics", given: true, version: "2.0" }),
      row({ consent_key: "cookies_marketing", given: true, version: "2.0" }),
      row({ consent_key: "personalization", given: true }),
    ];
    const views = buildConsentViews(rows, true);
    for (const key of ["cookies_analytics", "cookies_marketing", "personalization"]) {
      expect(views.find((v) => v.definition.key === key)?.effectiveGiven).toBe(false);
    }
  });

  // `functional` to first-party preferencje UI - GPC ich NIE dotyczy. Gdyby
  // klamra była globalna, sygnał opt-outu psułby motyw i układ bez korzyści
  // prywatnościowej.
  it("nie klamruje cookies_functional ani zwykłych zgód komunikacyjnych", () => {
    const rows = [
      row({ consent_key: "cookies_functional", given: true, version: "2.0" }),
      row({ consent_key: "marketing_email", given: true }),
    ];
    const views = buildConsentViews(rows, true);
    expect(views.find((v) => v.definition.key === "cookies_functional")?.effectiveGiven).toBe(true);
    expect(views.find((v) => v.definition.key === "marketing_email")?.effectiveGiven).toBe(true);
  });

  // `gpcClamped` znaczy „deklaracja była TAK, a obowiązuje NIE". Odmowa
  // użytkownika nie jest skutkiem sygnału i nie może dostać znacznika GPC -
  // inaczej UI przypisywałby przeglądarce cudzą decyzję.
  it("gpcClamped jest prawdą DOKŁADNIE gdy deklaracja tak, a efekt nie", () => {
    const declaredNo = buildConsentViews(
      [row({ consent_key: "cookies_analytics", given: false, version: "2.0" })],
      true,
    );
    expect(declaredNo.find((v) => v.definition.key === "cookies_analytics")?.gpcClamped).toBe(
      false,
    );

    const notHonored = buildConsentViews(
      [row({ consent_key: "cookies_analytics", given: true, version: "2.0" })],
      false,
    );
    const view = notHonored.find((v) => v.definition.key === "cookies_analytics");
    expect(view?.gpcClamped).toBe(false);
    expect(view?.effectiveGiven).toBe(true);
  });

  // Klamra bije też domyślne „tak" z katalogu, nie tylko zapisane wiersze.
  it("klamra działa również na wartości domyślnej, bez żadnego wiersza", () => {
    const views = buildConsentViews([], true);
    expect(views.find((v) => v.definition.key === "personalization")?.effectiveGiven).toBe(false);
  });
});

describe("useMyConsents / useMyConsentEvents", () => {
  it("czyta rejestr przez server-fn listMyConsents", async () => {
    h.listMyConsents.mockResolvedValue([row({ consent_key: "marketing_email" })]);
    const { result } = renderHookWithQueryClient(() => useMyConsents());
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(h.listMyConsents).toHaveBeenCalledTimes(1);
  });

  // Gość nie ma rejestru zgód powiązanego z kontem - zapytanie bez sesji
  // dostałoby 401 i zaśmiecało konsolę przy każdym otwarciu panelu.
  it("gość nie odpytuje serwera wcale", () => {
    h.user.current = null;
    const { result } = renderHookWithQueryClient(() => useMyConsents());
    expect(result.current.fetchStatus).toBe("idle");
    expect(h.listMyConsents).not.toHaveBeenCalled();
  });

  // Domyślne 100 jest kontraktem sygnatury: panel woła `useMyConsentEvents(50)`,
  // ale inni konsumenci polegają na domyślce - jej zmiana po cichu przycięłaby
  // historię audytu widzianą przez użytkownika.
  it("bez argumentu prosi o domyślne 100 wpisów historii", async () => {
    const { result } = renderHookWithQueryClient(() => useMyConsentEvents());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.listMyConsentEvents).toHaveBeenCalledWith({ data: { limit: 100 } });
  });

  // Limit jest częścią klucza cache'u i musi dojechać do server-fn - inaczej
  // panel prosiłby o 50 wpisów, a dostawał domyślne 100.
  it("przekazuje limit do listMyConsentEvents", async () => {
    h.listMyConsentEvents.mockResolvedValue([]);
    const { result } = renderHookWithQueryClient(() => useMyConsentEvents(50));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.listMyConsentEvents).toHaveBeenCalledWith({ data: { limit: 50 } });
  });
});

describe("useMyConsentEvents - bez sesji", () => {
  // Historia zgód jest przypisana do konta. Gość nie ma czego czytać, a klucz
  // cache'u musi mimo to być stabilny („anon"), żeby po zalogowaniu nie doszło
  // do sklejenia dwóch różnych kubełków w jeden.
  it("gość nie odpytuje historii", () => {
    h.user.current = null;
    const { result } = renderHookWithQueryClient(() => useMyConsentEvents(50));
    expect(result.current.fetchStatus).toBe("idle");
    expect(h.listMyConsentEvents).not.toHaveBeenCalled();
  });
});

describe("useSetMyConsent - jedyna droga do rejestru", () => {
  // INWARIANT ARCHITEKTURY: klient NIGDY nie pisze wprost do `user_consents`.
  // Wszystko idzie przez server-fn `setMyConsent`, która woła RPC
  // `set_user_consent` - to ono atomowo aktualizuje stan I dopisuje wpis
  // audit-logu z IP oraz User-Agent czytanymi po stronie serwera. Zapis
  // bezpośredni dałby zgodę bez śladu w audycie, czyli zgodę niedowodliwą.
  it("woła server-fn setMyConsent i NIE dotyka tabeli user_consents", async () => {
    const { result } = renderHookWithQueryClient(() => useSetMyConsent());
    await act(async () => {
      await result.current.mutateAsync({ key: "marketing_email", given: true, version: "1.0" });
    });
    expect(h.setMyConsent).toHaveBeenCalledTimes(1);
    expect(stub.chainsFor("user_consents")).toHaveLength(0);
    expect(stub.chains).toHaveLength(0);
  });

  // TO JEST NAJWAŻNIEJSZY TEST TEJ PACZKI.
  //
  // Kolumna `gpc` zapisuje AKTYWNOŚĆ sygnału Global Privacy Control, nie jego
  // honorowanie. Zgoda udzielona jako świadomy override MUSI mieć `gpc: true`
  // w ładunku - bo właśnie ona jest wyjątkiem wymagającym uzasadnienia przed
  // audytorem: „przeglądarka wysyłała opt-out, a mimo to zapisano zgodę".
  // Gdyby ładunek niósł honorowanie zamiast aktywności, override zapisywałby
  // się jako `gpc: false` i audyt nie umiałby odpowiedzieć na pytanie, czy
  // zgoda padła wbrew sygnałowi.
  it("świadomy override przy AKTYWNYM sygnale wysyła gpc: true razem z given: true", async () => {
    h.gpcActive.current = true;
    h.gpcHonored.current = false; // sygnał aktywny, ale nadpisany - honorowanie NIE
    const { result } = renderHookWithQueryClient(() => useSetMyConsent());
    await act(async () => {
      await result.current.mutateAsync({ key: "personalization", given: true, version: "1.0" });
    });
    const payload = lastSetConsentPayload();
    expect(payload.given).toBe(true);
    expect(payload.gpc).toBe(true);
  });

  it("bez sygnału ładunek niesie gpc: false", async () => {
    const { result } = renderHookWithQueryClient(() => useSetMyConsent());
    await act(async () => {
      await result.current.mutateAsync({ key: "personalization", given: true, version: "1.0" });
    });
    expect(lastSetConsentPayload().gpc).toBe(false);
  });

  it("przekazuje dalej klucz, wersję, język i źródło bez zmian", async () => {
    const { result } = renderHookWithQueryClient(() => useSetMyConsent());
    await act(async () => {
      await result.current.mutateAsync({
        key: "newsletter_digest",
        given: false,
        version: "1.0",
        lang: "en",
        source: "notifications_center",
      });
    });
    expect(lastSetConsentPayload()).toEqual({
      key: "newsletter_digest",
      given: false,
      version: "1.0",
      lang: "en",
      source: "notifications_center",
      gpc: false,
    });
  });
});

describe("useSetMyConsent - optymistyczny onMutate", () => {
  it("dopisuje NOWY wpis na koniec listy", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    queryClient.setQueryData(
      ["user-consents", "u-1"],
      [row({ consent_key: "marketing_email", given: true })],
    );
    await act(async () => {
      await result.current.mutateAsync({ key: "product_updates", given: true, version: "1.0" });
    });
    const next = queryClient.getQueryData<ConsentStateRow[]>(["user-consents", "u-1"]);
    expect(next?.map((r) => r.consent_key)).toEqual(["marketing_email", "product_updates"]);
  });

  // PODMIANA w miejscu, nie duplikat: dwa wiersze o tym samym kluczu dałyby
  // dwa przełączniki dla jednej zgody i wynik zależny od kolejności.
  it("podmienia istniejący wpis w miejscu i zachowuje lang, gdy go nie podano", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    queryClient.setQueryData(
      ["user-consents", "u-1"],
      [row({ consent_key: "marketing_email", given: false, lang: "en" })],
    );
    await act(async () => {
      await result.current.mutateAsync({ key: "marketing_email", given: true, version: "1.0" });
    });
    const next = queryClient.getQueryData<ConsentStateRow[]>(["user-consents", "u-1"]);
    expect(next).toHaveLength(1);
    expect(next?.[0].given).toBe(true);
    expect(next?.[0].lang).toBe("en");
  });

  it("jawny lang w ładunku wygrywa z poprzednim wierszem", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    queryClient.setQueryData(
      ["user-consents", "u-1"],
      [row({ consent_key: "marketing_email", lang: "en" })],
    );
    await act(async () => {
      await result.current.mutateAsync({
        key: "marketing_email",
        given: true,
        version: "1.0",
        lang: "pl",
      });
    });
    const next = queryClient.getQueryData<ConsentStateRow[]>(["user-consents", "u-1"]);
    expect(next?.[0].lang).toBe("pl");
  });

  it("given: true stempluje given_at i zeruje withdrawn_at", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    queryClient.setQueryData(
      ["user-consents", "u-1"],
      [
        row({
          consent_key: "marketing_email",
          given: false,
          given_at: null,
          withdrawn_at: "2026-07-01T09:00:00.000Z",
        }),
      ],
    );
    await act(async () => {
      await result.current.mutateAsync({ key: "marketing_email", given: true, version: "1.0" });
    });
    const next = queryClient.getQueryData<ConsentStateRow[]>(["user-consents", "u-1"]);
    expect(next?.[0].withdrawn_at).toBeNull();
    expect(typeof next?.[0].given_at).toBe("string");
    expect(next?.[0].given_at).not.toBe("2026-07-01T09:00:00.000Z");
  });

  // Wycofanie NIE kasuje daty udzielenia: audyt musi widzieć OBA znaczniki,
  // inaczej z rejestru znika informacja, że zgoda kiedykolwiek obowiązywała.
  it("given: false stempluje withdrawn_at i ZACHOWUJE poprzednie given_at", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    queryClient.setQueryData(
      ["user-consents", "u-1"],
      [row({ consent_key: "marketing_email", given: true, given_at: "2026-06-01T08:00:00.000Z" })],
    );
    await act(async () => {
      await result.current.mutateAsync({ key: "marketing_email", given: false, version: "1.0" });
    });
    const next = queryClient.getQueryData<ConsentStateRow[]>(["user-consents", "u-1"]);
    expect(next?.[0].given_at).toBe("2026-06-01T08:00:00.000Z");
    expect(typeof next?.[0].withdrawn_at).toBe("string");
  });

  it("optymistyczny wiersz niesie aktywność sygnału GPC", async () => {
    h.gpcActive.current = true;
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    queryClient.setQueryData(["user-consents", "u-1"], []);
    await act(async () => {
      await result.current.mutateAsync({ key: "personalization", given: true, version: "1.0" });
    });
    const next = queryClient.getQueryData<ConsentStateRow[]>(["user-consents", "u-1"]);
    expect(next?.[0].gpc).toBe(true);
  });

  // Nieudany zapis MUSI cofnąć podgląd: użytkownik, który widzi „zgoda
  // udzielona" po błędzie serwera, jest wprowadzony w błąd co do stanu
  // prawnego swoich danych.
  it("onError przywraca snapshot sprzed mutacji", async () => {
    h.setMyConsent.mockRejectedValue(new Error("rpc failed"));
    const snapshot = [row({ consent_key: "marketing_email", given: false })];
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    queryClient.setQueryData(["user-consents", "u-1"], snapshot);
    await act(async () => {
      await expect(
        result.current.mutateAsync({ key: "marketing_email", given: true, version: "1.0" }),
      ).rejects.toThrow("rpc failed");
    });
    expect(queryClient.getQueryData(["user-consents", "u-1"])).toEqual(snapshot);
  });

  // Brak snapshotu (pierwsze wejście, cache jeszcze pusty) NIE MOŻE wywalić
  // `onError`: odczyt `ctx?.prev` jest jedynym miejscem, w którym ta gałąź się
  // rozstrzyga, a wyjątek w niej zjadłby oryginalny błąd zapisu.
  it("onError bez snapshotu nie wywraca obsługi błędu", async () => {
    h.setMyConsent.mockRejectedValue(new Error("rpc failed"));
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    await act(async () => {
      await expect(
        result.current.mutateAsync({ key: "marketing_email", given: true, version: "1.0" }),
      ).rejects.toThrow("rpc failed");
    });
    const next = queryClient.getQueryData<ConsentStateRow[]>(["user-consents", "u-1"]);
    expect(next?.map((r) => r.consent_key)).toEqual(["marketing_email"]);
  });

  // OBA klucze, nie jeden: stan bez historii pokazałby świeży przełącznik nad
  // listą zdarzeń, w której brakuje właśnie podjętej decyzji.
  it("onSettled unieważnia stan ORAZ historię zdarzeń", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({ key: "marketing_email", given: true, version: "1.0" });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-consents", "u-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-consent-events", "u-1"] });
  });

  it("onSettled unieważnia także po błędzie zapisu", async () => {
    h.setMyConsent.mockRejectedValue(new Error("rpc failed"));
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await expect(
        result.current.mutateAsync({ key: "marketing_email", given: true, version: "1.0" }),
      ).rejects.toThrow("rpc failed");
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-consent-events", "u-1"] });
  });
});

describe("useSetMyConsent - kubełek cache bez sesji", () => {
  // Bez sesji klucz cache'u to „anon", a nie `undefined`. Klucz z `undefined`
  // scaliłby optymistyczny stan gościa z kubełkiem, do którego po zalogowaniu
  // trafia rejestr konkretnej osoby - czyli cudze zgody w cudzym widoku.
  it("gość pisze do kubełka „anon”, nie do kubełka użytkownika", async () => {
    h.user.current = null;
    const { result, queryClient } = renderHookWithQueryClient(() => useSetMyConsent());
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({ key: "marketing_email", given: true, version: "1.0" });
    });
    const anon = queryClient.getQueryData<ConsentStateRow[]>(["user-consents", "anon"]);
    expect(anon?.map((r) => r.consent_key)).toEqual(["marketing_email"]);
    expect(queryClient.getQueryData(["user-consents", "u-1"])).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-consent-events", "anon"] });
  });
});

describe("useIsConsentGiven", () => {
  // `undefined` to trzeci stan, nie „nie": konsument personalizacji musi umieć
  // odróżnić „jeszcze nie wiem" od „użytkownik odmówił", inaczej pierwszy
  // render zawsze wyglądałby jak odmowa.
  it("zwraca undefined, dopóki rejestr się nie wczytał", () => {
    h.user.current = null;
    const { result } = renderHookWithQueryClient(() => useIsConsentGiven("marketing_email"));
    expect(result.current).toBeUndefined();
  });

  it("po wczytaniu zwraca zapisaną wartość", async () => {
    h.listMyConsents.mockResolvedValue([row({ consent_key: "marketing_email", given: true })]);
    const { result } = renderHookWithQueryClient(() => useIsConsentGiven("marketing_email"));
    await waitFor(() => expect(result.current).toBe(true));
  });

  // Wartość EFEKTYWNA, nie zapisana: to jest cały sens tego helpera - miejsca
  // wywołania nie muszą pamiętać o klamrze GPC.
  it("zwraca wartość efektywną, więc honorowany sygnał GPC daje false", async () => {
    h.gpcHonored.current = true;
    h.listMyConsents.mockResolvedValue([row({ consent_key: "personalization", given: true })]);
    const { result } = renderHookWithQueryClient(() => useIsConsentGiven("personalization"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("nieznany klucz daje undefined, a nie wyjątek", async () => {
    h.listMyConsents.mockResolvedValue([]);
    const { result } = renderHookWithQueryClient(() => useIsConsentGiven("nie_ma_takiej_zgody"));
    await waitFor(() => expect(h.listMyConsents).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});

describe("useToggleConsent", () => {
  // Literówka w kluczu ma paść GŁOŚNO. Cichy no-op zostawiłby przełącznik,
  // który klika się bez skutku i bez śladu w audycie.
  it("nieznany klucz rzuca z nazwą klucza w komunikacie", () => {
    const { result } = renderHookWithQueryClient(() => useToggleConsent());
    expect(() => result.current("nie_ma_takiej_zgody", true)).toThrow(
      "Unknown consent key: nie_ma_takiej_zgody",
    );
    expect(h.setMyConsent).not.toHaveBeenCalled();
  });

  // Zgody `required` nie da się wycofać - i próba nie może dojść do serwera,
  // bo w audycie zostałby ślad wycofania, które nigdy nie weszło w życie.
  it("próba wycofania zgody required zwraca null i NIE woła mutacji", async () => {
    const { result } = renderHookWithQueryClient(() => useToggleConsent());
    await expect(result.current("transactional", false)).resolves.toBeNull();
    expect(h.setMyConsent).not.toHaveBeenCalled();
  });

  it("required z given: true nadal przechodzi do zapisu", async () => {
    const { result } = renderHookWithQueryClient(() => useToggleConsent());
    await act(async () => {
      await result.current("transactional", true);
    });
    expect(lastSetConsentPayload().key).toBe("transactional");
  });

  // Wersja pochodzi z KATALOGU, nie od wołającego - dzięki temu bump treści
  // prawnej nie wymaga tknięcia ani jednego miejsca wywołania.
  it("dokleja wersję z katalogu, a nie z argumentów", async () => {
    const cookiesMarketing = CONSENT_CATALOG.find((c) => c.key === "cookies_marketing");
    const { result } = renderHookWithQueryClient(() => useToggleConsent());
    await act(async () => {
      await result.current("cookies_marketing", true, "en");
    });
    const payload = lastSetConsentPayload();
    expect(payload.version).toBe(cookiesMarketing?.version);
    expect(payload.version).toBe("2.0");
    expect(payload.lang).toBe("en");
  });
});
