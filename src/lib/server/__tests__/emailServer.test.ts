// WYSYŁKA TRANSAKCYJNA: `sendTransactionalEmail` z `src/lib/server/email.server.ts`
// razem z prywatnym `isPermanentlySuppressed`.
//
// PO CO TEN PLIK ISTNIEJE. To wspólny nadawca poczty transakcyjnej - zaproszeń,
// potwierdzeń, powiadomień organizacji. Do 04.09.2026 moduł miał 0/27 linii
// i 0/4 FUNKCJI pokrycia. Zera nie tłumaczy brak testów wokół:
// `sendTransactionalEmail` występuje w repo jako cel atrapy (2 pliki), więc
// sprawdzone jest, KTO woła nadawcę, i nic nie sprawdza, CO nadawca robi.
// To pytanie „czy wiadomość wyszła" - zadawane zawsze po fakcie i zawsze
// wtedy, gdy odpowiedź już nic nie zmienia.
//
// CO JEST PRZEDMIOTEM DOWODU:
//   1. brak konfiguracji (`LOVABLE_API_KEY` / `RESEND_API_KEY`) kończy się
//      `email_not_configured` BEZ dotknięcia sieci,
//   2. TRWAŁA blokada dostarczalności zatrzymuje wysyłkę - to jedna gałąź,
//      od której zależy reputacja domeny dla WSZYSTKICH wysyłek, także
//      krytycznych,
//   3. blokada CZASOWA (soft bounce) świadomie PRZEPUSZCZA - ta asymetria jest
//      wprost opisana w nagłówku modułu (:9-15) i do dziś nie miała dowodu,
//   4. bez `tenantId` lista wykluczeń nie jest w ogóle czytana,
//   5. adres normalizowany (trim + lowercase) przy sprawdzaniu blokady,
//   6. sprawdzenie blokady jest FAIL-OPEN: awaria listy nie może zablokować
//      poczty,
//   7. sukces zwraca `messageId` (po `trim()`), a odpowiedź nie-JSON albo bez
//      `id` NIE unieważnia wysyłki,
//   8. porażka bramki zwraca `status` i ciało PRZYCIĘTE do 500 znaków,
//   9. rzut z `fetch` zwraca przycięty komunikat, nie wyjątek do wołającego,
//  10. kształt żądania: dwa nagłówki uwierzytelniające, domyślny nadawca,
//      mapowanie tagów i puste kolekcje jako `undefined`.
//
// `isPermanentlySuppressed` NIE JEST EKSPORTOWANE i jest pokryte wyłącznie
// przez `sendTransactionalEmail` z podanym `tenantId` - czyli tak, jak biegnie
// w produkcji. Testowanie go inaczej wymagałoby otwarcia go „dla testu",
// a wtedy dowód dotyczyłby innego kodu niż ten, który wysyła pocztę.
//
// ŻADEN TEST NIE WYCHODZI DO SIECI I NIE WYSYŁA POCZTY. Globalny `fetch` jest
// atrapą w KAŻDYM przypadku (`vi.stubGlobal` w `beforeEach`), a klucze to
// jawne wartości testowe. Adresy: wyłącznie domeny zarezerwowane
// (`example.com` / `example.org`), bez prawdziwych nazwisk - RODO.
//
// GRANICE, KTÓRE ATRAPUJEMY, I DLACZEGO:
//   * globalny `fetch` - to granica sieci, jedyny sposób udowodnienia
//     „zapytanie NIE poszło",
//   * `@/integrations/supabase/client.server` (`supabaseAdmin`) - klient
//     service-role; atrapa jest tu ZNACZNIKIEM TOŻSAMOŚCI, bo dowodzimy, że
//     lista wykluczeń czytana jest właśnie tym klientem (lista jest
//     tenant-scoped i niedostępna dla klienta użytkownika),
//   * `@/lib/email/suppression.server` (`fetchSuppressedEmails`) - SĄSIEDNI
//     moduł z własnymi testami i z całą logiką RPC; tutaj przedmiotem dowodu
//     jest DECYZJA nadawcy na podstawie jej wyniku.
// PRAWDZIWE zostaje wszystko z `email.server.ts`: odczyt env, decyzja
// o blokadzie, składanie żądania, odczyt `messageId`, przycinanie komunikatów.
// MODUŁU POKRYWANEGO NIE ATRAPUJEMY.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuppressionHit, SuppressionScope } from "@/lib/email/suppression.server";
import {
  sendTransactionalEmail,
  type SendEmailInput,
  type SendEmailResult,
} from "@/lib/server/email.server";

// --- dane syntetyczne (RODO: tylko domeny zarezerwowane, bez nazwisk) -------

/** Klucze są ATRAPAMI - w treści testu nie ma i nie może być sekretu. */
const LOVABLE_KEY = "klucz-lovable-testowy";
const RESEND_KEY = "klucz-resend-testowy";
const GATEWAY = "https://connector-gateway.lovable.dev/resend/emails";
const DEFAULT_FROM = "New European Strategies <onboarding@resend.dev>";
const TENANT = "00000000-0000-4000-8000-0000000000aa";
const TO = "odbiorca@example.com";

const h = vi.hoisted(() => ({
  fetchMock: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
  /**
   * Znacznik tożsamości klienta service-role. Nie udaje klienta Supabase -
   * ma tylko dać się rozpoznać w asercji „lista wykluczeń czytana JEST tym
   * klientem", bo `fetchSuppressedEmails` i tak jest atrapą.
   */
  admin: { marker: "supabase-admin-stub" },
  suppressed:
    vi.fn<
      (
        admin: unknown,
        tenantId: string,
        emails: readonly string[],
      ) => Promise<Map<string, SuppressionHit>>
    >(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.admin }));
vi.mock("@/lib/email/suppression.server", () => ({ fetchSuppressedEmails: h.suppressed }));

// --- narzędzia ---------------------------------------------------------------

/** Minimalny wkład wysyłki - pola, bez których żądanie nie ma sensu. */
function input(overrides: Partial<SendEmailInput> = {}): SendEmailInput {
  return {
    to: TO,
    subject: "Potwierdzenie zgłoszenia",
    html: "<p>Treść testowa</p>",
    ...overrides,
  };
}

function hit(
  email: string,
  scope: SuppressionScope,
  reason: SuppressionHit["reason"],
): SuppressionHit {
  return { email, reason, scope, expiresAt: null };
}

/** Odpowiedź listy wykluczeń kluczowana - jak w produkcji - adresem znormalizowanym. */
function suppressionMap(...hits: SuppressionHit[]): Map<string, SuppressionHit> {
  return new Map(hits.map((entry) => [entry.email, entry]));
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: new Headers({ "content-type": "application/json" }),
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

/** Powierzchnia odpowiedzi, której dotyka nadawca. */
interface ResponseSurface {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

/**
 * STRAŻNIK, nie rzutowanie. `as unknown as Response` przepuściłby atrapę bez
 * `text()`/`json()` - czyli test „przeszedłby" tam, gdzie kod produkcyjny nie
 * miałby czym odczytać odpowiedzi.
 */
function isResponseLike(candidate: ResponseSurface): candidate is ResponseSurface & Response {
  return typeof candidate.text === "function" && typeof candidate.json === "function";
}

/**
 * Odpowiedź błędu, której CIAŁA NIE DA SIĘ odczytać (zerwany strumień). Realny
 * przypadek: bramka zwraca 502 i zamyka połączenie w połowie ciała.
 * Prawdziwego `Response` nie da się w to wprowadzić bez własnego strumienia,
 * więc tu atrapa jest tańsza od wierności - a `.catch(() => "")` w kodzie
 * produkcyjnym istnieje DOKŁADNIE na tę sytuację.
 */
function unreadableResponse(status: number): Response {
  const candidate: ResponseSurface = {
    ok: false,
    status,
    text: () => Promise.reject(new Error("gateway: strumień przerwany")),
    json: () => Promise.reject(new Error("gateway: strumień przerwany")),
  };
  if (!isResponseLike(candidate)) {
    throw new Error("test: atrapa odpowiedzi nie niesie text()/json()");
  }
  return candidate;
}

/**
 * Zawężenie wyniku bez rzutowań. Nieoczekiwany wariant MA być błędem testu
 * z czytelnym komunikatem, a nie cichym `undefined` w asercji.
 */
function failure(result: SendEmailResult): { status?: number; error: string } {
  if (result.ok) {
    throw new Error(`test: oczekiwano porażki, a wysyłka się udała (${String(result.messageId)})`);
  }
  return result;
}

function success(result: SendEmailResult): { messageId: string | null } {
  if (!result.ok) throw new Error(`test: oczekiwano sukcesu, a wysyłka padła: ${result.error}`);
  return result;
}

/** Ciało ostatniego żądania do bramki, odczytane bez rzutowań. */
function lastBody(): Record<string, unknown> {
  const raw = h.fetchMock.mock.calls.at(-1)?.[1]?.body;
  if (typeof raw !== "string") throw new Error("test: ciało żądania nie jest tekstem JSON");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("test: ciało żądania nie jest obiektem JSON");
  }
  return { ...parsed };
}

let errorSpy: ReturnType<typeof vi.spyOn<Console, "error">>;

beforeEach(() => {
  h.fetchMock.mockReset();
  h.fetchMock.mockResolvedValue(jsonResponse({ id: "msg_domyslny" }));
  h.suppressed.mockReset();
  h.suppressed.mockResolvedValue(suppressionMap());
  vi.stubGlobal("fetch", h.fetchMock);
  vi.stubEnv("LOVABLE_API_KEY", LOVABLE_KEY);
  vi.stubEnv("RESEND_API_KEY", RESEND_KEY);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("brak konfiguracji: odmowa BEZ dotknięcia sieci", () => {
  it("bez `LOVABLE_API_KEY` zwraca `email_not_configured` i nie woła `fetch`", async () => {
    // Kod odpowiedzi nic tu nie dowodzi - dowodem jest LICZBA wywołań `fetch`.
    // Żądanie bez klucza i tak odbiłoby się od bramki, ale zapłacilibyśmy za
    // nie rundą po sieci na każdej ścieżce wysyłki w środowisku bez sekretów
    // (podglądy, testy lokalne, CI).
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    const result = await sendTransactionalEmail(input());
    expect(failure(result).error).toBe("email_not_configured");
    expect(h.fetchMock).toHaveBeenCalledTimes(0);
  });

  it("bez `RESEND_API_KEY` odmowa jest identyczna", async () => {
    // Dwa różne sekrety, jeden komunikat: wołający ma rozpoznać „środowisko
    // nieskonfigurowane", a nie który z dwóch kluczy zgubił.
    vi.stubEnv("RESEND_API_KEY", undefined);
    const result = await sendTransactionalEmail(input());
    expect(failure(result).error).toBe("email_not_configured");
    expect(h.fetchMock).toHaveBeenCalledTimes(0);
  });

  it("brak konfiguracji NIE czyta listy wykluczeń", async () => {
    // Kolejność kroków jest treścią: zapytanie do bazy o adres, którego i tak
    // nie da się obsłużyć, to koszt bez żadnej korzyści.
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    await sendTransactionalEmail(input({ tenantId: TENANT }));
    expect(h.suppressed).toHaveBeenCalledTimes(0);
  });

  it("pusty klucz liczy się jak brak klucza", async () => {
    // `""` jest falsy i MUSI być traktowany jak brak - pusty sekret w env
    // (częsty efekt szablonu deploymentu) nie może udawać konfiguracji.
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await sendTransactionalEmail(input());
    expect(failure(result).error).toBe("email_not_configured");
    expect(h.fetchMock).toHaveBeenCalledTimes(0);
  });
});

describe("lista wykluczeń: jedna gałąź od reputacji domeny", () => {
  it("TRWAŁA blokada zatrzymuje wysyłkę - `recipient_suppressed`, zero żądań", async () => {
    // Twarde odbicie i skarga na spam dotyczą SKRZYNKI, nie treści. Dobijanie
    // się do takiego adresu psuje reputację domeny dla WSZYSTKICH wysyłek -
    // w tym tych, które naprawdę muszą dojść. Dlatego dowodem jest brak
    // żądania, a nie sam kształt wyniku.
    h.suppressed.mockResolvedValue(suppressionMap(hit(TO, "permanent", "hard_bounce")));
    const result = await sendTransactionalEmail(input({ tenantId: TENANT }));
    expect(failure(result).error).toBe("recipient_suppressed");
    expect(h.fetchMock).toHaveBeenCalledTimes(0);
  });

  it("skarga na spam (`complaint`, permanent) też zatrzymuje", async () => {
    // Ten sam wynik z innego powodu: skarga jest najdroższym sygnałem, jaki
    // dostawca notuje przy domenie.
    h.suppressed.mockResolvedValue(suppressionMap(hit(TO, "permanent", "complaint")));
    const result = await sendTransactionalEmail(input({ tenantId: TENANT }));
    expect(failure(result).error).toBe("recipient_suppressed");
    expect(h.fetchMock).toHaveBeenCalledTimes(0);
  });

  it("blokada CZASOWA (soft bounce) PRZEPUSZCZA wysyłkę", async () => {
    // Asymetria opisana w nagłówku modułu (:9-15): pełna skrzynka albo
    // chwilowa odmowa serwera nie waży na reputacji tak jak twarde odbicie,
    // a wiadomość transakcyjna jest ważniejsza niż jedna dodatkowa próba
    // dostarczenia. Bez tego dowodu „na wszelki wypadek" zaostrzone
    // sprawdzenie kasowałoby potwierdzenia płatności na kilka dni.
    h.suppressed.mockResolvedValue(suppressionMap(hit(TO, "transient", "soft_bounce")));
    const result = await sendTransactionalEmail(input({ tenantId: TENANT }));
    expect(success(result).messageId).toBe("msg_domyslny");
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blokada dotycząca INNEGO adresu nie zatrzymuje tej wysyłki", async () => {
    // Dowód, że decyzja czyta wpis dla WŁAŚCIWEGO klucza, a nie „czy lista
    // zwróciła cokolwiek". Pomyłka w tę stronę uciszyłaby całą pocztę
    // najemcy po jednym odbiciu.
    h.suppressed.mockResolvedValue(
      suppressionMap(hit("ktos.inny@example.org", "permanent", "blocked")),
    );
    const result = await sendTransactionalEmail(input({ tenantId: TENANT }));
    expect(success(result).messageId).toBe("msg_domyslny");
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("adres jest normalizowany (trim + lowercase) przy sprawdzaniu blokady", async () => {
    // Lista trzyma adresy znormalizowane, bo unikalność skrzynki jest bez
    // wielkości liter. Gdyby sprawdzenie porównywało adres surowy, wystarczyło
    // wpisać „ Odbiorca@Example.COM " w panelu, żeby ominąć blokadę - i to jest
    // ta obejście, którego nikt nie zauważy, dopóki nie spadnie reputacja.
    h.suppressed.mockResolvedValue(suppressionMap(hit(TO, "permanent", "hard_bounce")));
    const result = await sendTransactionalEmail(
      input({ to: "  Odbiorca@Example.COM  ", tenantId: TENANT }),
    );
    expect(failure(result).error).toBe("recipient_suppressed");
    expect(h.fetchMock).toHaveBeenCalledTimes(0);
  });

  it("lista czytana jest klientem service-role i ZAWĘŻONA najemcą odbiorcy", async () => {
    // Lista wykluczeń jest tenant-scoped: blokada u jednego najemcy nie może
    // uciszać poczty u drugiego. Argumenty wywołania są jedynym miejscem,
    // w którym to widać z tej strony granicy.
    await sendTransactionalEmail(input({ tenantId: TENANT }));
    expect(h.suppressed).toHaveBeenCalledTimes(1);
    expect(h.suppressed).toHaveBeenCalledWith(h.admin, TENANT, [TO]);
  });

  it("bez `tenantId` lista NIE jest w ogóle sprawdzana", async () => {
    // Ścieżki bez kontekstu najemcy (np. wiadomość do operatora platformy)
    // nie mają czym zawęzić zapytania, a zapytanie bez zawężenia albo nic nie
    // zwróci, albo zwróci cudzą blokadę. Świadomie pomijamy sprawdzenie -
    // i to pominięcie ma być widoczne w teście, nie domyślne.
    const result = await sendTransactionalEmail(input());
    expect(h.suppressed).toHaveBeenCalledTimes(0);
    expect(success(result).messageId).toBe("msg_domyslny");
  });

  it("`tenantId: null` liczy się jak brak najemcy", async () => {
    // Typ dopuszcza `null`, więc wołający z opcjonalnym kontekstem przekaże
    // właśnie `null`. Musi wypaść tą samą gałęzią co pominięte pole.
    await sendTransactionalEmail(input({ tenantId: null }));
    expect(h.suppressed).toHaveBeenCalledTimes(0);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sprawdzenie jest FAIL-OPEN: awaria listy loguje błąd i PRZEPUSZCZA pocztę", async () => {
    // Najważniejsza decyzja tej funkcji. Gdyby awaria listy blokowała wysyłkę,
    // jedna niedostępna funkcja RPC uciszyłaby CAŁĄ pocztę transakcyjną
    // platformy - reset hasła włącznie. Cena jest jawna: przy awarii listy
    // możemy wysłać na adres zablokowany, i dlatego awaria MUSI trafić do logu.
    h.suppressed.mockRejectedValue(new Error("rpc: email_filter_suppressed niedostępne"));
    const result = await sendTransactionalEmail(input({ tenantId: TENANT }));
    expect(success(result).messageId).toBe("msg_domyslny");
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "[email] suppression check failed",
    );
  });

  it.fails(
    "DEFEKT: trwała blokada z powodu `unsubscribe` zatrzymuje pocztę TRANSAKCYJNĄ",
    async () => {
      // ZGŁOSZENIE DEFEKTU, nie życzenie. `sendTransactionalEmail` decyduje
      // wyłącznie po `scope === "permanent"` i IGNORUJE `reason`, choć polityka
      // repo ma na to osobną funkcję: `suppressionBlocks` z
      // `src/lib/email/suppressionPolicy.ts` trzyma `unsubscribe` w zbiorze
      // `TRANSACTIONAL_PASS_REASONS` z komentarzem „nie jest oświadczeniem
      // «nie chcę potwierdzeń płatności»; takiej treści nie wolno nam
      // zatrzymać".
      //
      // Ta ścieżka jest OSIĄGALNA: wypis jednym kliknięciem woła
      // `email_unsubscribe_by_token`, ta `email_record_suppression`
      // z `p_reason => 'unsubscribe'`, a SQL nadaje wtedy `scope = 'permanent'`
      // (soft bounce jest jedynym powodem z zakresem czasowym - migracja
      // 20260725123624, sekcja `email_record_suppression`). Skutek: kto wypisał
      // się z newslettera, przestaje dostawać potwierdzenia i resety hasła,
      // a poczta jest odrzucana CICHO - `recipient_suppressed` nigdzie nie
      // trafia do operatora.
      //
      // NIE naprawiam tego pod test (kod produkcyjny jest poza zakresem tego
      // zlecenia). Poprawka to przepuszczenie decyzji przez
      // `suppressionBlocks({ reason, scope, category: "transactional" })`
      // zamiast porównania samego zakresu. Gdy to nastąpi, ten test zmieni
      // się w zielony i trzeba mu zdjąć `.fails`.
      h.suppressed.mockResolvedValue(suppressionMap(hit(TO, "permanent", "unsubscribe")));
      const result = await sendTransactionalEmail(input({ tenantId: TENANT }));
      expect(success(result).messageId).toBe("msg_domyslny");
      expect(h.fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});

describe("sukces: identyfikator wiadomości u dostawcy", () => {
  it("`{ ok: true, messageId }` - identyfikator wyciągnięty z JSON i przycięty", async () => {
    // `messageId` to jedyne, co później pozwala webhookowi dostarczalności
    // przypisać odbicie albo skargę do KONKRETNEJ wysyłki. Bez niego zdarzenie
    // zwrotne jest bezimienne i nie da się go powiązać z najemcą ani z akcją.
    h.fetchMock.mockResolvedValue(jsonResponse({ id: "  msg_0001  " }));
    const result = await sendTransactionalEmail(input());
    expect(success(result).messageId).toBe("msg_0001");
  });

  it("odpowiedź NIE-JSON daje `messageId: null`, ale wysyłka pozostaje udana", async () => {
    // Bramka odpowiada 200 i pustym ciałem. Wiadomość została przyjęta -
    // uznanie tego za porażkę wywołałoby ponowienie i DUBLET u odbiorcy,
    // czyli szkodę większą niż brak identyfikatora.
    h.fetchMock.mockResolvedValue(textResponse("", 200));
    const result = await sendTransactionalEmail(input());
    expect(success(result).messageId).toBeNull();
  });

  it("JSON bez `id` daje `messageId: null` i nadal sukces", async () => {
    h.fetchMock.mockResolvedValue(jsonResponse({ accepted: true }));
    const result = await sendTransactionalEmail(input());
    expect(success(result).messageId).toBeNull();
  });

  it("`id` puste albo z samych spacji daje `null`, nie pusty tekst", async () => {
    // Pusty identyfikator jest gorszy od braku: przechodzi przez kod jako
    // „mam id" i trafia do korelacji zdarzeń jako klucz pasujący do wszystkiego.
    h.fetchMock.mockResolvedValue(jsonResponse({ id: "   " }));
    const result = await sendTransactionalEmail(input());
    expect(success(result).messageId).toBeNull();
  });

  it("`id` nie-tekstowe (liczba) jest ignorowane", async () => {
    // Zmiana typu po stronie bramki nie może wpuścić do naszego modelu
    // wartości, która później zostanie skonkatenowana w zapytanie.
    h.fetchMock.mockResolvedValue(jsonResponse({ id: 12345 }));
    const result = await sendTransactionalEmail(input());
    expect(success(result).messageId).toBeNull();
  });

  it("JSON będący tablicą (nie obiektem) nie unieważnia wysyłki", async () => {
    h.fetchMock.mockResolvedValue(jsonResponse([{ id: "msg_z_tablicy" }]));
    const result = await sendTransactionalEmail(input());
    expect(success(result).messageId).toBeNull();
  });

  it("JSON `null` i JSON będący liczbą nie wywracają odczytu identyfikatora", async () => {
    // `typeof null === "object"`, więc bez osobnego porównania z `null`
    // odczyt `body.id` poleciałby na TypeError - i to wewnątrz `try`, który
    // ma chronić wyłącznie parsowanie. Skutkiem byłaby wysyłka uznana za
    // udaną, ale bez identyfikatora, przy CICHO zjedzonym błędzie programu.
    for (const payload of [null, 42]) {
      h.fetchMock.mockResolvedValue(jsonResponse(payload));
      const result = await sendTransactionalEmail(input());
      expect(success(result).messageId).toBeNull();
    }
  });
});

describe("porażka bramki i awaria sieci: komunikat przycięty, wyjątek nie wychodzi", () => {
  it("`!res.ok` zwraca `status` oraz ciało PRZYCIĘTE do 500 znaków", async () => {
    // Status jest tym, po czym wołający rozpoznaje, czy warto ponowić (5xx)
    // czy nie (4xx). Przycięcie chroni log i bazę przed stroną HTML błędu
    // wklejoną w całości do rekordu wysyłki.
    h.fetchMock.mockResolvedValue(textResponse("x".repeat(600), 422));
    const result = await sendTransactionalEmail(input());
    const problem = failure(result);
    expect(problem.status).toBe(422);
    expect(problem.error).toHaveLength(500);
  });

  it("krótkie ciało błędu jest przekazywane w całości", async () => {
    // Przycięcie nie może zjadać treści, po której rozpoznaje się przyczynę.
    h.fetchMock.mockResolvedValue(textResponse('{"message":"domain not verified"}', 403));
    const result = await sendTransactionalEmail(input());
    expect(failure(result)).toEqual({
      ok: false,
      status: 403,
      error: '{"message":"domain not verified"}',
    });
  });

  it("nieczytelne ciało błędu nadal daje `status` (a nie wyjątek)", async () => {
    // Zerwany strumień odpowiedzi to awaria transportu, nie powód, żeby
    // wywalić wołającego. Zostaje status - najważniejsza część diagnozy.
    h.fetchMock.mockResolvedValue(unreadableResponse(502));
    const result = await sendTransactionalEmail(input());
    expect(failure(result)).toEqual({ ok: false, status: 502, error: "" });
  });

  it("rzut z `fetch` wraca jako wynik, nie jako wyjątek - komunikat przycięty", async () => {
    // Nadawca jest wołany z handlerów, które właśnie zrobiły swoją pracę
    // (utworzyły zaproszenie, zapisały zgłoszenie). Wyjątek z warstwy poczty
    // zamieniłby udaną operację w błąd u klienta, więc awaria sieci MUSI
    // wracać jako `ok: false`.
    h.fetchMock.mockRejectedValue(new Error("y".repeat(600)));
    const result = await sendTransactionalEmail(input());
    const problem = failure(result);
    expect(problem.error).toHaveLength(500);
    expect(problem.error.startsWith("Error: yyy")).toBe(true);
    expect(problem.status).toBeUndefined();
  });

  it("odrzucenie nie-błędem (string) też nie wychodzi na zewnątrz", async () => {
    // `String(err)` obsługuje odrzucenia, które nie są instancją `Error`
    // (zdarza się w warstwach abort/timeout). Brak tej gałęzi kończyłby się
    // „[object Object]" albo wyjątkiem.
    h.fetchMock.mockRejectedValue("gateway timeout");
    const result = await sendTransactionalEmail(input());
    expect(failure(result).error).toBe("gateway timeout");
  });
});

describe("kształt żądania do bramki", () => {
  it("POST na adres bramki z DWOMA nagłówkami uwierzytelniającymi", async () => {
    // Bramka Lovable uwierzytelnia SIEBIE (`Authorization`) i przekazuje
    // klucz konektora Resend (`X-Connection-Api-Key`). Zgubiony drugi nagłówek
    // daje odmowę dopiero u dostawcy - czyli po fakcie i bez wiadomości.
    await sendTransactionalEmail(input());
    const [url, init] = h.fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(GATEWAY);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_KEY}`,
      "X-Connection-Api-Key": RESEND_KEY,
    });
  });

  it("odbiorca idzie jako TABLICA, a temat i treść bez zmian", async () => {
    await sendTransactionalEmail(input({ subject: "Zaproszenie", html: "<p>Cześć</p>" }));
    const body = lastBody();
    expect(body.to).toEqual([TO]);
    expect(body.subject).toBe("Zaproszenie");
    expect(body.html).toBe("<p>Cześć</p>");
  });

  it("nadawca domyślny, gdy `from` nie podany", async () => {
    // Domyślny nadawca jest kontraktem konfiguracji: jego zmiana bez zmiany
    // rekordów DNS domeny kończy się odmową u dostawcy dla WSZYSTKICH
    // wysyłek bez jawnego `from`.
    await sendTransactionalEmail(input());
    expect(lastBody().from).toBe(DEFAULT_FROM);
  });

  it('jawny `from` wygrywa, a `from: ""` wraca do domyślnego', async () => {
    // `||` (nie `??`) jest tu decyzją: pusty tekst z formularza albo z env
    // nie może wysłać wiadomości bez nadawcy.
    await sendTransactionalEmail(input({ from: "Redakcja <redakcja@example.org>" }));
    expect(lastBody().from).toBe("Redakcja <redakcja@example.org>");
    await sendTransactionalEmail(input({ from: "" }));
    expect(lastBody().from).toBe(DEFAULT_FROM);
  });

  it("`tags` mapowane na `[{ name, value }]`", async () => {
    // Tagi są jedynym sposobem skorelowania zdarzeń dostarczalności
    // z najemcą i kanałem po stronie dostawcy - kształt musi być dokładnie
    // taki, jakiego oczekuje Resend.
    await sendTransactionalEmail(input({ tags: { tenant: TENANT, kind: "invitation" } }));
    expect(lastBody().tags).toEqual([
      { name: "tenant", value: TENANT },
      { name: "kind", value: "invitation" },
    ]);
  });

  it("puste `tags` i puste `headers` NIE trafiają do żądania", async () => {
    // Pusta tablica i pusty obiekt to dla dostawcy inna wartość niż brak pola.
    // `undefined` wypada z `JSON.stringify`, więc dowodem jest BRAK klucza.
    await sendTransactionalEmail(input({ tags: {}, headers: {} }));
    const body = lastBody();
    expect("tags" in body).toBe(false);
    expect("headers" in body).toBe(false);
  });

  it("pominięte `tags`/`headers`/`replyTo` też nie tworzą pustych pól", async () => {
    await sendTransactionalEmail(input());
    const body = lastBody();
    expect("tags" in body).toBe(false);
    expect("headers" in body).toBe(false);
    expect("reply_to" in body).toBe(false);
  });

  it("niepuste `headers` przechodzą, a `replyTo` idzie jako `reply_to`", async () => {
    // Nagłówki własne niosą m.in. `List-Unsubscribe`, a nazwa `reply_to`
    // (snake_case) jest kontraktem API dostawcy, nie stylem repo.
    await sendTransactionalEmail(
      input({
        headers: { "List-Unsubscribe": "<https://example.org/wypis>" },
        replyTo: "kontakt@example.org",
      }),
    );
    const body = lastBody();
    expect(body.headers).toEqual({ "List-Unsubscribe": "<https://example.org/wypis>" });
    expect(body.reply_to).toBe("kontakt@example.org");
  });

  it("`replyTo: null` nie tworzy pola `reply_to`", async () => {
    await sendTransactionalEmail(input({ replyTo: null }));
    expect("reply_to" in lastBody()).toBe(false);
  });

  it("jedna wysyłka = JEDNO żądanie (bez ponowień w tej warstwie)", async () => {
    // Ponowienia poczty transakcyjnej są niebezpieczne (dublet u odbiorcy)
    // i świadomie NIE mieszkają tutaj. Gdyby ktoś dołożył pętlę retry, ten
    // test zapali się jako pierwszy i wymusi rozmowę o idempotencji.
    h.fetchMock.mockResolvedValue(textResponse("service unavailable", 503));
    await sendTransactionalEmail(input());
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });
});
