// DYSPOZYTOR DIGESTÓW i fallbacki bez pg_cron - do 01.09.2026 bez pokrycia
// (`processDigests`, `siteUrl`, `runEventReminders`, `runCrmTaskReminders`).
// Ścieżka push ma swój `pushDispatch.test.ts`; tutaj chodzi o kanał e-mail,
// czyli o to, co ODBIORCA dostaje do skrzynki, i o odporność jednego ticku:
//
//   * pusty digest NIGDY nie wychodzi (wiersz bez pozycji jest pomijany) -
//     mail „oto co Cię ominęło" bez ani jednej pozycji to szkoda
//     wizerunkowa i prosta droga do zgłoszenia spamu,
//   * jeden zepsuty odbiorca NIE zabiera reszty partii - claim w DB już
//     przestawił `digest_last_sent_at`, więc przerwana pętla oznacza, że
//     pozostali NIE dostaną tego digestu w ogóle (a nie „później"),
//   * język bierze się z `profiles.prefs->>'locale'` z domyślnym `pl`,
//   * fallbacki `siteUrl()` decydują o tym, czy linki w mailu prowadzą na
//     produkcję, czy na `http://localhost:8080` - czyli donikąd.
//
// Wzorzec atrapy `supabaseAdmin` jest ten sam co w `pushDispatch.test.ts`.
// Zero sieci: klient Supabase i kolejka e-mail są podmienione.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawEmailInput, TxSendResult } from "@/lib/email/transactional.server";
import type { DigestItem } from "../digestEmail";

interface QueryResponse {
  data: unknown;
  error: unknown;
}

interface RpcCall {
  name: string;
  args: unknown;
}

const h = vi.hoisted(() => {
  const state = {
    /** Odpowiedzi RPC per nazwa funkcji SQL; brak wpisu = `{data:null,error:null}`. */
    rpcResults: new Map<string, { data: unknown; error: unknown }>(),
    rpcCalls: [] as RpcCall[],
    profiles: [] as unknown[],
    fromTables: [] as string[],
    emails: [] as RawEmailInput[],
    /** Kolejne wyniki `enqueueRawEmail`; po wyczerpaniu - sukces. */
    emailResults: [] as TxSendResult[],
  };
  return { state };
});

vi.mock("@/integrations/supabase/client.server", () => {
  interface Chain extends PromiseLike<QueryResponse> {
    select: (...args: unknown[]) => Chain;
    in: (...args: unknown[]) => Chain;
  }

  const chainFor = (table: string): Chain => {
    h.state.fromTables.push(table);
    const chain: Chain = {
      select: () => chain,
      in: () => chain,
      then: (onFulfilled, onRejected) =>
        Promise.resolve({
          data: table === "profiles" ? h.state.profiles : [],
          error: null,
        }).then(onFulfilled, onRejected),
    };
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => chainFor(table),
      rpc: (name: string, args?: unknown) => {
        h.state.rpcCalls.push({ name, args });
        return Promise.resolve(h.state.rpcResults.get(name) ?? { data: null, error: null });
      },
    },
  };
});

vi.mock("@/lib/email/transactional.server", () => ({
  enqueueRawEmail: (input: RawEmailInput): Promise<TxSendResult> => {
    h.state.emails.push(input);
    return Promise.resolve(h.state.emailResults.shift() ?? { ok: true });
  },
}));

const { processDigests, runCrmTaskReminders, runEventReminders } =
  await import("@/lib/notifications/dispatch.server");

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface DigestRow {
  user_id: string;
  email: string;
  display_name: string;
  items: unknown;
}

function item(overrides: Partial<DigestItem> = {}): DigestItem {
  return {
    kind: "content",
    title_pl: "Nowa analiza",
    title_en: "New analysis",
    body_pl: "Zajawka PL",
    body_en: "Teaser EN",
    href: "/posts/analiza",
    created_at: "2026-09-01T08:00:00Z",
    ...overrides,
  };
}

function row(overrides: Partial<DigestRow> = {}): DigestRow {
  return {
    user_id: ALICE,
    email: "alice@example.com",
    display_name: "Alice",
    items: [item()],
    ...overrides,
  };
}

/** Ustawia wynik claimu partii digestów (to samo RPC, co w produkcji). */
function claimReturns(rows: DigestRow[] | null): void {
  h.state.rpcResults.set("claim_due_digests", { data: rows, error: null });
}

const emails = (): RawEmailInput[] => h.state.emails;
const rpcs = (name: string): RpcCall[] => h.state.rpcCalls.filter((c) => c.name === name);

// `siteUrl()` czyta env przy KAŻDYM wywołaniu, więc każdy test zaczyna od
// czystego stanu i oddaje oryginalne wartości - inaczej kolejność plików w
// suicie zmieniałaby wynik.
const SITE_ENV = ["PUBLIC_SITE_URL", "SITE_URL", "URL"] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  h.state.rpcResults = new Map();
  h.state.rpcCalls = [];
  h.state.profiles = [];
  h.state.fromTables = [];
  h.state.emails = [];
  h.state.emailResults = [];
  for (const key of SITE_ENV) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of SITE_ENV) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("processDigests - claim partii", () => {
  it("pusty claim nie wysyła niczego i nie pyta o profile", async () => {
    claimReturns([]);

    const result = await processDigests("daily");

    expect(result).toEqual({ claimed: 0, sent: 0 });
    expect(emails()).toHaveLength(0);
    // Zapytanie o profile przy pustej partii to czysty koszt na każdym ticku
    // (cron chodzi co godzinę), a lista `in ()` byłaby i tak pusta.
    expect(h.state.fromTables).toHaveLength(0);
  });

  it("claim zwracający null (brak wiersza z RPC) też jest pustą partią", async () => {
    claimReturns(null);

    expect(await processDigests("weekly")).toEqual({ claimed: 0, sent: 0 });
    expect(emails()).toHaveLength(0);
  });

  it("woła claim_due_digests z częstotliwością i domyślnym limitem", async () => {
    claimReturns([]);

    await processDigests("weekly");

    expect(rpcs("claim_due_digests")).toEqual([
      { name: "claim_due_digests", args: { p_frequency: "weekly", p_limit: 50 } },
    ]);
  });

  it("przekazuje własny limit partii", async () => {
    claimReturns([]);

    await processDigests("daily", 7);

    expect(rpcs("claim_due_digests")[0].args).toEqual({ p_frequency: "daily", p_limit: 7 });
  });

  it("błąd claimu przerywa tick wyjątkiem, zamiast raportować sukces", async () => {
    // Cichy `{claimed:0}` przy błędzie DB wyglądałby w panelu jak „nic nie było
    // należne" - a to jest DOKŁADNIE ten stan, w którym digesty przestają
    // wychodzić i nikt tego nie widzi.
    h.state.rpcResults.set("claim_due_digests", {
      data: null,
      error: { code: "42883", message: "function claim_due_digests(text, integer) does not exist" },
    });

    await expect(processDigests("daily")).rejects.toEqual({
      code: "42883",
      message: "function claim_due_digests(text, integer) does not exist",
    });
    expect(emails()).toHaveLength(0);
  });
});

describe("processDigests - wiersze bez pozycji", () => {
  it("pomija wiersze z zerową liczbą pozycji, ale liczy je w claimed", async () => {
    // `items` przychodzi z jsonb, więc w praktyce bywa `[]`, `null` albo -
    // po zmianie kształtu w SQL - czymś, co tablicą nie jest. Każdy z tych
    // trzech przypadków ma dać BRAK maila, a nie pusty digest w skrzynce.
    claimReturns([
      row({ items: [] }),
      row({ user_id: BOB, email: "bob@example.com", items: null }),
      row({ email: "carol@example.org", items: { kind: "content" } }),
      row({ email: "dave@example.org", items: [item()] }),
    ]);

    const result = await processDigests("daily");

    expect(emails().map((e) => e.to)).toEqual(["dave@example.org"]);
    // `claimed` to długość CAŁEGO claimu: w DB `digest_last_sent_at` został już
    // przestawiony wszystkim czterem, więc raport ma pokazywać cztery.
    expect(result).toEqual({ claimed: 4, sent: 1 });
  });
});

describe("processDigests - język odbiorcy", () => {
  it("prefs.locale = 'en' daje digest po angielsku", async () => {
    claimReturns([row()]);
    h.state.profiles = [{ id: ALICE, prefs: { locale: "en" }, tenant_id: null }];

    await processDigests("daily");

    const [mail] = emails();
    expect(mail.subject).toBe("1 update today - New European Strategies");
    expect(mail.html).toContain("Hi Alice, here is what you missed");
  });

  it("nieznana wartość locale spada na polski", async () => {
    claimReturns([row()]);
    h.state.profiles = [{ id: ALICE, prefs: { locale: "de" }, tenant_id: null }];

    await processDigests("daily");

    expect(emails()[0].html).toContain("Cześć Alice, oto co Cię ominęło");
  });

  it("odbiorca bez wiersza profilu dostaje polski, a nie pusty digest", async () => {
    // Wiersz profilu może nie dojechać (RLS, wyścig z usunięciem konta).
    // Brak języka nie może być powodem, żeby digest wyszedł bez treści.
    claimReturns([row()]);
    h.state.profiles = [];

    await processDigests("daily");

    const [mail] = emails();
    expect(mail.subject).toContain("Masz 1 powiadomienie z ostatniego dnia");
    expect(mail.html).toContain("Cześć Alice");
  });
});

describe("processDigests - odporność partii", () => {
  it("błąd wysyłki jednego odbiorcy nie zabiera maila kolejnemu", async () => {
    // SEDNO ODPORNOŚCI TICKU: claim w DB jest atomowy i JUŻ przestawił
    // `digest_last_sent_at` obu odbiorcom. Gdyby pętla przerwała się na
    // pierwszym błędzie, Bob nie dostałby tego digestu NIGDY - jego okno
    // zostało już zużyte.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    claimReturns([row(), row({ user_id: BOB, email: "bob@example.com" })]);
    h.state.emailResults = [{ ok: false, error: "resend_unavailable" }];

    const result = await processDigests("daily");

    expect(emails().map((e) => e.to)).toEqual(["alice@example.com", "bob@example.com"]);
    expect(result).toEqual({ claimed: 2, sent: 1 });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("pominięcie przez listę wykluczeń też nie liczy się jako wysłane", async () => {
    claimReturns([row()]);
    h.state.emailResults = [{ ok: false, skipped: "suppressed", reason: "complaint" }];
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await processDigests("daily")).toEqual({ claimed: 1, sent: 0 });
  });
});

describe("processDigests - klucz idempotencji", () => {
  it("etykieta i klucz niosą częstotliwość, użytkownika i okno DZIENNE", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T10:00:00Z"));
    claimReturns([row()]);

    await processDigests("daily");

    const [mail] = emails();
    expect(mail.label).toBe("digest_daily");
    expect(mail.idempotencyKey).toBe(`digest:daily:${ALICE}:2026-09-01`);
  });

  it("dla 'weekly' okno klucza też jest dzienne - dwa dni tego samego tygodnia ISO dają dwa klucze", async () => {
    // USTALENIE (kod: `digest:${frequency}:${user_id}:${YYYY-MM-DD}`). Klucz
    // idempotencji NIE jest tygodniowy nawet dla frequency='weekly'. Czy to
    // luka? Nie - okna tygodniowego pilnuje SQL, nie klucz.
    //
    // supabase/migrations/20260713092000_notification_channels.sql (definicja
    // `public.claim_due_digests`, ostatnia w repo):
    //   „v_window := CASE p_frequency WHEN 'daily' THEN interval '20 hours'
    //    ELSE interval '6 days' END;"
    //   „AND (np.digest_last_sent_at IS NULL OR np.digest_last_sent_at <
    //    now() - v_window)"
    // a claim w tej samej instrukcji przestawia `digest_last_sent_at = now()`
    // pod `FOR UPDATE SKIP LOCKED` - komentarz migracji mówi wprost:
    // „digest_last_sent_at jest przestawiany w tej samej instrukcji (SKIP
    // LOCKED), więc równoległe wywołania crona nie zdublują wysyłki".
    //
    // Czyli inwariantem systemu jest „nie częściej niż co 6 dni" (świadomy
    // luz na jitter crona), a NIE „raz na tydzień ISO" - dwa digesty tygodniowe
    // MOGĄ wypaść w jednym tygodniu ISO (np. poniedziałek i następna niedziela)
    // i wtedy RÓŻNE klucze idempotencji są zachowaniem poprawnym: to druga,
    // należna wysyłka, a nie duplikat. Klucz chroni przed podwójnym WYSŁANIEM
    // tego samego claimu (ponowiony tick), nie przed drugim claimem.
    // Ten test jest dokumentacją kształtu klucza - gdyby ktoś przestawił okno
    // klucza na tygodniowe, wywali się tu, a nie na produkcji.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T10:00:00Z")); // wtorek, tydzień ISO 2026-W36
    claimReturns([row()]);
    await processDigests("weekly");

    vi.setSystemTime(new Date("2026-09-03T10:00:00Z")); // czwartek, TEN SAM tydzień ISO
    claimReturns([row()]);
    await processDigests("weekly");

    expect(emails().map((e) => e.idempotencyKey)).toEqual([
      `digest:weekly:${ALICE}:2026-09-01`,
      `digest:weekly:${ALICE}:2026-09-03`,
    ]);
    expect(emails()[0].label).toBe("digest_weekly");
  });

  it("dwóch odbiorców w jednej partii ma rozłączne klucze", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T10:00:00Z"));
    claimReturns([row(), row({ user_id: BOB, email: "bob@example.com" })]);

    await processDigests("daily");

    expect(emails().map((e) => e.idempotencyKey)).toEqual([
      `digest:daily:${ALICE}:2026-09-01`,
      `digest:daily:${BOB}:2026-09-01`,
    ]);
  });
});

describe("processDigests - siteUrl() w linkach maila", () => {
  /** Absolutny link ze stopki digestu - jedyne wyjście `siteUrl()` na zewnątrz. */
  async function settingsLink(): Promise<string> {
    claimReturns([row()]);
    await processDigests("daily");
    const match = emails()[0].html.match(/href="([^"]*\/profile\/account)"/);
    return match?.[1] ?? "";
  }

  it("bierze PUBLIC_SITE_URL, gdy jest", async () => {
    process.env.PUBLIC_SITE_URL = "https://nes.example.org";
    process.env.SITE_URL = "https://drugi.example.org";
    process.env.URL = "https://trzeci.example.org";

    expect(await settingsLink()).toBe("https://nes.example.org/profile/account");
  });

  it("spada na SITE_URL bez PUBLIC_SITE_URL", async () => {
    process.env.SITE_URL = "https://drugi.example.org";
    process.env.URL = "https://trzeci.example.org";

    expect(await settingsLink()).toBe("https://drugi.example.org/profile/account");
  });

  it("spada na URL (nazwa z hostingu), gdy nie ma dwóch pierwszych", async () => {
    process.env.URL = "https://trzeci.example.org";

    expect(await settingsLink()).toBe("https://trzeci.example.org/profile/account");
  });

  it("bez żadnej zmiennej linkuje na localhost:8080", async () => {
    // To jest awaryjny adres deweloperski. Test pilnuje KOLEJNOŚCI fallbacków:
    // gdyby localhost trafił wyżej w łańcuchu, wszystkie digesty produkcyjne
    // dostałyby martwe linki, a mail przeszedłby wysyłkę bez śladu błędu.
    expect(await settingsLink()).toBe("http://localhost:8080/profile/account");
  });
});

describe("fallbacki bez pg_cron", () => {
  // Na środowiskach bez pg_cron te dwie funkcje są JEDYNYM źródłem
  // przypomnień - wołane z ticku HTTP. Kontrakt jest wąski (RPC bez
  // argumentów, liczba w wyniku), ale bezargumentowość jest istotna:
  // dopisanie parametru po stronie SQL bez zmiany tutaj daje błąd
  // „function does not exist", a nie ciche zero.
  const fallbacks: { label: string; rpc: string; run: () => Promise<number> }[] = [
    { label: "runEventReminders", rpc: "run_event_reminders", run: runEventReminders },
    { label: "runCrmTaskReminders", rpc: "run_crm_task_reminders", run: runCrmTaskReminders },
  ];

  for (const { label, rpc, run } of fallbacks) {
    it(`${label} woła ${rpc} bez argumentów i zwraca liczbę`, async () => {
      h.state.rpcResults.set(rpc, { data: 7, error: null });

      expect(await run()).toBe(7);
      expect(rpcs(rpc)).toEqual([{ name: rpc, args: undefined }]);
    });

    it(`${label} zwraca 0, gdy RPC oddaje null`, async () => {
      h.state.rpcResults.set(rpc, { data: null, error: null });

      expect(await run()).toBe(0);
    });

    it(`${label} rzuca przy błędzie RPC`, async () => {
      h.state.rpcResults.set(rpc, {
        data: null,
        error: { code: "P0001", message: `${rpc}: brak uprawnień` },
      });

      await expect(run()).rejects.toEqual({ code: "P0001", message: `${rpc}: brak uprawnień` });
    });
  }
});
