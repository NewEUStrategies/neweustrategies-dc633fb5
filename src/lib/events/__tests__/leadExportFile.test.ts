// EKSPORT LEADOW - to, co WYCHODZI Z SYSTEMU i to, co go OPUSZCZA NA DYSK.
//
// PO CO TEN PLIK OBOK `leadExport.test.ts`. Tamten opisuje ksztalt komorek.
// Tutaj stoja trzy pytania, ktorych nikt jeszcze nie zadal, a kazde ma cene:
//
//   1. RODO. `leadExportCells` sklada plik z DANYCH OSOBOWYCH uczestnika i jest
//      OSTATNIM miejscem przed dyskiem sponsora. Naglowek modulu zaklada, ze
//      wiersz bez zgody przychodzi z RPC z pustym kontaktem - ten plik sprawdza,
//      co sie stanie, gdy zalozenie przestanie byc prawda.
//   2. ZBIOR PUSTY. Sponsor bez ani jednego skanu ma dostac plik z naglowkiem,
//      a nie wyjatek w konsoli - inaczej „eksport nie dziala" trafia do
//      zgloszenia zamiast „nikt nie skanowal".
//   3. ZAPIS NA DYSK. `downloadLeadExport` jest jedynym fragmentem zaleznym od
//      przegladarki i jedynym, ktory moze wyciec pamiecia albo zostawic kotwice
//      w dokumencie.
//
// RODO W FIXTURE'ACH: dane syntetyczne, adresy wylacznie w `example.com`.
import { describe, expect, it, vi } from "vitest";
import {
  buildLeadExport,
  downloadLeadExport,
  leadExportCells,
  leadExportColumns,
  leadExportFileName,
} from "@/lib/events/leadExport";
import type { LeadExportRow } from "@/lib/events/onsiteApi";

/** Indeksy kolumn kontaktowych - te same w obu jezykach (kolejnosc jest kontraktem). */
const KOL_EMAIL = 5;
const KOL_TELEFON = 6;
const KOL_ZGODA = 7;
const KOL_ZGODA_ZAPISANA = 8;

function lead(overrides: Partial<LeadExportRow> = {}): LeadExportRow {
  return {
    sponsor_name: "Sponsor Testowy",
    first_name: "Ewa",
    last_name: "Testowa",
    company: "Firma Przykladowa",
    job_title: "Analityk",
    email: "ewa.testowa@example.com",
    phone: "+48 500 000 001",
    consent: true,
    consent_snapshot_at: "2026-05-01T09:10:00Z",
    interest_rating: 3,
    note: "Prosi o material",
    scan_count: 1,
    first_scanned_at: "2026-05-01T09:10:00Z",
    last_scanned_at: "2026-05-01T09:10:00Z",
    device_label: "Stoisko A",
    ...overrides,
  };
}

describe("eksport nie wynosi wiecej, niz obejmuje zgoda", () => {
  it("kolumna zgody mowi wprost, ktore wiersze wolno wykorzystac", () => {
    // Sponsor rozlicza sie z LICZBY skanow, wiec wiersz bez zgody zostaje
    // w pliku. Musi jednak byc rozpoznawalny bez czytania kontaktu - inaczej
    // handlowiec dzwoni do kogos, kto sie na to nie zgodzil.
    const bez = leadExportCells(lead({ consent: false, email: "", phone: "" }), "pl");
    expect(bez[KOL_ZGODA]).toBe("nie");
    expect(bez[KOL_EMAIL]).toBe("");
    expect(bez[KOL_TELEFON]).toBe("");
    // Sponsor zagraniczny czyta ten sam plik po angielsku. Polskie „nie"
    // w jego kolumnie zgody jest dla niego napisem bez znaczenia - a decyzja,
    // czy wolno zadzwonic, zapada wlasnie na tej komorce.
    expect(leadExportCells(lead({ consent: false }), "en")[KOL_ZGODA]).toBe("no");
    expect(leadExportCells(lead(), "en")[KOL_ZGODA]).toBe("yes");
  });

  it("data zapisania zgody jedzie razem ze zgoda - bez niej nie da sie jej udowodnic", () => {
    // Rejestr zgod bez znacznika czasu jest bezuzyteczny przy kontroli: nie
    // wiadomo, czy zgoda poprzedzala kontakt.
    const cells = leadExportCells(lead(), "pl");
    expect(cells[KOL_ZGODA]).toBe("tak");
    expect(cells[KOL_ZGODA_ZAPISANA]).toBe("2026-05-01T09:10:00Z");
  });

  it("plik nie ma zadnej kolumny spoza uzgodnionego zestawu", () => {
    // Liczba komorek rowna liczbie kolumn to jedyne, co pilnuje, zeby nowe pole
    // z RPC nie doklejalo sie do pliku po cichu, bez decyzji o zgodzie.
    for (const lang of ["pl", "en"]) {
      expect(leadExportCells(lead(), lang)).toHaveLength(leadExportColumns(lang).length);
    }
    expect(leadExportColumns("pl")).toHaveLength(15);
  });

  // DEFEKT NAPRAWIONY W PRODUKCJI: redakcja kontaktu stoi juz takze w kliencie.
  //
  // Wczesniej siedziala WYLACZNIE w SQL: naglowek modulu stwierdzal jako fakt,
  // ze „w takich wierszach kontakt jest pusty", i budowal plik z tego, co
  // dostal. Regresja po stronie RPC (nowa kolumna w SELECT, zmieniony warunek,
  // wiersz z innego zrodla) wychodzila wtedy z budynku jako plik CSV na dysku
  // sponsora - zdarzenie nieodwracalne i podlegajace zgloszeniu. Ostatnia
  // bramka przed dyskiem zeruje kontakt, gdy `consent` nie jest `true`.
  it("kontakt bez zgody nie trafia do pliku, nawet gdy RPC go poda", () => {
    const cells = leadExportCells(
      lead({ consent: false, email: "brak.zgody@example.com", phone: "+48 500 000 002" }),
      "pl",
    );
    expect(cells[KOL_ZGODA]).toBe("nie");
    // Asercja NIE narzuca postaci redakcji (pusty napis czy `null`) - pyta
    // wylacznie o to, czy kontakt opuszcza system. Dzieki temu zapali sie na
    // czerwono w dniu, w ktorym redakcja przestanie dzialac, niezaleznie od
    // tego, czym produkcja zeruje kolumne.
    expect(cells[KOL_EMAIL]).not.toBe("brak.zgody@example.com");
    expect(cells[KOL_TELEFON]).not.toBe("+48 500 000 002");
  });
});

describe("zbior pusty daje plik, nie wyjatek", () => {
  it("CSV bez ani jednego skanu ma sam naglowek i BOM", async () => {
    const file = await buildLeadExport([], {
      format: "csv",
      lang: "pl",
      prefix: "Leady",
      nowIso: "2026-05-01T10:00:00Z",
    });
    // `data` jest unia `string | ArrayBuffer` - rozstrzyga ja asercja, a nie
    // rzutowanie, ktore samo niczego nie sprawdza.
    expect(typeof file.data).toBe("string");
    const text = typeof file.data === "string" ? file.data : "";
    // Naglowek zostaje, bo sponsor otwiera plik w arkuszu i musi zobaczyc, ze
    // eksport sie wykonal i nie mial czego wypisac.
    expect(text).toBe(`\uFEFF${leadExportColumns("pl").join(",")}`);
    expect(text.split("\n")).toHaveLength(1);
    expect(file.fileName).toBe("leady-2026-05-01.csv");
  });

  it("XLSX bez ani jednego skanu tez powstaje", async () => {
    const file = await buildLeadExport([], {
      format: "xlsx",
      lang: "pl",
      prefix: "Leady",
      nowIso: "2026-05-01T10:00:00Z",
    });
    // Niepusta tablica bajtow to jeszcze nie skoroszyt. Sponsor ma otworzyc
    // plik w arkuszu i zobaczyc naglowek - inaczej „eksport nie dziala"
    // trafia do zgloszenia zamiast „nikt nie skanowal".
    expect(file.data).toBeInstanceOf(ArrayBuffer);
    const XLSX = await import("xlsx");
    const skoroszyt = XLSX.read(file.data, { type: "array" });
    const wiersze = XLSX.utils.sheet_to_json<string[]>(skoroszyt.Sheets[skoroszyt.SheetNames[0]], {
      header: 1,
    });
    expect(wiersze).toEqual([[...leadExportColumns("pl")]]);
    expect(file.fileName).toBe("leady-2026-05-01.xlsx");
    // Zly typ MIME sprawia, ze przegladarka zapisuje plik jako `.zip` albo
    // otwiera go w karcie zamiast oddac arkuszowi.
    expect(file.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });
});

describe("arkusz w jezyku operatora", () => {
  it("polski eksport ma arkusz 'Leady', angielski 'Leads'", async () => {
    const XLSX = await import("xlsx");
    const pl = await buildLeadExport([lead()], {
      format: "xlsx",
      lang: "pl",
      prefix: "Leady",
      nowIso: "2026-05-01T10:00:00Z",
    });
    const en = await buildLeadExport([lead()], {
      format: "xlsx",
      lang: "en",
      prefix: "Leads",
      nowIso: "2026-05-01T10:00:00Z",
    });
    // Nazwa zakladki jest jedynym opisem, jaki widzi ktos, kto sklei kilka
    // eksportow w jeden skoroszyt.
    expect(XLSX.read(pl.data, { type: "array" }).SheetNames).toEqual(["Leady"]);
    expect(XLSX.read(en.data, { type: "array" }).SheetNames).toEqual(["Leads"]);
  });
});

describe("nazwa pliku nie miesza eksportow z roznych dni", () => {
  it("dzien pochodzi ze znacznika przekazanego przez wolajacego", () => {
    // Dwa eksporty tego samego sponsora z dwoch dni musza dac dwa pliki -
    // inaczej drugi nadpisuje pierwszy w katalogu Pobrane.
    const pierwszy = leadExportFileName("Leady", "2026-05-01T23:59:00Z", "csv");
    const drugi = leadExportFileName("Leady", "2026-05-02T00:01:00Z", "csv");
    // Dzien bierze sie z ISO, wiec 23:59 to jeszcze pierwszy dzien - sama
    // roznica nazw przepuscilaby przesuniecie obu o dobe.
    expect(pierwszy).toBe("leady-2026-05-01.csv");
    expect(drugi).toBe("leady-2026-05-02.csv");
  });
});

describe("zapis pliku na dysk operatora", () => {
  it("oddaje plik pod wlasna nazwa, zwalnia URL i nie idzie do sieci", async () => {
    const createUrl = vi.fn(() => "blob:mock/leady");
    const revokeUrl = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    vi.stubGlobal("fetch", fetchSpy);
    const pobrane: Array<{ nazwa: string; href: string }> = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      pobrane.push({ nazwa: this.download, href: this.href });
    };

    try {
      const file = await buildLeadExport([lead()], {
        format: "csv",
        lang: "pl",
        prefix: "Leady sponsorow",
        nowIso: "2026-05-01T10:00:00Z",
      });
      downloadLeadExport(file);

      // Nazwa z `buildLeadExport` musi dojechac az do dysku - operator
      // rozpoznaje eksport wylacznie po niej.
      expect(pobrane).toEqual([
        { nazwa: "leady-sponsorow-2026-05-01.csv", href: "blob:mock/leady" },
      ]);
      // Bez zwolnienia URL-a kazdy eksport zostawia caly plik w pamieci karty;
      // operator eksportuje sponsorow w petli, wiec to rosnie liniowo.
      expect(revokeUrl).toHaveBeenCalledWith("blob:mock/leady");
      // Dane osobowe nie moga isc nigdzie poza dysk operatora.
      expect(fetchSpy).not.toHaveBeenCalled();
      // Kotwica nie zostaje w dokumencie - inaczej rosnie z kazdym pobraniem.
      expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      vi.unstubAllGlobals();
    }
  });
});
