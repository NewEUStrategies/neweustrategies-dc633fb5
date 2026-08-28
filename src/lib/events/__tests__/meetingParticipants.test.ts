// Wyszukiwarka uczestnikow do dialogu „Umow spotkanie" - kontrakt z RPC i BRAMKA
// wiazaca liste statusow z regula zapisana w migracji.
//
// PO CO TEN PLIK ISTNIEJE. Do naprawy z tego commita `ARRANGEABLE_STATUS`
// wynosil `"confirmed"` - wartosc, ktorej CHECK na `event_registrations.status`
// nie zna. RPC filtruje doslownie (`r.status = p_status`), wiec wyszukiwarka nie
// zwracala NIGDY ani jednego wiersza: dialog byl martwy, a `admin_event_meeting_arrange`
// - jedyna droga realizacji obietnicy „dziesiec umowionych spotkan" z pakietu
// sponsorskiego - nieosiagalna z panelu. Kompilator tego nie widzial, bo kolumna
// jest typu `text`, wiec typ generowany to `string`.
//
// DLATEGO OSTATNI TEST CZYTA MIGRACJE. Test na samej stalej („czy rowna sie
// approved") zamarlby razem z kodem przy nastepnej zmianie reguly po stronie
// bazy. Bramka porownuje `ARRANGEABLE_STATUSES` z lista `r.status IN (...)`
// z ciala `admin_event_meeting_arrange` - jesli baza zmieni zdanie, czerwieni
// sie tutaj, a nie u organizatora przy stoliku.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  ARRANGEABLE_STATUSES,
  isArrangeableStatus,
  participantLabel,
  searchMeetingParticipants,
  toParticipantOption,
} from "@/lib/events/meetingParticipants";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

beforeEach(() => {
  rpc.mockReset();
});

/** Wiersz w ksztalcie, w jakim oddaje go `admin_event_registrations_list`. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    status: "approved",
    first_name: "Ada",
    last_name: "Lovelace",
    company_name: null,
    company_text: "NES",
    job_title: "Analityk",
    group_id: "g-1",
    ...over,
  };
}

describe("participantLabel", () => {
  it("sklada imie, firme i stanowisko w jednym porzadku", () => {
    expect(participantLabel(row())).toBe("Ada Lovelace - NES - Analityk");
  });

  it("pomija czesci puste zamiast zostawiac puste separatory", () => {
    expect(participantLabel({ first_name: "Ada", last_name: null, job_title: "  " })).toBe("Ada");
  });

  it("woli nazwe firmy z kartoteki niz wpisana recznie", () => {
    expect(participantLabel(row({ company_name: "New European Strategies" }))).toContain(
      "New European Strategies",
    );
    expect(participantLabel(row({ company_name: "New European Strategies" }))).not.toContain("NES");
  });

  it("znosi komplet pustych pol bez wyjatku", () => {
    expect(participantLabel({})).toBe("");
  });

  // Przypadki przeniesione z pierwotnej wersji tego pliku - zostaja, bo opisuja
  // zachowania, ktorych pozostale testy nie dotykaja wprost.
  it("imie zlozone z samych spacji nie tworzy wiszacego separatora", () => {
    expect(participantLabel({ first_name: " ", last_name: null, company_text: "Acme" })).toBe(
      "Acme",
    );
  });

  it("uzywa company_text, gdy zgloszenie nie ma powiazanej firmy", () => {
    expect(
      participantLabel({ first_name: "Ola", last_name: "Zet", company_text: "Firma z wpisu" }),
    ).toBe("Ola Zet - Firma z wpisu");
  });
});

describe("isArrangeableStatus", () => {
  it.each([...ARRANGEABLE_STATUSES])("przepuszcza status %s", (status) => {
    expect(isArrangeableStatus(status)).toBe(true);
  });

  it.each(["pending", "waitlist", "cancelled", "rejected", "draft", "no_show"])(
    "odrzuca status %s",
    (status) => {
      expect(isArrangeableStatus(status)).toBe(false);
    },
  );

  it.each([undefined, null, 42, {}, ["approved"]])("odrzuca wartosc nietekstowa %s", (value) => {
    expect(isArrangeableStatus(value)).toBe(false);
  });

  it("odrzuca `confirmed` - wartosc, ktorej baza nie zna (regresja)", () => {
    expect(isArrangeableStatus("confirmed")).toBe(false);
  });
});

describe("toParticipantOption", () => {
  it("mapuje wiersz na pozycje listy", () => {
    expect(toParticipantOption(row())).toEqual({
      registrationId: "r-1",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "NES",
      jobTitle: "Analityk",
      groupId: "g-1",
      label: "Ada Lovelace - NES - Analityk",
    });
  });

  it("pusty `group_id` czyta jako brak grupy, nie jako pusty napis", () => {
    expect(toParticipantOption(row({ group_id: "" })).groupId).toBeNull();
    expect(toParticipantOption(row({ group_id: null })).groupId).toBeNull();
  });

  // Przypadek przeniesiony z pierwotnej wersji pliku: brak stanowiska ma dac
  // pusty napis w polu i ZNIKNAC z etykiety, a nie zostawic „- " na koncu.
  it("brak stanowiska daje puste pole i etykiete bez ogona", () => {
    expect(
      toParticipantOption({
        id: "reg-1",
        first_name: "Anna",
        last_name: "Kowalska",
        company_name: null,
        company_text: "NES",
        job_title: null,
        group_id: "grp-1",
      }),
    ).toEqual({
      registrationId: "reg-1",
      firstName: "Anna",
      lastName: "Kowalska",
      company: "NES",
      jobTitle: "",
      groupId: "grp-1",
      label: "Anna Kowalska - NES",
    });
  });
});

describe("searchMeetingParticipants", () => {
  it("pyta baze OSOBNO o kazdy dopuszczony status, zamiast odsiewac u siebie", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await searchMeetingParticipants({ eventId: "e-1" });

    expect(rpc).toHaveBeenCalledTimes(ARRANGEABLE_STATUSES.length);
    for (const status of ARRANGEABLE_STATUSES) {
      expect(rpc).toHaveBeenCalledWith(
        "admin_event_registrations_list",
        expect.objectContaining({ p_event_id: "e-1", p_status: status }),
      );
    }
  });

  it("DLUGA LISTA REZERWOWA nie wypycha uczestnikow z wyniku", async () => {
    // To jest cala przyczyna rozbicia na dwa zapytania. RPC sortuje rezerwe NA
    // POCZATEK (`ORDER BY CASE WHEN r.status = 'waitlist' THEN 0 ELSE 1 END`),
    // wiec poprzednia wersja - jedno zapytanie BEZ filtra plus odsiew u siebie -
    // dostawala strone zlozona z samej rezerwy i pokazywala PUSTO, choc osoby
    // do umowienia byly dalej na liscie. Zapas nie mogl tego uratowac: przy dosc
    // dlugiej rezerwie kazdy mnoznik jest za maly.
    //
    // Atrapa odwzorowuje to wprost: zapytanie BEZ filtra statusu oddaje same
    // wiersze rezerwy, a zapytania Z filtrem - prawdziwych uczestnikow.
    rpc.mockImplementation((_fn: string, args: { p_status?: string }) => {
      if (args.p_status === undefined) {
        return Promise.resolve({
          data: Array.from({ length: 80 }, (_, i) =>
            row({ id: `rezerwa-${i}`, status: "waitlist" }),
          ),
          error: null,
        });
      }
      return Promise.resolve({
        data: [row({ id: `ok-${args.p_status}`, status: args.p_status })],
        error: null,
      });
    });

    const out = await searchMeetingParticipants({ eventId: "e-1", limit: 20 });
    expect(out.map((o) => o.registrationId).sort()).toEqual(["ok-approved", "ok-attended"]);
  });

  it("oddaje osobe odprawiona (`attended`) - inaczej gielda jest pusta w trakcie wydarzenia", async () => {
    rpc.mockResolvedValue({
      data: [row({ id: "r-attended", status: "attended" })],
      error: null,
    });
    const out = await searchMeetingParticipants({ eventId: "e-1" });
    expect(out.map((o) => o.registrationId)).toEqual(["r-attended"]);
  });

  it("odsiewa zgloszenia, ktorych baza i tak nie umowi", async () => {
    rpc.mockResolvedValue({
      data: [
        row({ id: "ok", status: "approved" }),
        row({ id: "czeka", status: "pending" }),
        row({ id: "rezerwa", status: "waitlist" }),
        row({ id: "odwolane", status: "cancelled" }),
        row({ id: "obecny", status: "attended" }),
      ],
      error: null,
    });
    const out = await searchMeetingParticipants({ eventId: "e-1" });
    expect(out.map((o) => o.registrationId)).toEqual(["ok", "obecny"]);
  });

  it("prosi baze o tyle, ile obiecuje pokazac - i tyle oddaje po scaleniu stron", async () => {
    // Zapas przestal byc potrzebny: filtr dziala juz w bazie, wiec nic sie po
    // drodze nie odsiewa. Przyciecie zostaje, bo SCALENIE dwoch stron po
    // `limit` wierszy daje ich do dwoch razy wiecej.
    rpc.mockImplementation((_fn: string, args: { p_status?: string }) =>
      Promise.resolve({
        data: Array.from({ length: 40 }, (_, i) =>
          row({ id: `${args.p_status}-${i}`, status: args.p_status }),
        ),
        error: null,
      }),
    );
    const out = await searchMeetingParticipants({ eventId: "e-1", limit: 5 });
    expect(out).toHaveLength(5);
    expect(rpc).toHaveBeenCalledWith(
      "admin_event_registrations_list",
      expect.objectContaining({ p_limit: 5 }),
    );
  });

  it("scalone strony ida od NAJNOWSZEGO - kolejnosc nie zalezy od tego, ktora odpowiedz wrocila pierwsza", async () => {
    // Bez jawnego porzadku wynik zalezalby od wyscigu dwoch zapytan, czyli
    // lista miejscami zmienialaby kolejnosc bez zadnej zmiany danych.
    rpc.mockImplementation((_fn: string, args: { p_status?: string }) =>
      Promise.resolve({
        data:
          args.p_status === "approved"
            ? [row({ id: "starszy", status: "approved", created_at: "2026-01-01T00:00:00Z" })]
            : [row({ id: "nowszy", status: "attended", created_at: "2026-06-01T00:00:00Z" })],
        error: null,
      }),
    );
    const out = await searchMeetingParticipants({ eventId: "e-1" });
    expect(out.map((o) => o.registrationId)).toEqual(["nowszy", "starszy"]);
  });

  it("nie pobiera wiecej niz gorna granica, choćby limit byl absurdalny", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await searchMeetingParticipants({ eventId: "e-1", limit: 10_000 });
    expect(rpc).toHaveBeenCalledWith(
      "admin_event_registrations_list",
      expect.objectContaining({ p_limit: 200 }),
    );
  });

  it("pustą frazę wysyła jako brak frazy, nie jako pusty napis", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await searchMeetingParticipants({ eventId: "e-1", query: "" });
    expect(rpc).toHaveBeenCalledWith(
      "admin_event_registrations_list",
      expect.objectContaining({ p_q: undefined }),
    );
  });

  it("frazę niepustą przekazuje bez zmian", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await searchMeetingParticipants({ eventId: "e-1", query: "Lovelace" });
    expect(rpc).toHaveBeenCalledWith(
      "admin_event_registrations_list",
      expect.objectContaining({ p_q: "Lovelace" }),
    );
  });

  it("brak danych czyta jako pusta liste, nie jako wyjatek", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(searchMeetingParticipants({ eventId: "e-1" })).resolves.toEqual([]);
  });

  it("blad RPC podnosi dalej - dialog ma pokazac odmowe, nie pusta liste", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("forbidden") });
    await expect(searchMeetingParticipants({ eventId: "e-1" })).rejects.toThrow("forbidden");
  });
});

describe("bramka: lista statusow zgadza sie z migracja", () => {
  /** Cialo `admin_event_meeting_arrange` z NAJNOWSZEJ migracji, ktora je definiuje. */
  function arrangeBody(): string {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    let found = "";
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const at = sql.toLowerCase().indexOf("function public.admin_event_meeting_arrange(");
      if (at === -1) continue;
      const start = sql.toLowerCase().lastIndexOf("create", at);
      const end = sql.indexOf("$$;", start);
      found = sql.slice(start, end === -1 ? undefined : end);
    }
    return found;
  }

  it("znajduje definicje RPC (test nie jest prozny)", () => {
    expect(arrangeBody().length).toBeGreaterThan(500);
  });

  it("`ARRANGEABLE_STATUSES` to dokladnie zbior z `r.status IN (...)`", () => {
    const body = arrangeBody();
    const matches = [...body.matchAll(/r\.status\s+IN\s*\(([^)]*)\)/gi)];
    expect(matches.length).toBeGreaterThan(0);

    const fromSql = new Set(
      matches
        .flatMap((m) => m[1].split(","))
        .map((part) => part.trim().replace(/^'|'$/g, ""))
        .filter((part) => part.length > 0),
    );

    expect([...fromSql].sort()).toEqual([...ARRANGEABLE_STATUSES].sort());
  });

  it("kazdy status z listy przechodzi CHECK na kolumnie `status`", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    let allowed: Set<string> | null = null;
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const m = sql.match(
        /CONSTRAINT\s+event_registrations_status_values\s+CHECK\s*\(\s*status\s+IN\s*\(([\s\S]*?)\)\s*\)/i,
      );
      if (m) {
        allowed = new Set(
          m[1]
            .split(",")
            .map((part) => part.trim().replace(/^'|'$/g, ""))
            .filter((part) => part.length > 0),
        );
      }
    }
    expect(allowed, "nie znaleziono CHECK-a na event_registrations.status").not.toBeNull();
    for (const status of ARRANGEABLE_STATUSES) {
      expect(allowed as Set<string>).toContain(status);
    }
    // Regresja: wartosc sprzed naprawy NIE jest w CHECK-u - to jest powod,
    // dla ktorego wyszukiwarka nie zwracala niczego.
    expect(allowed as Set<string>).not.toContain("confirmed");
  });
});
