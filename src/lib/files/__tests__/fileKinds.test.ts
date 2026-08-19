// Rozpoznawanie typu pliku - czysta warstwa decyzji podglądu.
//
// DLACZEGO OD TEGO ZACZYNA SIĘ BIBLIOTEKA PLIKÓW. Audyt 18.08 (MODUŁ 7) podał
// tę funkcjonalność jako JEDYNĄ na absolutnym zerze: 5 plików, 0 z 72 funkcji,
// 229 linii bez ani jednego wykonania. `fileKinds.ts` jest w tej piątce jedynym
// modułem bez zależności - i jednocześnie tym, który odpowiada na pytanie
// zadawane w TRZECH miejscach produktu naraz (kafelek wpisu klubowego, nagłówek
// popupu, wybór czytnika): „czym właściwie jest ten plik".
//
// MIME NIE WYSTARCZA i to jest cała trudność tego modułu. Przeglądarka potrafi
// oddać puste `type` dla .csv czy .docx z dysku sieciowego, a Windows bywa, że
// podaje `application/octet-stream`. Każdy przypadek poniżej, w którym MIME
// kłóci się z rozszerzeniem, jest przepisanym zgłoszeniem z prawdziwego świata,
// nie ćwiczeniem z tabelki.
import { describe, expect, it } from "vitest";
import {
  extensionOf,
  fileLabel,
  humanSize,
  isPreviewable,
  needsClientParse,
  viewerKindFor,
} from "@/lib/files/fileKinds";

describe("extensionOf", () => {
  it("zwraca rozszerzenie małymi literami", () => {
    expect(extensionOf("Raport.PDF")).toBe("pdf");
  });

  it("bierze rozszerzenie po OSTATNIEJ kropce", () => {
    expect(extensionOf("raport.2026.final.docx")).toBe("docx");
  });

  it("dla nazwy bez kropki zwraca pusty napis", () => {
    expect(extensionOf("README")).toBe("");
  });

  it("dla nazwy zakończonej kropką zwraca pusty napis", () => {
    // „raport." nie ma rozszerzenia - bez tego warunku funkcja oddałaby "",
    // ale przez `slice` poza zakresem, a nie przez świadomą decyzję.
    expect(extensionOf("raport.")).toBe("");
  });

  it("dla pliku ukrytego traktuje część po kropce jak rozszerzenie", () => {
    expect(extensionOf(".gitignore")).toBe("gitignore");
  });

  it("dla pustej nazwy zwraca pusty napis", () => {
    expect(extensionOf("")).toBe("");
  });
});

describe("fileLabel", () => {
  it("etykieta bierze się z rozszerzenia, wielkimi literami", () => {
    expect(fileLabel("raport.pdf", "application/pdf")).toBe("PDF");
  });

  it("rozszerzenie wygrywa z typem MIME", () => {
    expect(fileLabel("dane.csv", "application/octet-stream")).toBe("CSV");
  });

  it("bez rozszerzenia schodzi do podtypu MIME", () => {
    expect(fileLabel("bez-rozszerzenia", "application/pdf")).toBe("PDF");
  });

  it("przycina etykietę do pięciu znaków - kafelek ma stałą szerokość", () => {
    expect(fileLabel("archiwum.tarball", "")).toBe("TARBA");
    expect(fileLabel("plik", "application/vnd.openxmlformats")).toBe("VND.O");
  });

  it("bez rozszerzenia i bez MIME daje neutralne FILE", () => {
    expect(fileLabel("plik", "")).toBe("FILE");
  });

  it("MIME bez podtypu też daje FILE", () => {
    expect(fileLabel("plik", "application/")).toBe("FILE");
  });

  it("etykieta jest neutralna językowo - to nie jest napis do tłumaczenia", () => {
    // Świadoma decyzja: „PDF" i „FILE" są takie same w PL i EN, więc etykieta
    // NIE przechodzi przez i18n. Gdyby kiedyś miała - ten test zgaśnie
    // i zmusi do przeniesienia jej do słownika, zamiast cicho zostawić
    // angielski napis na polskiej stronie.
    expect(fileLabel("plik", "")).toBe("FILE");
  });
});

describe("viewerKindFor - kolejność rozpoznawania", () => {
  it.each([
    ["raport.pdf", "application/pdf", "pdf"],
    ["raport.pdf", "", "pdf"],
    ["bez-nazwy", "application/pdf", "pdf"],
    ["umowa.docx", "", "docx"],
    ["umowa.doc", "", "docx"],
    ["umowa", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["budzet.xlsx", "", "xlsx"],
    ["budzet.xls", "", "xlsx"],
    ["budzet.ods", "", "xlsx"],
    ["budzet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["deck.pptx", "", "pptx"],
    ["deck.ppt", "", "pptx"],
    ["deck.odp", "", "pptx"],
    ["deck", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
    ["dane.csv", "", "csv"],
    ["dane", "text/csv", "csv"],
    ["notatka.md", "", "markdown"],
    ["notatka.markdown", "", "markdown"],
    ["notatka", "text/markdown", "markdown"],
    ["zdjecie.jpg", "", "image"],
    ["zdjecie.svg", "", "image"],
    ["zdjecie", "image/avif", "image"],
    ["film.mp4", "", "video"],
    ["film", "video/quicktime", "video"],
    ["audycja.mp3", "", "audio"],
    ["audycja", "audio/ogg", "audio"],
    ["log.txt", "", "text"],
    ["dane.json", "", "text"],
    ["styl.css", "", "text"],
    ["plik", "text/plain", "text"],
    ["paczka.zip", "", "archive"],
    ["paczka.7z", "", "archive"],
    ["cokolwiek.bin", "application/octet-stream", "unknown"],
    ["", "", "unknown"],
  ])("%s + %s -> %s", (name, mime, expected) => {
    expect(viewerKindFor(mime, name)).toBe(expected);
  });

  it("puste MIME z pendrive'a nie psuje rozpoznania formatu biurowego", () => {
    // Zgłoszenie z życia: .docx wybrany z dysku sieciowego przychodzi z pustym
    // `type`. Gdyby decyzja szła po samym MIME, użytkownik dostałby
    // „nie pokazujemy tego formatu" dla własnego raportu.
    expect(viewerKindFor("", "raport-roczny.docx")).toBe("docx");
  });

  it("application/octet-stream z Windows nie psuje rozpoznania CSV", () => {
    expect(viewerKindFor("application/octet-stream", "eksport.csv")).toBe("csv");
  });

  it("MIME wielkimi literami jest rozpoznawany tak samo", () => {
    // Nagłówek `Content-Type` bywa podawany wielkimi literami; `toLowerCase()`
    // w funkcji jest jedynym powodem, dla którego to działa.
    expect(viewerKindFor("APPLICATION/PDF", "plik")).toBe("pdf");
    expect(viewerKindFor("IMAGE/PNG", "plik")).toBe("image");
  });

  it("format biurowy wygrywa z ogólnym prefiksem MIME", () => {
    // Kolejność w funkcji nie jest przypadkowa: .docx podany jako text/plain
    // ma iść do czytnika Worda, nie do podglądu tekstu.
    expect(viewerKindFor("text/plain", "umowa.docx")).toBe("docx");
  });

  it("CSV wygrywa z ogólnym text/*", () => {
    expect(viewerKindFor("text/plain", "eksport.csv")).toBe("csv");
  });
});

describe("isPreviewable", () => {
  it("format z czytnikiem otwiera popup", () => {
    expect(isPreviewable("application/pdf", "raport.pdf")).toBe(true);
    expect(isPreviewable("", "umowa.docx")).toBe(true);
  });

  it("archiwum NIE otwiera popupu - nie ma czego pokazać", () => {
    expect(isPreviewable("", "paczka.zip")).toBe(false);
  });

  it("nieznany format NIE otwiera popupu", () => {
    // To jest ta decyzja, która sprawia, że przycisk „Podgląd" nie pojawia się
    // tam, gdzie kliknięcie skończyłoby się komunikatem o błędzie.
    expect(isPreviewable("application/octet-stream", "cokolwiek.bin")).toBe(false);
  });
});

describe("needsClientParse", () => {
  it.each(["docx", "xlsx", "pptx"] as const)("%s wymaga parsowania w przeglądarce", (kind) => {
    expect(needsClientParse(kind)).toBe(true);
  });

  it.each([
    "pdf",
    "image",
    "video",
    "audio",
    "text",
    "markdown",
    "csv",
    "archive",
    "unknown",
  ] as const)("%s nie wymaga parsowania", (kind) => {
    expect(needsClientParse(kind)).toBe(false);
  });
});

describe("humanSize", () => {
  it("dla braku rozmiaru zwraca pusty napis, nie „0 B”", () => {
    expect(humanSize(null)).toBe("");
    expect(humanSize(undefined)).toBe("");
    expect(humanSize(0)).toBe("");
    expect(humanSize(-1)).toBe("");
  });

  it("bajty pokazuje bez części dziesiętnej", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(1023)).toBe("1023 B");
  });

  it("przechodzi na kilobajty dokładnie przy 1024", () => {
    expect(humanSize(1024)).toBe("1.0 kB");
  });

  it("poniżej dziesięciu jednostek pokazuje jedno miejsce po przecinku", () => {
    expect(humanSize(1536)).toBe("1.5 kB");
  });

  it("od dziesięciu jednostek zaokrągla do pełnych", () => {
    expect(humanSize(10 * 1024)).toBe("10 kB");
    expect(humanSize(1024 * 1024)).toBe("1.0 MB");
  });

  it("zatrzymuje się na gigabajtach - nie ma jednostki wyżej", () => {
    // Pętla ma warunek `unit < units.length - 1`; bez niego indeks wyszedłby
    // poza tablicę i etykieta zrobiłaby się `undefined`.
    expect(humanSize(5 * 1024 ** 4)).toBe("5120 GB");
  });

  it("jest neutralny językowo - separatorem jest kropka w obu wersjach", () => {
    // Rozmiar nie przechodzi przez i18n świadomie: `toFixed` daje kropkę,
    // a mieszanie separatorów w jednej liście plików jest gorsze niż jeden
    // wspólny. Ten test pilnuje, żeby to była DECYZJA, a nie przeoczenie.
    expect(humanSize(1536)).toContain(".");
  });
});
