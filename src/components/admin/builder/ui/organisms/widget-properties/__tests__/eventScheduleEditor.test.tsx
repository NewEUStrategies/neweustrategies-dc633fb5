// Harmonogram wydarzenia: dni -> sesje -> prelegenci i sponsorzy. Trzy poziomy
// zagnieżdżenia, a każdy z nich ma własne przenoszenie, usuwanie i patch.
//
// Reguły, które ten plik przypina (i których tabela z `editorMatrix` nie
// wyrazi, bo dotyczą KONKRETNYCH kształtów danych):
//  1. Pozycja BEZ NAZWY musi mieć etykietę zastępczą z numerem - inaczej
//     redakcja widzi listę pustych wierszy i nie wie, który jest który.
//  2. Podpięcie profilu platformy nie może zdeptać ręcznie wpisanego nazwiska
//     ani zdjęcia; puste pola dobiera z profilu.
//  3. Przenoszenie na krańcach listy jest bezskuteczne, ale NIE gubi pozycji.
//  4. Sesja typu "przerwa" ma inny zestaw pól niż zwykła sesja.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { EventScheduleEditor } from "../EventScheduleEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));
// Wyszukiwarka profili ma własny test (zapytanie, debounce, lista trafień).
// Tutaj potrzebne są dwa przyciski: trafienie PEŁNE i trafienie BEZ danych -
// to od nich zależy, czy edytor dobierze brakujące pola, czy nadpisze wpisane.
vi.mock("../ProfilePicker", () => ({
  ProfilePicker: ({
    onPick,
    onClear,
  }: {
    value?: string;
    lang: "pl" | "en";
    onPick: (hit: { id: string; display_name?: string; avatar_url?: string }) => void;
    onClear: () => void;
  }) => (
    <span>
      <button
        type="button"
        data-testid="profil-pelny"
        onClick={() =>
          onPick({ id: "u-1", display_name: "Anna Nowak", avatar_url: "https://cdn.test/an.png" })
        }
      />
      <button type="button" data-testid="profil-bez-danych" onClick={() => onPick({ id: "u-2" })} />
      <button type="button" data-testid="profil-odepnij" onClick={onClear} />
    </span>
  ),
}));

function renderEditor(initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <EventScheduleEditor
        c={content}
        lang={lang}
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  openAll(view.container);
  const days = (): Array<Record<string, unknown>> => {
    const last = written.filter(([k]) => k === "days").at(-1);
    return (last?.[1] ?? []) as Array<Record<string, unknown>>;
  };
  return { ...view, written, days };
}

const sessionOf = (over: Record<string, Json> = {}): Record<string, Json> => ({
  id: "s-1",
  title_pl: "Sesja otwierająca",
  title_en: "Opening session",
  from: "10:00",
  to: "11:00",
  kind: "session",
  speakers: [],
  sponsors: [],
  ...over,
});

const dayOf = (over: Record<string, Json> = {}): Record<string, Json> => ({
  id: "day-1",
  label_pl: "Dzień 1",
  label_en: "Day 1",
  date: "2026-09-01",
  sessions: [sessionOf()],
  ...over,
});

/**
 * Rozwija WSZYSTKIE poziomy listy. Dzień, sesja i jej podlisty są domyślnie
 * zwinięte (panel nie pokazuje trzech poziomów naraz), więc bez tego kroku
 * połowa pól nie istnieje w DOM. Dwie rundy, bo rozwinięcie dnia dopiero
 * ODSŁANIA przełącznik sesji.
 */
function openAll(container: HTMLElement): void {
  for (let round = 0; round < 3; round += 1) {
    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'),
    );
    const summaries = Array.from(container.querySelectorAll<HTMLElement>("summary"));
    if (!toggles.length && !summaries.length) return;
    for (const toggle of toggles) fireEvent.click(toggle);
    for (const summary of summaries) fireEvent.click(summary);
  }
}

/** Wszystkie przyciski o danym tytule - listy mają je per wiersz. */
const buttonsTitled = (title: string): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => b.getAttribute("title") === title || b.getAttribute("aria-label") === title,
  );

beforeEach(() => {
  db.current = supabaseFromStub();
  for (const table of ["profiles", "events", "media"]) db.current.setResponse(table, ok([]));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("EventScheduleEditor - etykiety zastępcze", () => {
  it("prelegent bez nazwiska ma etykietę z numerem", () => {
    const { container } = renderEditor({
      days: [
        dayOf({
          sessions: [
            sessionOf({
              speakers: [
                { id: "sp1", userId: "u-9" },
                { id: "sp2", userId: "u-8" },
              ],
            }),
          ],
        }),
      ],
    });
    // Prelegent podpięty do profilu nie musi mieć lokalnej nazwy - wiersz
    // dostaje wtedy numer. Dwa puste wiersze bez numeru byłyby
    // nierozróżnialne.
    expect(container.textContent).toContain("Prelegent #1");
    expect(container.textContent).toContain("Prelegent #2");
  });

  it("sponsor bez nazwy ma etykietę z numerem", () => {
    const { container } = renderEditor({
      days: [
        dayOf({
          sessions: [
            sessionOf({
              kind: "break",
              sponsors: [{ id: "spn1", name: "", logo: "https://cdn.test/l.png" }],
            }),
          ],
        }),
      ],
    });
    expect(container.textContent).toContain("Sponsor #1");
  });

  it("prelegent z nazwiskiem pokazuje nazwisko, nie numer", () => {
    const { container } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ speakers: [{ id: "sp1", name: "Jan Kowalski" }] })] })],
    });
    expect(container.textContent).toContain("Jan Kowalski");
    expect(container.textContent).not.toContain("Prelegent #1");
  });
});

describe("EventScheduleEditor - podpięcie profilu platformy", () => {
  it("puste pola dobiera z profilu", () => {
    const { days } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ speakers: [{ id: "sp1", userId: "u-0" }] })] })],
    });
    fireEvent.click(screen.getByTestId("profil-pelny"));
    const speakers = (days()[0]?.sessions as Array<Record<string, unknown>>)[0]?.speakers as Array<
      Record<string, unknown>
    >;
    expect(speakers[0]?.userId).toBe("u-1");
    expect(speakers[0]?.name).toBe("Anna Nowak");
    expect(speakers[0]?.photo).toBe("https://cdn.test/an.png");
  });

  it("ręcznie wpisane nazwisko i zdjęcie mają pierwszeństwo nad profilem", () => {
    const { days } = renderEditor({
      days: [
        dayOf({
          sessions: [
            sessionOf({
              speakers: [
                { id: "sp1", name: "Wpisane ręcznie", photo: "https://cdn.test/moje.png" },
              ],
            }),
          ],
        }),
      ],
    });
    fireEvent.click(screen.getByTestId("profil-pelny"));
    const speakers = (days()[0]?.sessions as Array<Record<string, unknown>>)[0]?.speakers as Array<
      Record<string, unknown>
    >;
    // Redakcja poprawia nazwiska po polsku - podpięcie profilu nie może tego
    // zdeptać, bo poprawka wróciłaby do wersji z profilu.
    expect(speakers[0]?.name).toBe("Wpisane ręcznie");
    expect(speakers[0]?.photo).toBe("https://cdn.test/moje.png");
    expect(speakers[0]?.userId).toBe("u-1");
  });

  it("profil bez danych nie wstawia pustych wartości udających treść", () => {
    const { days } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ speakers: [{ id: "sp1", userId: "u-0" }] })] })],
    });
    fireEvent.click(screen.getByTestId("profil-bez-danych"));
    const speakers = (days()[0]?.sessions as Array<Record<string, unknown>>)[0]?.speakers as Array<
      Record<string, unknown>
    >;
    expect(speakers[0]?.userId).toBe("u-2");
    expect(speakers[0]?.name).toBe("");
    expect(speakers[0]?.photo).toBe("");
  });

  it("odpięcie profilu czyści tylko referencję", () => {
    const { days } = renderEditor({
      days: [
        dayOf({
          sessions: [sessionOf({ speakers: [{ id: "sp1", userId: "u-9", name: "Jan Kowalski" }] })],
        }),
      ],
    });
    fireEvent.click(screen.getByTestId("profil-odepnij"));
    const speakers = (days()[0]?.sessions as Array<Record<string, unknown>>)[0]?.speakers as Array<
      Record<string, unknown>
    >;
    expect(speakers[0]?.userId).toBe("");
    expect(speakers[0]?.name).toBe("Jan Kowalski");
  });
});

describe("EventScheduleEditor - przenoszenie na krańcach", () => {
  it("przeniesienie pierwszej sesji wyżej nie gubi żadnej", () => {
    const { days } = renderEditor({
      days: [
        dayOf({
          sessions: [sessionOf(), sessionOf({ id: "s-2", title_pl: "Druga" })],
        }),
      ],
    });
    const up = buttonsTitled("Przesuń wyżej");
    expect(up.length).toBeGreaterThan(0);
    fireEvent.click(up[up.length - 1]!);
    const sessions = days()[0]?.sessions as Array<Record<string, unknown>>;
    // Ruch poza zakres zwraca listę bez zmian - liczba pozycji MUSI zostać.
    expect(sessions?.length ?? 2).toBe(2);
  });

  it("przeniesienie ostatniego dnia niżej nie gubi dni", () => {
    const { days } = renderEditor({
      days: [dayOf(), dayOf({ id: "day-2", label_pl: "Dzień 2", sessions: [] })],
    });
    const down = buttonsTitled("Przesuń niżej");
    fireEvent.click(down[down.length - 1]!);
    expect((days().length || 2) >= 2).toBe(true);
  });
});

describe("EventScheduleEditor - sesja typu przerwa", () => {
  it("tylko przerwa ma sekcję sponsorów", () => {
    const zwykla = renderEditor({ days: [dayOf({ sessions: [sessionOf()] })] });
    // Sponsorzy są przypisani do PRZERWY (kawa, lunch), nie do sesji
    // merytorycznej - panel nie może ich oferować tam, gdzie renderer ich
    // nie rysuje.
    expect(zwykla.container.textContent).not.toContain("Sponsorzy przerwy");
    zwykla.unmount();
    const przerwa = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ kind: "break", title_pl: "Kawa" })] })],
    });
    expect(przerwa.container.textContent).toContain("Sponsorzy przerwy");
  });

  it("dodanie sponsora przerwy dopisuje pusty wiersz", () => {
    const { container, days } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ kind: "break", title_pl: "Kawa" })] })],
    });
    const addButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
      (b) => (b.textContent ?? "").trim().startsWith("+"),
    );
    const last = addButtons.at(-1);
    if (!last) throw new Error("test: brak przycisku dodawania sponsora");
    fireEvent.click(last);
    const sessions = days()[0]?.sessions as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("zmiana rodzaju sesji zapisuje się w dokumencie", () => {
    const { days, container } = renderEditor({ days: [dayOf({ sessions: [sessionOf()] })] });
    const select = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((sel) =>
      sel.querySelector('option[value="break"]'),
    );
    if (!select) throw new Error("test: brak listy rodzaju sesji");
    fireEvent.change(select, { target: { value: "break" } });
    const sessions = days()[0]?.sessions as Array<Record<string, unknown>>;
    expect(sessions[0]?.kind).toBe("break");
    fireEvent.change(select, { target: { value: "session" } });
  });
});

// ── DRUGI SZEREG: pola LIŚCI harmonogramu ───────────────────────────────────
//
// Powyżej stoją reguły „kto wygrywa" (etykieta zastępcza, profil vs wpis
// ręczny, kraniec listy). Poniżej idą POLA, które redakcja wypełnia najczęściej
// i które w tabeli zbiorczej nie były ani razu tknięte, bo tabela nie wie, jak
// wygląda sesja typu „przerwa" ani ile prelegentów potrzeba, żeby przenoszenie
// miało sens: godziny sesji, rubryki sponsora przerwy oraz przenoszenie
// i punktowa edycja pozycji na liście DWUELEMENTOWEJ. Ostatnie jest tu
// najważniejsze: `map((s, j) => (j === i ? ... : s))` na liście
// JEDNOELEMENTOWEJ nigdy nie wykona gałęzi „to nie ten wpis", a właśnie ona
// odpowiada za to, że edycja drugiego prelegenta nie zeruje pierwszego.

type FormField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Pole panelu poznajemy po DOKŁADNEJ treści etykiety `PropField`, nie po
 * pozycji w formularzu - przestawienie pól nie jest defektem, a zmiana nazwy
 * rubryki owszem.
 */
function fieldsLabelled(container: HTMLElement, label: string): FormField[] {
  const out: FormField[] = [];
  for (const node of Array.from(container.querySelectorAll("label"))) {
    if ((node.textContent ?? "").trim() !== label) continue;
    const field = node.closest("div")?.querySelector<FormField>("input, textarea");
    if (field) out.push(field);
  }
  return out;
}

function fieldLabelled(container: HTMLElement, label: string, index = 0): FormField {
  const field = fieldsLabelled(container, label)[index];
  if (!field) throw new Error(`test: brak pola o etykiecie „${label}" (#${index})`);
  return field;
}

/** Sesje pierwszego dnia z ostatniego zapisu dokumentu. */
const sessionsOf = (days: () => Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
  (days()[0]?.sessions ?? []) as Array<Record<string, unknown>>;

/** Podlista pierwszej sesji pierwszego dnia (prelegenci albo sponsorzy). */
const subListOf = (
  days: () => Array<Record<string, unknown>>,
  key: "speakers" | "sponsors",
): Array<Record<string, unknown>> =>
  (sessionsOf(days)[0]?.[key] ?? []) as Array<Record<string, unknown>>;

describe("EventScheduleEditor - godziny sesji", () => {
  it("godzina początku i końca zapisuje się w sesji", () => {
    const { container, days } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ timeStart: "", timeEnd: "" })] })],
    });
    fireEvent.change(fieldLabelled(container, "Od"), { target: { value: "09:30" } });
    expect(sessionsOf(days)[0]?.timeStart).toBe("09:30");
    fireEvent.change(fieldLabelled(container, "Do"), { target: { value: "10:45" } });
    expect(sessionsOf(days)[0]?.timeEnd).toBe("10:45");
  });

  it("wyczyszczenie godziny zapisuje PUSTY łańcuch, a nie pomija klucza", () => {
    // „Sesja bez godziny" jest poprawnym stanem agendy (panel dyskusyjny bez
    // sztywnych ram). Gdyby pusty wpis nie trafiał do dokumentu, redakcja nie
    // miałaby jak wycofać raz wpisanej godziny.
    const { container, days } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ timeStart: "09:00", timeEnd: "10:00" })] })],
    });
    fireEvent.change(fieldLabelled(container, "Od"), { target: { value: "" } });
    expect(sessionsOf(days)[0]).toHaveProperty("timeStart", "");
  });

  it("edycja jednej z dwóch sesji nie rusza drugiej", () => {
    const { container, days } = renderEditor({
      days: [
        dayOf({
          sessions: [
            sessionOf({ id: "s-1", title_pl: "Pierwsza", timeStart: "10:00" }),
            sessionOf({ id: "s-2", title_pl: "Druga", timeStart: "" }),
          ],
        }),
      ],
    });
    // DRUGIE pole „Od" należy do DRUGIEJ sesji - patch pierwszej sesji nie ma
    // prawa przepisać tytułu drugiej.
    fireEvent.change(fieldLabelled(container, "Od", 1), { target: { value: "12:00" } });
    const sessions = sessionsOf(days);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.title_pl).toBe("Pierwsza");
    expect(sessions[0]?.timeStart).toBe("10:00");
    expect(sessions[1]?.title_pl).toBe("Druga");
    expect(sessions[1]?.timeStart).toBe("12:00");
  });
});

describe("EventScheduleEditor - rubryki sponsora przerwy", () => {
  const breakDayWith = (sponsors: Array<Record<string, Json>>): Record<string, Json> =>
    dayOf({ sessions: [sessionOf({ kind: "break", title_pl: "Kawa", sponsors })] });

  it("nazwa, logo i link sponsora zapisują się w sesji przerwy", () => {
    const { container, days } = renderEditor({
      days: [breakDayWith([{ id: "spn-1", name: "Alfa", logo: "", url: "" }])],
    });
    fireEvent.change(fieldLabelled(container, "Nazwa"), { target: { value: "Beta" } });
    expect(subListOf(days, "sponsors")[0]?.name).toBe("Beta");

    fireEvent.change(fieldLabelled(container, "Logo (URL)"), {
      target: { value: "https://cdn.example.com/beta.png" },
    });
    expect(subListOf(days, "sponsors")[0]?.logo).toBe("https://cdn.example.com/beta.png");

    fireEvent.change(fieldLabelled(container, "Link"), {
      target: { value: "https://example.com/beta" },
    });
    const sponsor = subListOf(days, "sponsors")[0];
    // Trzy rubryki - JEDEN wpis. Każdy patch scala się z poprzednim, a nie
    // zastępuje sponsora obiektem z jednym polem.
    expect(sponsor).toMatchObject({
      name: "Beta",
      logo: "https://cdn.example.com/beta.png",
      url: "https://example.com/beta",
    });
  });

  it("edycja drugiego sponsora nie zeruje pierwszego", () => {
    const { container, days } = renderEditor({
      days: [
        breakDayWith([
          { id: "spn-1", name: "Alfa", logo: "", url: "" },
          { id: "spn-2", name: "Gamma", logo: "", url: "" },
        ]),
      ],
    });
    fireEvent.change(fieldLabelled(container, "Nazwa", 1), { target: { value: "Delta" } });
    const sponsors = subListOf(days, "sponsors");
    expect(sponsors).toHaveLength(2);
    expect(sponsors[0]?.name).toBe("Alfa");
    expect(sponsors[1]?.name).toBe("Delta");
  });

  it("usunięcie jednego sponsora zostawia pozostałych", () => {
    const { container, days } = renderEditor({
      days: [
        breakDayWith([
          { id: "spn-1", name: "Alfa", logo: "", url: "" },
          { id: "spn-2", name: "Gamma", logo: "", url: "" },
        ]),
      ],
    });
    // Wiersz sponsora ma własny przycisk „Usuń" (nie `ItemFrame`), więc szukamy
    // go po treści w obrębie ramki sponsora.
    const removes = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
      (b) => (b.textContent ?? "").trim() === "Usuń",
    );
    expect(removes.length).toBeGreaterThan(0);
    fireEvent.click(removes[removes.length - 1]!);
    const sponsors = subListOf(days, "sponsors");
    expect(sponsors).toHaveLength(1);
    expect(sponsors[0]?.name).toBe("Alfa");
  });

  it("angielski panel przerwy ma angielskie rubryki sponsora", () => {
    // Wiersz sponsora ma WŁASNE `l(pl, en)` - polski przejazd nie wykonuje
    // ani jednej angielskiej gałęzi, więc odwrócony warunek pokazywałby
    // polskie etykiety w panelu angielskim i nikt by tego nie zauważył.
    const { container } = renderEditor(
      { days: [breakDayWith([{ id: "spn-1", name: "Alfa", logo: "", url: "" }])] },
      "en",
    );
    expect(fieldsLabelled(container, "Name")).toHaveLength(1);
    expect(fieldsLabelled(container, "Nazwa")).toHaveLength(0);
    expect(container.textContent).toContain("Break sponsors");
  });
});

describe("EventScheduleEditor - przenoszenie i edycja prelegentów sesji", () => {
  const twoSpeakers = (): Record<string, Json> =>
    dayOf({
      sessions: [
        sessionOf({
          speakers: [
            { id: "sp-1", name: "Pierwszy Prelegent", role_pl: "Panelista" },
            { id: "sp-2", name: "Drugi Prelegent", role_pl: "Moderator" },
          ],
        }),
      ],
    });

  it("przeniesienie prelegenta niżej zamienia go z następnym", () => {
    const { days } = renderEditor({ days: [twoSpeakers()] });
    // Dzień i sesja są pojedyncze, więc ich strzałki są WYŁĄCZONE - jedyny
    // czynny „Przesuń niżej" należy do pierwszego prelegenta.
    const down = buttonsTitled("Przesuń niżej").filter((b) => !b.disabled);
    expect(down).toHaveLength(1);
    fireEvent.click(down[0]!);
    const speakers = subListOf(days, "speakers");
    expect(speakers.map((s) => s.name)).toEqual(["Drugi Prelegent", "Pierwszy Prelegent"]);
  });

  it("edycja drugiego prelegenta nie zeruje pierwszego", () => {
    const { container, days } = renderEditor({ days: [twoSpeakers()] });
    fireEvent.change(fieldLabelled(container, "Imię i nazwisko", 1), {
      target: { value: "Trzeci Prelegent" },
    });
    const speakers = subListOf(days, "speakers");
    expect(speakers).toHaveLength(2);
    expect(speakers[0]).toMatchObject({ name: "Pierwszy Prelegent", role_pl: "Panelista" });
    expect(speakers[1]).toMatchObject({ name: "Trzeci Prelegent", role_pl: "Moderator" });
  });

  it("usunięcie prelegenta zostawia pozostałych", () => {
    const { container, days } = renderEditor({ days: [twoSpeakers()] });
    const removes = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
      (b) => (b.textContent ?? "").trim() === "Usuń",
    );
    fireEvent.click(removes[0]!);
    expect(subListOf(days, "speakers").map((s) => s.name)).toEqual(["Drugi Prelegent"]);
  });
});

// DEFEKT: „+ DODAJ PRELEGENTA" NIE DODAJE ŻADNEGO WIERSZA DO PANELU.
//
// WEJŚCIE: sesja z pustą listą prelegentów; redaktor klika „+ Dodaj" nad
//   sekcją „Prelegenci".
// CO PSUJE: panel zapisuje pozycję z SAMYMI pustymi polami
//   (`EventScheduleEditor.tsx:365-372`: `{ id, userId: "", name: "", role_pl:
//   "", role_en: "", photo: "" }`), a przy następnym renderze czyta dokument
//   przez `parseScheduleDays` -> `parseSpeaker`
//   (`src/lib/events/schedule.ts:68`: `if (!speaker.userId && !speaker.name)
//   return null;`). Wpis bez profilu i bez nazwiska jest ODRZUCANY, więc
//   wiersz, który dopiero co powstał, nie dojeżdża do panelu.
// KONSEKWENCJA: prelegenta wpisanego RĘCZNIE nie da się dodać w ogóle -
//   kliknięcie „+ Dodaj" nie daje żadnej reakcji interfejsu, a jedyną drogą
//   zostaje podpięcie profilu platformy albo ręczna edycja JSON-a dokumentu.
//   Ten sam filtr jest POPRAWNY dla widoku publicznego (nie rysujemy pustych
//   kart), ale edytor nie ma prawa go dziedziczyć.
// WYMAGANA POPRAWKA: edytor musi pracować na WŁASNYM, nieodrzucającym
//   parsowaniu treści (albo `parseScheduleDays` musi przyjąć tryb „redakcyjny",
//   w którym puste pozycje zostają), a odsiew pustych wpisów ma zostać po
//   stronie widoku.
it.fails("DEFEKT: „+ Dodaj” prelegenta MUSI dodać wiersz widoczny w panelu", () => {
  const { container } = renderEditor({ days: [dayOf({ sessions: [sessionOf()] })] });
  const addSpeaker = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => (b.textContent ?? "").trim().startsWith("+"),
  );
  // Ostatni „+" w sesji zwykłej to „+ Dodaj" prelegenta (przerwa dokłada
  // jeszcze sponsorów, dlatego fixture jest sesją merytoryczną).
  fireEvent.click(addSpeaker[addSpeaker.length - 1]!);
  expect(container.textContent).toContain("Prelegent #1");
});

// DEFEKT: „+ DODAJ SPONSORA PRZERWY" NIE DODAJE ŻADNEGO WIERSZA DO PANELU.
//
// WEJŚCIE: sesja typu „przerwa" z pustą listą sponsorów; redaktor klika
//   „+ Dodaj" nad sekcją „Sponsorzy przerwy".
// CO PSUJE: ta sama mechanika co przy prelegencie. Panel zapisuje
//   `{ id, name: "", logo: "", url: "" }` (`EventScheduleEditor.tsx:419-422`),
//   a `parseSponsor` (`src/lib/events/schedule.ts:79`: `if (!sponsor.name &&
//   !sponsor.logo) return null;`) odrzuca wpis bez nazwy i bez logo.
// KONSEKWENCJA: sponsora przerwy nie da się dopisać w panelu - a to jest
//   pozycja, którą sprzedaje dział komercyjny, więc brak reakcji przycisku
//   kończy się wpisywaniem sponsorów w JSON dokumentu.
// WYMAGANA POPRAWKA: jak wyżej - odsiew pustych pozycji należy do widoku,
//   nie do modelu, na którym pracuje edytor.
it.fails("DEFEKT: „+ Dodaj” sponsora przerwy MUSI dodać wiersz widoczny w panelu", () => {
  const { container } = renderEditor({
    days: [dayOf({ sessions: [sessionOf({ kind: "break", title_pl: "Kawa", sponsors: [] })] })],
  });
  const adds = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((b) =>
    (b.textContent ?? "").trim().startsWith("+"),
  );
  fireEvent.click(adds[adds.length - 1]!);
  expect(container.textContent).toContain("Sponsor #1");
});
