// Zgłoszenia klubowe: kontrakt RPC i mapowanie kodów odmowy - 246 linii,
// zero testów do dziś.
//
// Audyt 14.08, rekomendacja R2: „priorytet w obrębie modułu - ścieżki, które
// dotykają uprawnień i wielodostępności (WEJŚCIE DO KLUBU, role, dokumenty)".
// To jest wejście do klubu, po stronie klienta.
//
// TRZY RZECZY, KTÓRE PSUJĄ SIĘ CICHO:
//
//   1. ZGUBIONE POLE FORMULARZA. Zgłoszenie jedzie jako JEDEN obiekt `p`
//      z dwudziestoma trzema polami przemapowanymi z `camelCase` na `snake_case`.
//      Pole, które przestanie dojeżdżać, nie wywala niczego: RPC dostaje obiekt
//      bez klucza, kolumna przyjmuje wartość domyślną, a komisja czyta
//      zgłoszenie, w którym kandydat „nie podał" czegoś, co wpisał. Nie widzi
//      tego ani `tsc` (jsonb jest luźny), ani przegląd (dwadzieścia trzy
//      podobne wiersze), ani interfejs (formularz mówi „wysłano").
//
//   2. KOLEJNOŚĆ DOPASOWANIA KODÓW ODMOWY. `clubApplyErrorCode` dopasowuje przez
//      `includes` po TABLICY, więc kolejność jest częścią zachowania: gdyby
//      `pro_required` stanął przed `club_tier_too_low`, kandydat z planem PRO,
//      który nie sięga progu wybranego klubu, dostałby komunikat „wymagane
//      członkostwo PRO" - i poszedł kupić plan, który już ma.
//
//   3. WIERSZ KANDYDATA SZERSZY NIŻ POWINIEN. `club_my_applications` oddaje
//      świadomie WĘŻSZY zestaw kolumn niż wiersz admina: `admin_note` jest
//      notatką komisji, nie daną kandydata. To jest zapisane w komentarzu nad
//      typem i nie było zapisane w żadnym warunku.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RpcCall {
  name: string;
  args: Record<string, unknown> | undefined;
}

const sb = vi.hoisted(() => ({
  state: {
    rpcs: [] as RpcCall[],
    data: null as unknown,
    error: null as { message: string } | null,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    async rpc(name: string, args?: Record<string, unknown>) {
      sb.state.rpcs.push({ name, args });
      return { data: sb.state.data, error: sb.state.error };
    },
  },
}));

import { EMPTY_CLUB_APPLY, type ClubApplyValues } from "../applyValidation";
import {
  clubApplicationStatusErrorCode,
  clubApplyErrorCode,
  fetchAdminClubApplicationCounts,
  fetchAdminClubApplications,
  fetchMyClubApplications,
  retryClubApplicationCrmSync,
  setClubApplicationStatus,
  submitClubApplication,
  type ClubApplicationAdminRow,
  type ClubMyApplicationRow,
} from "../applyApi";

/** Zgłoszenie z KAŻDYM polem wypełnione ROZPOZNAWALNĄ wartością. */
const FILLED: ClubApplyValues = {
  firstName: "wart-firstName",
  lastName: "wart-lastName",
  email: "wart-email@example.eu",
  phone: "wart-phone",
  company: "wart-company",
  jobPosition: "wart-jobPosition",
  seniority: "wart-seniority",
  industry: "wart-industry",
  country: "wart-country",
  city: "wart-city",
  linkedinUrl: "wart-linkedinUrl",
  yearsExperience: "wart-yearsExperience",
  expertise: "wart-expertise",
  languages: "wart-languages",
  specialization: "wart-specialization",
  clubId: "wart-clubId",
  motivation: "wart-motivation",
  goals: "wart-goals",
  contribution: "wart-contribution",
  availability: "wart-availability",
  referralSource: "wart-referralSource",
  consent: true,
  marketingConsent: true,
};

function lastRpc(): RpcCall {
  const call = sb.state.rpcs.at(-1);
  if (!call) throw new Error("nie zanotowano żadnego wywołania RPC");
  return call;
}

/** Ładunek `p` z ostatniego wywołania `club_apply_submit`. */
function payload(): Record<string, unknown> {
  const raw = lastRpc().args?.p;
  if (raw === null || typeof raw !== "object") throw new Error("brak obiektu `p` w argumentach");
  return raw as Record<string, unknown>;
}

beforeEach(() => {
  sb.state.rpcs = [];
  sb.state.data = null;
  sb.state.error = null;
});

describe("submitClubApplication - kontrakt ładunku", () => {
  beforeEach(() => {
    sb.state.data = "app-1";
  });

  it("zapis idzie WYŁĄCZNIE przez `club_apply_submit`", async () => {
    // Klient nie pisze do tabeli: twarda bramka progu planu i ślad w CRM
    // powstają w tym RPC. Zmiana nazwy albo dołożenie drugiej drogi zapisu
    // omija oba mechanizmy.
    await submitClubApplication(FILLED, "pl");
    expect(sb.state.rpcs.map((r) => r.name)).toEqual(["club_apply_submit"]);
  });

  it("KAŻDA wartość z formularza dojeżdża do ładunku", async () => {
    // Warunek postawiony po WARTOŚCIACH, nie po nazwach kluczy: interesuje nas
    // to, czy żadna dana kandydata nie wyparowała po drodze, niezależnie od
    // tego, jak nazywa się kolumna. Zgubione pole jest tu widoczne od razu,
    // razem z nazwą pola, które przepadło.
    await submitClubApplication(FILLED, "pl");
    const sent = new Set(Object.values(payload()).map((value) => String(value)));
    const missing: string[] = [];
    for (const [field, value] of Object.entries(FILLED)) {
      if (typeof value !== "string") continue;
      if (!sent.has(value)) missing.push(field);
    }
    expect(missing).toEqual([]);
  });

  it("mapowanie na `snake_case` jest kompletne i dosłowne", async () => {
    await submitClubApplication(FILLED, "pl");
    expect(payload()).toEqual({
      specialization_slug: "wart-specialization",
      club_id: "wart-clubId",
      first_name: "wart-firstName",
      last_name: "wart-lastName",
      email: "wart-email@example.eu",
      phone: "wart-phone",
      company: "wart-company",
      job_position: "wart-jobPosition",
      seniority: "wart-seniority",
      industry: "wart-industry",
      country: "wart-country",
      city: "wart-city",
      linkedin_url: "wart-linkedinUrl",
      years_experience: "wart-yearsExperience",
      expertise: "wart-expertise",
      languages: "wart-languages",
      motivation: "wart-motivation",
      goals: "wart-goals",
      contribution: "wart-contribution",
      availability: "wart-availability",
      referral_source: "wart-referralSource",
      consent: true,
      marketing_consent: true,
      lang: "pl",
    });
  });

  it("specjalizacja jedzie jako `specialization_slug`, nie `specialization`", async () => {
    // Nazwa różni się od nazwy pola w formularzu - to jedno z dwóch miejsc,
    // gdzie mapowanie nie jest mechaniczną zamianą wielkości litery.
    await submitClubApplication(FILLED, "pl");
    expect(payload().specialization_slug).toBe("wart-specialization");
    expect(payload()).not.toHaveProperty("specialization");
  });

  it("DWIE zgody są rozłączne - marketingowa nie może podszywać się pod wymaganą", async () => {
    // Sklejenie tych dwóch pól znaczyłoby zgodę marketingową wymuszoną jako
    // warunek zgłoszenia (albo, w drugą stronę, zgodę na przetwarzanie danych
    // wziętą z pola opcjonalnego). Oba warianty to naruszenie, nie usterka.
    await submitClubApplication({ ...FILLED, consent: true, marketingConsent: false }, "pl");
    expect(payload().consent).toBe(true);
    expect(payload().marketing_consent).toBe(false);
  });

  it("brak zgody marketingowej NIE blokuje wysyłki na tej warstwie", async () => {
    await expect(submitClubApplication({ ...FILLED, marketingConsent: false }, "pl")).resolves.toBe(
      "app-1",
    );
  });

  it("język zgłoszenia jedzie w ładunku - decyduje o języku decyzji komisji", async () => {
    // `lang` steruje językiem powiadomienia o decyzji. Zgubiony znaczy list
    // po polsku do kandydata, który wypełniał formularz po angielsku.
    await submitClubApplication(FILLED, "en");
    expect(payload().lang).toBe("en");
  });

  it("ładunek nie niesie pól, których RPC nie zna", async () => {
    // Nadmiarowy klucz w jsonb nie wywala niczego, ale znaczy, że ktoś dodał
    // pole do formularza i nie dopisał kolumny - dana wygląda na zapisaną,
    // a nie jest.
    await submitClubApplication(FILLED, "pl");
    expect(Object.keys(payload())).toHaveLength(24);
  });

  it("puste pola nieobowiązkowe jadą jako puste napisy, nie jako `undefined`", async () => {
    // `undefined` w jsonb ZNIKA przy serializacji, więc kolumna dostaje wartość
    // domyślną bazy zamiast pustej - a to różnica między „nie podał" i „podał
    // pusto" w raporcie komisji.
    await submitClubApplication({ ...EMPTY_CLUB_APPLY, consent: true }, "pl");
    for (const key of ["city", "linkedin_url", "languages", "contribution", "referral_source"]) {
      expect(payload()[key], key).toBe("");
    }
  });

  it("zwraca identyfikator zgłoszenia jako napis", async () => {
    sb.state.data = 12345;
    await expect(submitClubApplication(FILLED, "pl")).resolves.toBe("12345");
  });

  it("błąd RPC wychodzi jako wyjątek z zachowaną treścią", async () => {
    // Treść jest nośnikiem KODU odmowy - `clubApplyErrorCode` czyta ją niżej.
    // Zamiana na komunikat ogólny odbiera widokowi możliwość nazwania przeszkody.
    sb.state.error = { message: "club_apply_submit: pro_required" };
    await expect(submitClubApplication(FILLED, "pl")).rejects.toThrow("pro_required");
  });
});

describe("clubApplyErrorCode - kolejność dopasowania jest zachowaniem", () => {
  it.each([
    "auth_required",
    "pro_required",
    "club_tier_too_low",
    "consent_required",
    "email_required",
    "motivation_required",
    "specialization_required",
    "years_invalid",
    "duplicate_open",
  ])("rozpoznaje kod %s", (code) => {
    expect(clubApplyErrorCode(`ERROR: ${code} (SQLSTATE P0001)`)).toBe(code);
  });

  it("`club_tier_too_low` NIE jest przechwytywany przez `pro_required`", () => {
    // Rdzeń całego mechanizmu. Dwie różne przeszkody: „nie masz planu PRO"
    // kontra „masz plan, ale ten klub wymaga wyższego". Zamiana wysyła kandydata
    // po plan, który już ma - i to jest zakup, nie tylko zły napis.
    expect(clubApplyErrorCode("club_tier_too_low")).toBe("club_tier_too_low");
  });

  it("komunikat niosący OBA kody rozstrzyga się na rzecz bardziej szczegółowego", () => {
    // Jedyny warunek, który realnie mierzy KOLEJNOŚĆ tablicy: przy dopasowaniu
    // przez `includes` wygrywa ten kod, który stoi w niej wcześniej.
    const message = "club_tier_too_low: plan pro_required for this club";
    expect(clubApplyErrorCode(message)).toBe("club_tier_too_low");
  });

  it("nieznana treść daje `unknown`, nie pierwszy kod z listy", () => {
    // Zapas na `[0]` pokazywałby „zaloguj się" osobie zalogowanej, przy każdej
    // awarii, której nikt nie przewidział.
    for (const message of ["", "500 Internal Server Error", "network error", "null"]) {
      expect(clubApplyErrorCode(message), message).toBe("unknown");
    }
  });

  it("dopasowanie jest wrażliwe na wielkość litery - kody bazy są małymi literami", () => {
    // Świadome: `includes` bez normalizacji. Gdyby baza zaczęła zwracać wersaliki,
    // ten warunek pokaże to od razu, zamiast pozwolić na ciche `unknown`.
    expect(clubApplyErrorCode("PRO_REQUIRED")).toBe("unknown");
  });

  it("kod otoczony treścią z bazy nadal jest rozpoznawany", () => {
    expect(
      clubApplyErrorCode(
        'new row for relation "club_applications" violates check: duplicate_open detected',
      ),
    ).toBe("duplicate_open");
  });
});

describe("clubApplicationStatusErrorCode", () => {
  it("rozpoznaje `duplicate_open` przy COFANIU decyzji", () => {
    // Indeks częściowy dopuszcza jedno OTWARTE zgłoszenie tej samej osoby
    // w tej samej specjalizacji, więc powrót z `accepted` do `pending` może
    // naruszyć unikalność. Bez nazwania tego kodu operator widzi wyłącznie
    // ogólne „nie udało się zapisać" i nie wie, że przeszkodą jest drugie
    // zgłoszenie tej osoby.
    expect(clubApplicationStatusErrorCode("admin_...: duplicate_open")).toBe("duplicate_open");
  });

  it("wszystko inne to `unknown`", () => {
    for (const message of ["", "23505", "permission denied", "not_found"]) {
      expect(clubApplicationStatusErrorCode(message), message).toBe("unknown");
    }
  });
});

describe("fetchMyClubApplications - wiersz kandydata jest WĘŻSZY od wiersza admina", () => {
  it("czyta RPC bez ŻADNEGO argumentu - zakres daje `auth.uid()`", async () => {
    // Argument zakresu podany z klienta byłby argumentem, który klient może
    // podmienić. Brak argumentu jest tu cechą, nie brakiem.
    sb.state.data = [];
    await fetchMyClubApplications();
    expect(lastRpc().name).toBe("club_my_applications");
    expect(lastRpc().args).toBeUndefined();
  });

  it("pusta odpowiedź daje pustą listę, nie `null`", async () => {
    sb.state.data = null;
    await expect(fetchMyClubApplications()).resolves.toEqual([]);
  });

  it("typ wiersza kandydata NIE ma `admin_note` (kontrakt na poziomie typów)", () => {
    // Notatka komisji nie jest daną dostarczoną przez osobę i nie ma prawa
    // wrócić do kandydata. Ten warunek trzyma to na poziomie TYPU: przypisanie
    // niżej przestanie się kompilować w chwili, w której ktoś dopisze
    // `admin_note` do `ClubMyApplicationRow`.
    const candidate: ClubMyApplicationRow = {
      id: "app-1",
      created_at: "2026-08-14T09:00:00.000Z",
      specialization_slug: "energy",
      club_id: null,
      club_name_pl: "Klub energetyczny",
      club_name_en: "Energy club",
      status: "pending",
      reviewed_at: null,
    };
    const keys: Array<keyof ClubMyApplicationRow> = Object.keys(candidate) as Array<
      keyof ClubMyApplicationRow
    >;
    expect(keys).not.toContain("admin_note");
    // Kanarek: wiersz admina TĘ kolumnę ma, więc różnica jest realna, a nie
    // efektem tego, że kolumny nie ma nigdzie.
    const adminOnly: keyof ClubApplicationAdminRow = "admin_note";
    expect(adminOnly).toBe("admin_note");
  });

  it("wiersz kandydata niesie nazwę klubu w OBU językach", async () => {
    // Kandydat, który złożył zgłoszenie po polsku, może wrócić na interfejs
    // angielski; jedna nazwa znaczyłaby polską nazwę w angielskim widoku.
    sb.state.data = [
      {
        id: "app-1",
        created_at: "2026-08-14T09:00:00.000Z",
        specialization_slug: "energy",
        club_id: "club-1",
        club_name_pl: "Klub energetyczny",
        club_name_en: "Energy club",
        status: "pending",
        reviewed_at: null,
      },
    ];
    const [row] = await fetchMyClubApplications();
    expect(row.club_name_pl).toBe("Klub energetyczny");
    expect(row.club_name_en).toBe("Energy club");
  });
});

describe("fetchAdminClubApplications - zawężenia panelu", () => {
  beforeEach(() => {
    sb.state.data = [];
  });

  it("przekazuje wszystkie zawężenia pod nazwami RPC", async () => {
    await fetchAdminClubApplications({
      specialization: "energy",
      clubId: "club-1",
      status: "review",
      search: "kowalska",
    });
    expect(lastRpc().name).toBe("admin_club_applications_list");
    expect(lastRpc().args).toMatchObject({
      p_specialization: "energy",
      p_club_id: "club-1",
      p_status: "review",
      p_search: "kowalska",
      p_limit: 200,
    });
  });

  it("brak zawężenia idzie jako `undefined`, nie jako `null`", async () => {
    // `null` byłby WARTOŚCIĄ: `p_status: null` znaczy „status pusty",
    // a `undefined` - „bez zawężenia po statusie". Różnica jest widoczna
    // dopiero w liczbie wierszy, którą nikt nie sprawdza ręcznie.
    await fetchAdminClubApplications({});
    const { args } = lastRpc();
    for (const key of ["p_specialization", "p_club_id", "p_status", "p_search"]) {
      expect(args?.[key], key).toBeUndefined();
    }
  });

  it("brak zawężenia po klubie znaczy WSZYSTKIE kluby tenanta - kontrakt zapisany", async () => {
    // Nie luka: zakres tenanta ustala `assert_admin_tenant()` w RPC. Warunek
    // istnieje po to, żeby nikt nie wziął `p_club_id` za bramkę i nie usunął
    // sprawdzenia tenanta z funkcji.
    await fetchAdminClubApplications({ clubId: null });
    expect(lastRpc().args?.p_club_id).toBeUndefined();
  });

  it("górny limit strony jest ustalony po stronie klienta", async () => {
    await fetchAdminClubApplications({});
    expect(lastRpc().args?.p_limit).toBe(200);
  });

  it("błąd RPC wychodzi jako wyjątek", async () => {
    sb.state.error = { message: "permission denied" };
    await expect(fetchAdminClubApplications({})).rejects.toThrow("permission denied");
  });
});

describe("fetchAdminClubApplicationCounts", () => {
  it("liczniki są zamieniane na liczby - baza oddaje `bigint` jako napis", async () => {
    // `bigint` z Postgresa przychodzi w JSON jako NAPIS. Bez konwersji licznik
    // w interfejsie skleja się tekstowo („12" + 1 = „121"), a sortowanie
    // po nim stawia 9 za 10.
    sb.state.data = [{ specialization_slug: "energy", total: "12", pending: "3" }];
    await expect(fetchAdminClubApplicationCounts()).resolves.toEqual([
      { specialization_slug: "energy", total: 12, pending: 3 },
    ]);
  });

  it("pusta odpowiedź daje pustą listę", async () => {
    sb.state.data = null;
    await expect(fetchAdminClubApplicationCounts()).resolves.toEqual([]);
  });
});

describe("setClubApplicationStatus", () => {
  it("przekazuje identyfikator, status i notatkę", async () => {
    await setClubApplicationStatus("app-1", "accepted", "Komisja: zgoda");
    expect(lastRpc().name).toBe("admin_club_application_set_status");
    expect(lastRpc().args).toEqual({
      p_id: "app-1",
      p_status: "accepted",
      p_note: "Komisja: zgoda",
    });
  });

  it("brak notatki idzie jako `undefined` - nie kasuje notatki poprzedniej", async () => {
    // `null` byłby zapisem pustej notatki, czyli usunięciem uzasadnienia
    // komisji przy każdej zmianie statusu bez wpisywania nowego.
    await setClubApplicationStatus("app-1", "review");
    expect(lastRpc().args?.p_note).toBeUndefined();
  });

  it("akcja idzie po SAMYM identyfikatorze zgłoszenia - zakres ustala RPC", async () => {
    // Kontrakt zapisany wprost: admin klubu A, który poda identyfikator
    // zgłoszenia z klubu B, jest zatrzymywany WYŁĄCZNIE przez RPC. Klient nie
    // ma czym tego sprawdzić i nie udaje, że ma.
    await setClubApplicationStatus("app-z-innego-klubu", "rejected");
    expect(Object.keys(lastRpc().args ?? {})).toEqual(["p_id", "p_status", "p_note"]);
  });

  it("błąd zachowuje treść, żeby dało się nazwać `duplicate_open`", async () => {
    sb.state.error = { message: "duplicate_open" };
    await expect(setClubApplicationStatus("app-1", "pending")).rejects.toThrow("duplicate_open");
  });
});

describe("retryClubApplicationCrmSync", () => {
  it("oddaje aktualny stan synchronizacji po próbie", async () => {
    sb.state.data = [
      {
        crm_sync_status: "ok",
        crm_error: null,
        crm_synced_at: "2026-08-14T09:05:00.000Z",
        crm_last_attempt_at: "2026-08-14T09:05:00.000Z",
      },
    ];
    await expect(retryClubApplicationCrmSync("app-1")).resolves.toEqual({
      crm_sync_status: "ok",
      crm_error: null,
      crm_synced_at: "2026-08-14T09:05:00.000Z",
      crm_last_attempt_at: "2026-08-14T09:05:00.000Z",
    });
  });

  it("nieudana synchronizacja oddaje TREŚĆ błędu, a nie samo `error`", async () => {
    // Błąd synchronizacji z CRM nie może być niewidzialny: panel pokazuje go
    // przy zgłoszeniu, żeby operator wiedział, czy ponawiać, czy naprawiać dane.
    sb.state.data = [
      {
        crm_sync_status: "error",
        crm_error: "duplicate contact",
        crm_synced_at: null,
        crm_last_attempt_at: "2026-08-14T09:05:00.000Z",
      },
    ];
    const result = await retryClubApplicationCrmSync("app-1");
    expect(result.crm_sync_status).toBe("error");
    expect(result.crm_error).toBe("duplicate contact");
  });

  it("pusta odpowiedź to `not_found`, nie cichy sukces", async () => {
    // Ciche powodzenie przy pustej odpowiedzi pokazywałoby „zsynchronizowano"
    // dla zgłoszenia, którego RPC nie widzi.
    sb.state.data = [];
    await expect(retryClubApplicationCrmSync("app-1")).rejects.toThrow("not_found");
  });

  it("odpowiedź niebędąca tablicą też jest `not_found`", async () => {
    sb.state.data = { crm_sync_status: "ok" };
    await expect(retryClubApplicationCrmSync("app-1")).rejects.toThrow("not_found");
  });
});
