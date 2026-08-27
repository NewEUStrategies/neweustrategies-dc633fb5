// BRAMKA CI: PRELEGENT BEZ KONTA JEST NA PUBLICZNEJ LIŚCIE WYDARZENIA.
//
// ── CO SIĘ PSUŁO (POLICZONE, NIE ZGADYWANE) ────────────────────────────────
// Studio („Treść → Prelegenci”, `EventSpeakersManager`) zapisuje prelegenta do
// `event_speaker_entries` → `speaker_profiles`, a dla osoby BEZ KONTA jeszcze do
// kartoteki `event_people`. Strona publiczna czytała CO INNEGO: RPC
// `get_public_speakers` złącza rejestr z `profiles` przez INNER JOIN
// (`JOIN public.profiles p ON p.id = b.user_id`), więc wiersz, którego `user_id`
// jest NULL, wypadał BEZWARUNKOWO I BEZ BŁĘDU. Redaktor widział w panelu
// pięcioro prelegentów, uczestnik pustą sekcję - i nic tego nie zgłaszało,
// bo z punktu widzenia frontu zapytanie kończyło się sukcesem.
//
// Poprawna projekcja (`event_speakers_public`) istniała w migracji
// `20260826180000_event_speaker_person.sql` z grantem dla `anon` i NIKT JEJ NIE
// WOŁAŁ. Ta bramka pilnuje jednego zdania: źródło „event” pyta TĘ funkcję,
// a osoba bez konta jest na liście widoczna z faktami, które redaktor wpisał.
//
// ── DLACZEGO MIERZYMY ZACHOWANIE, A NIE IMPORTY ────────────────────────────
// Poprzednia wersja bramki parytetu podglądu porównywała LISTY IMPORTÓW i była
// zielona, kiedy rzecz pilnowana była zepsuta: nazwa modułu w pliku nie dowodzi,
// że cokolwiek się narysowało (martwa gałąź i nieużyty import przechodzą taki
// test). Tutaj nie ma ani jednej asercji na treść źródła. Jest atrapa KLIENTA
// SUPABASE, prawdziwa warstwa danych (`speakersQuery`), prawdziwe komponenty -
// i pytanie „co widzi czytelnik”.
//
// ── PUŁAPKA NA POWRÓT DO STAREGO RPC ───────────────────────────────────────
// `get_public_speakers` ma tu zaplanowaną odpowiedź TRUJĄCĄ: jeden wiersz
// z nazwiskiem, które nie ma prawa pojawić się na stronie. Gdyby ktoś przełączył
// źródło „event” z powrotem, front narysowałby ten wiersz - i zapala się wtedy
// jedno i drugie: asercja o obecności osoby bez konta (bo w starej projekcji jej
// nie ma) ORAZ asercja o nieobecności trucizny. Sama atrapa jest zresztą trzecim
// strażnikiem: RPC bez zaplanowanej odpowiedzi zwraca BŁĄD, nie ciche zero,
// więc wołanie trzeciej, nieoczekiwanej funkcji też nie przejdzie w ciszy.
//
// ── CO ZOSTAJE POZA TĄ BRAMKĄ, ŚWIADOMIE ───────────────────────────────────
// Trasa `/events/$slug/speakers` składa siatkę z dialogiem sama (siatka dialogu
// nie rysuje), a jej montaż wymaga routera i migawki wydarzenia. Klik jest tu
// mierzony na zapowiedzi z przeglądu (`EventSpeakersSection`), bo TA
// powierzchnia rysuje dialog u siebie - a wiersz, który trasa podaje dalej,
// jest tym samym wierszem, co ten podawany przez `onSelect` siatki (asercja
// „siatka oddaje CAŁY wiersz”).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import "@/lib/i18n-event-front";
import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
    // Lista wystąpień (`event_speakers` -> `events`) idzie łańcuchem PostgREST,
    // a nie RPC. Dla osoby bez konta to zapytanie jest WYŁĄCZONE (`enabled`
    // zależy od `user_id`) i ten rzut jest dowodem: gdyby ktoś zdjął warunek,
    // test padłby tutaj, a nie na cichym pustym wyniku.
    from: (table: string) => {
      throw new Error(`test: nieoczekiwany SELECT na "${table}"`);
    },
  },
}));

const { EventSpeakersGrid } =
  await import("@/components/events/public/organisms/EventSpeakersGrid");
const { EventSpeakersSection } = await import("@/components/events/EventSpeakersSection");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Surowy wiersz RPC - z `null`ami, tak jak przychodzi z `jsonb`, a nie po
 * normalizacji mapperem. Bramka ma mierzyć CAŁĄ drogę, razem z mapowaniem:
 * `user_id: null` to jedyny kształt, w jakim baza opisuje osobę bez konta.
 */
function rpcRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    speaker_profile_id: "aaaaaaaa-0000-4000-8000-000000000001",
    user_id: null,
    person_id: "bbbbbbbb-0000-4000-8000-000000000001",
    slug: null,
    display_name: null,
    avatar_url: null,
    job_title: null,
    company: null,
    headline_pl: null,
    headline_en: null,
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: true,
    sort_order: 0,
    ...overrides,
  };
}

/** Prelegentka BEZ KONTA - dokładnie ten wiersz, który INNER JOIN kasował. */
const PERSON = {
  name: "Halina Zielinska",
  jobTitle: "Dyrektorka gabinetu",
  company: "Kancelaria Prezesa Rady Ministrow",
  bio: "Prowadzi zespol negocjacyjny od 2019 roku.",
  topic: "energetyka",
} as const;

const personRow = () =>
  rpcRow({
    display_name: PERSON.name,
    job_title: PERSON.jobTitle,
    company: PERSON.company,
    bio_pl: PERSON.bio,
    topics_pl: [PERSON.topic],
    languages: ["pl"],
    sort_order: 0,
  });

/** Prelegent Z KONTEM - żeby dowód nie polegał na liście jednorodnej. */
const ACCOUNT_NAME = "Jan Kowalski";

const accountRow = () =>
  rpcRow({
    speaker_profile_id: "aaaaaaaa-0000-4000-8000-000000000002",
    user_id: "cccccccc-0000-4000-8000-000000000001",
    person_id: null,
    slug: "jan-kowalski",
    display_name: ACCOUNT_NAME,
    job_title: "Analityk",
    company: "NES",
    sort_order: 1,
  });

/** Osoba bez konta, której wiersz NIE NIESIE NIC ponad to, co jest na karcie. */
const PLAIN_NAME = "Maria Sucha";

const plainPersonRow = () =>
  rpcRow({
    speaker_profile_id: "aaaaaaaa-0000-4000-8000-000000000003",
    person_id: "bbbbbbbb-0000-4000-8000-000000000003",
    display_name: PLAIN_NAME,
    job_title: "Rzeczniczka",
    company: "Ministerstwo Cyfryzacji",
    sort_order: 2,
  });

/** Nazwisko, które może przyjść WYŁĄCZNIE ze starego RPC. */
const POISON_NAME = "Widmo starego RPC";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Wiersze publicznej listy wydarzenia (domyślnie: osoba bez konta + z kontem). */
function planRows(rows: Record<string, unknown>[]): void {
  h.rpc?.setData("event_speakers_public", rows);
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  planRows([personRow(), accountRow()]);
  // Trucizna: stare RPC oddaje kartę, której na stronie być nie może.
  h.rpc.setData("get_public_speakers", [
    { ...rpcRow(), user_id: "dddddddd-0000-4000-8000-000000000009", display_name: POISON_NAME },
  ]);
});

afterEach(() => {
  cleanup();
  h.rpc?.reset();
});

describe("źródło „event” czyta projekcję, która zna osoby bez konta", () => {
  it("siatka na zakładce pyta `event_speakers_public`, a NIE `get_public_speakers`", async () => {
    render(<EventSpeakersGrid eventId={EVENT_ID} />, { wrapper });
    await screen.findByText(PERSON.name);

    expect(h.rpc?.names()).toContain("event_speakers_public");
    expect(h.rpc?.names()).not.toContain("get_public_speakers");
    // Ładunek jest `jsonb`, więc rozjazd nazwy klucza kończy się pustą listą
    // dopiero na produkcji - nazwa `event_id` jest tu asercją, nie ozdobą.
    expect(h.rpc?.lastCall("event_speakers_public")?.arg("p_payload")).toMatchObject({
      event_id: EVENT_ID,
    });
  });

  it("zapowiedź na przeglądzie pyta tej samej funkcji", async () => {
    render(<EventSpeakersSection eventId={EVENT_ID} lang="pl" />, { wrapper });
    await screen.findByText(PERSON.name);

    expect(h.rpc?.names()).toEqual(["event_speakers_public"]);
  });

  it("wiersz ze STAREGO RPC nie ma jak trafić na stronę", async () => {
    // Gdyby ktoś przełączył źródło z powrotem, ta karta by się narysowała.
    const { container } = render(<EventSpeakersGrid eventId={EVENT_ID} />, { wrapper });
    await screen.findByText(PERSON.name);
    expect(container.textContent ?? "").not.toContain(POISON_NAME);
  });
});

describe("prelegent BEZ KONTA jest widoczny z faktami z kartoteki", () => {
  it("siatka na zakładce wypisuje nazwisko, rolę i organizację", async () => {
    const { container } = render(<EventSpeakersGrid eventId={EVENT_ID} />, { wrapper });
    await screen.findByText(PERSON.name);

    const text = container.textContent ?? "";
    expect(text).toContain(PERSON.jobTitle);
    expect(text).toContain(PERSON.company);
    // Osoba z kontem NIE ZNIKA razem z poprawką - projekcja scala oba rodzaje.
    expect(text).toContain(ACCOUNT_NAME);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("zapowiedź na przeglądzie wypisuje TĘ SAMĄ osobę i te same fakty", async () => {
    const { container } = render(<EventSpeakersSection eventId={EVENT_ID} lang="pl" />, {
      wrapper,
    });
    await screen.findByText(PERSON.name);

    const text = container.textContent ?? "";
    expect(text).toContain(PERSON.jobTitle);
    expect(text).toContain(PERSON.company);
    expect(text).toContain(ACCOUNT_NAME);
  });

  it("dwie osoby bez konta mają RÓŻNE klucze pozycji listy", async () => {
    // `user_id` jest dla nich pusty, więc klucz oparty na koncie dałby DWA
    // IDENTYCZNE klucze - React sklejałby wtedy sąsiadów przy każdym refetchu
    // (przestawione zdjęcia i podpisy). Kolizji klucza nie widać w drzewie:
    // React rysuje oba wpisy i tylko OSTRZEGA. Dlatego mierzymy jedno i drugie -
    // liczbę pozycji ORAZ ostrzeżenie, bo bez niego ta asercja byłaby zielona
    // także dla zepsutego klucza.
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    planRows([personRow(), plainPersonRow()]);
    const { container } = render(<EventSpeakersGrid eventId={EVENT_ID} />, { wrapper });
    await screen.findByText(PERSON.name);

    expect(screen.getByText(PLAIN_NAME)).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(errors.filter((line) => /same key/i.test(line))).toEqual([]);
    spy.mockRestore();
  });

  it("wiersz BEZ ŻADNEJ tożsamości nie jest kartą z pustym nazwiskiem", async () => {
    // Sierota legacy albo konto obcego najemcy: baza takiego wiersza nie
    // wypuszcza, ale warstwa danych nie może na to liczyć - karta bez nazwiska
    // i z pustym kluczem jest gorsza niż brak karty.
    planRows([personRow(), rpcRow({ speaker_profile_id: null, person_id: null })]);
    const { container } = render(<EventSpeakersGrid eventId={EVENT_ID} />, { wrapper });
    await screen.findByText(PERSON.name);

    expect(container.querySelectorAll("li")).toHaveLength(1);
  });
});

describe("klik w osobę bez konta ma co pokazać", () => {
  it("okno profilu niesie biogram i tematy Z WIERSZA, bez pytania bazy o profil", async () => {
    render(<EventSpeakersSection eventId={EVENT_ID} lang="pl" />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(PERSON.name) }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(PERSON.bio)).toBeInTheDocument();
    expect(within(dialog).getByText(PERSON.topic)).toBeInTheDocument();
    // Osoba bez konta nie ma po czym dociągać profilu - dialog NIE MOŻE
    // odpalić `get_public_speakers` z listą `p_user_ids`, bo nie ma czego tam
    // wpisać, a puste zapytanie oddałoby KATALOG.
    expect(h.rpc?.names()).toEqual(["event_speakers_public"]);
  });

  it("osoba, o której wiersz nie wie nic ponad kartę, NIE udaje przycisku", async () => {
    // Karta wyglądająca na klikalną, która po kliknięciu powtarza nazwisko
    // i firmę z karty, obiecuje więcej, niż dowozi.
    planRows([plainPersonRow(), accountRow()]);
    render(<EventSpeakersSection eventId={EVENT_ID} lang="pl" />, { wrapper });
    await screen.findByText(PLAIN_NAME);

    expect(screen.queryByRole("button", { name: new RegExp(PLAIN_NAME) })).toBeNull();
    // ...a osoba z kontem przyciskiem zostaje: dla niej dialog dociąga profil
    // i listę wystąpień, więc ma co otworzyć.
    expect(screen.getByRole("button", { name: new RegExp(ACCOUNT_NAME) })).toBeInTheDocument();
  });

  it("siatka oddaje `onSelect` CAŁY wiersz, nie samo `user_id`", async () => {
    // Trasa `/events/$slug/speakers` z tego wiersza karmi dialog - dla osoby
    // bez konta jest on JEDYNYM źródłem biogramu, tematów i języków.
    planRows([personRow()]);
    const picked: unknown[] = [];
    render(<EventSpeakersGrid eventId={EVENT_ID} onSelect={(row) => picked.push(row)} />, {
      wrapper,
    });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(PERSON.name) }));

    await waitFor(() => expect(picked).toHaveLength(1));
    expect(picked[0]).toMatchObject({
      user_id: "",
      person_id: "bbbbbbbb-0000-4000-8000-000000000001",
      bio_pl: PERSON.bio,
      company: PERSON.company,
      topics_pl: [PERSON.topic],
    });
  });
});
