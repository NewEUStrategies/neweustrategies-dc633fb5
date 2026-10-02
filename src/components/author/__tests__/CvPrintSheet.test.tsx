// ARKUSZ CV DO PDF I PRZYCISK „POBIERZ CV" - silnikiem PDF jest `window.print`.
//
// CO DOWODZI TEN PLIK:
//  1. ARKUSZ: portal na końcu <body>, ukryty przed czytnikiem ekranu (to kopia
//     treści profilu), z sekcjami tylko dla niepustych list i metadanymi
//     sklejonymi bez pustych członów.
//  2. HYDRATACJA: serwer nie ma `document`, więc arkusza nie renderuje. Portal
//     w PIERWSZYM renderze klienta to niezgodność hydratacji - React porzuca
//     wtedy HTML serwera. Test renderuje „serwer" bez `document` i hydratuje.
//  3. CYKL DRUKU: klasa `cv-print-mode` i tytuł „CV - …" na czas druku, druk
//     w następnej klatce, sprzątanie po `afterprint` - także przy podwójnym
//     kliknięciu i przy wyjściu ze strony przed klatką druku.
//  4. ZAKRES DAT: kolumny DATE formatowane w UTC, odwrócony zakres
//     chronologicznie, śmieć z bazy znika zamiast „Invalid Date".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import type { AuthorCv } from "@/lib/queries/authorCv";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  fixedT: null as null | typeof realT,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/lib/i18n/useLang", () => ({ useLang: () => h.lang }));

import { realT } from "@/test/i18nReal";
import { CvDownloadButton, CvPrintSheet } from "@/components/author/CvPrintSheet";
import { formatCvDateRange, formatCvMonth } from "@/components/author/cvDates";

h.fixedT = realT;

const FULL_CV: AuthorCv = {
  experiences: [
    {
      id: "e1",
      role_title: "Analityczka",
      company: "NES",
      location: "Warszawa",
      start_date: "2019-05-01",
      end_date: null,
      is_current: true,
      description: "Energetyka",
      logo_url: null,
    },
    {
      id: "e2",
      role_title: null,
      company: null,
      location: null,
      start_date: null,
      end_date: null,
      is_current: false,
      description: null,
      logo_url: null,
    },
  ],
  education: [
    {
      id: "ed1",
      school: null,
      degree: "Magister",
      field: null,
      start_date: "2012-10-01",
      end_date: "2017-06-30",
      description: "Praca o NATO",
      logo_url: null,
    },
  ],
  skills: [
    { id: "s1", label: "Analiza", level: 4, category: null },
    { id: "s2", label: "Negocjacje", level: null, category: null },
  ],
  awards: [
    {
      id: "a1",
      title: "Nagroda Roku",
      issuer: "Fundacja",
      awarded_at: "2020-03-01",
      description: "Za raport",
      icon: null,
      url: null,
      kind: null,
    },
    {
      id: "a2",
      title: "Wyróżnienie",
      issuer: null,
      awarded_at: null,
      description: null,
      icon: null,
      url: null,
      kind: null,
    },
  ],
  hobbies: [
    { id: "h1", label: "Żeglarstwo", icon: "⛵" },
    { id: "h2", label: "Szachy", icon: null },
  ],
};

const EMPTY_CV: AuthorCv = { experiences: [], education: [], skills: [], awards: [], hobbies: [] };

function sheet(): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(".cv-print-sheet");
  if (!el) throw new Error("brak arkusza CV w <body>");
  return el;
}

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  h.lang = "pl";
  document.title = "Anna Nowak - profil";
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("cv-print-mode");
  document.body.innerHTML = "";
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CvPrintSheet - treść arkusza", () => {
  it("montuje się portalem w <body>, poza drzewem dostępności", () => {
    const { container } = render(<CvPrintSheet identity={{ name: "Anna Nowak" }} cv={FULL_CV} />);
    expect(container).toBeEmptyDOMElement();
    expect(sheet().parentElement).toBe(document.body);
    expect(sheet()).toHaveAttribute("aria-hidden");
  });

  it("nagłówek: imię, stanowisko · firma, kontakt i stopka z adresem profilu", () => {
    render(
      <CvPrintSheet
        identity={{
          name: "Anna Nowak",
          jobTitle: "Analityczka",
          company: "NES",
          contactEmail: "anna@example.org",
          websiteUrl: "https://anna.example.org",
          profileUrl: "https://nes.example.org/author/anna",
        }}
        cv={EMPTY_CV}
      />,
    );
    expect(sheet().querySelector("h1")).toHaveTextContent("Anna Nowak");
    expect(sheet().querySelector(".cv-print-subtitle")).toHaveTextContent("Analityczka · NES");
    expect(sheet().querySelector(".cv-print-contact")).toHaveTextContent(
      "anna@example.org · https://anna.example.org",
    );
    expect(sheet().querySelector(".cv-print-footer")).toHaveTextContent(
      "Pełny profil: https://nes.example.org/author/anna",
    );
    // Puste listy CV nie zostawiają nagłówków sekcji.
    expect(sheet().querySelectorAll("section")).toHaveLength(0);
  });

  it("tożsamość z samą firmą: podtytuł bez separatora, bez kontaktu i stopki", () => {
    render(<CvPrintSheet identity={{ name: "Anna Nowak", company: "NES" }} cv={EMPTY_CV} />);
    expect(sheet().querySelector(".cv-print-subtitle")).toHaveTextContent(/^NES$/);
    expect(sheet().querySelector(".cv-print-contact")).toBeNull();
    expect(sheet().querySelector(".cv-print-footer")).toBeNull();
  });

  it("sekcje arkusza sklejają metadane bez pustych członów", () => {
    // Strefa na zachód od UTC: data nagrody (kolumna DATE) nie może się cofnąć
    // na luty, jak przy `toLocaleDateString` bez jawnej strefy.
    process.env.TZ = "America/New_York";
    render(<CvPrintSheet identity={{ name: "Anna Nowak" }} cv={FULL_CV} />);
    const headings = [...sheet().querySelectorAll("h2")].map((el) => el.textContent);
    expect(headings).toEqual([
      "Doświadczenie zawodowe",
      "Edukacja",
      "Umiejętności",
      "Wyróżnienia i certyfikaty",
      "Zainteresowania",
    ]);
    const [current, blank] = sheet().querySelectorAll("section:first-of-type article");
    expect(current.querySelector("h3")).toHaveTextContent("Analityczka · NES");
    expect(current.querySelector(".cv-print-meta")).toHaveTextContent(
      "maj 2019 - obecnie · Warszawa",
    );
    expect(current.querySelector(".cv-print-desc")).toHaveTextContent("Energetyka");
    expect(blank.querySelector("h3")?.textContent).toBe("Stanowisko");
    expect(blank.querySelector(".cv-print-meta")?.textContent).toBe("");

    const edu = sheet().querySelectorAll("section")[1];
    expect(edu.querySelector("h3")).toHaveTextContent("Uczelnia");
    expect(edu.querySelector(".cv-print-meta")).toHaveTextContent("Magister · paź 2012 - cze 2017");

    const skills = sheet().querySelectorAll(".cv-print-skills");
    expect(skills[0]).toHaveTextContent("Analiza (4/5) · Negocjacje");
    expect(skills[1]).toHaveTextContent("Żeglarstwo · Szachy");

    const awards = sheet().querySelectorAll("section")[3].querySelectorAll("article");
    expect(awards[0].querySelector(".cv-print-meta")).toHaveTextContent("Fundacja · marzec 2020");
    expect(awards[0].querySelector(".cv-print-desc")).toHaveTextContent("Za raport");
    expect(awards[1].querySelector(".cv-print-meta")?.textContent).toBe("");
  });

  it("serwer (bez `document`) nie renderuje arkusza, a hydratacja przechodzi bez niezgodności", async () => {
    const view = (
      <div>
        <p>profil</p>
        <CvPrintSheet identity={{ name: "Anna Nowak" }} cv={FULL_CV} />
        <p>stopka</p>
      </div>
    );
    vi.stubGlobal("document", undefined);
    const serverHtml = renderToString(view);
    vi.unstubAllGlobals();
    expect(serverHtml).not.toContain("cv-print-sheet");

    const host = document.createElement("div");
    host.innerHTML = serverHtml;
    document.body.append(host);
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
    });
    try {
      expect(errors).toEqual([]);
      // Po hydratacji arkusz dochodzi portalem - druk działa jak dotąd.
      expect(document.body.querySelector(".cv-print-sheet")).not.toBeNull();
      expect(host.querySelector(".cv-print-sheet")).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

describe("CvDownloadButton - cykl druku", () => {
  function stubPrinting() {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      nextFrame += 1;
      frames.set(nextFrame, cb);
      return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const flushFrames = () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const cb of pending) cb(0);
    };
    return { print, flushFrames };
  }

  it("przycisk ma etykietę i podpowiedź ze słownika", () => {
    render(<CvDownloadButton identity={{ name: "Anna Nowak" }} />);
    const button = screen.getByRole("button", { name: "Pobierz CV (PDF)" });
    expect(button).toHaveAttribute("title", "Pobierz CV jako PDF (drukowanie do pliku)");
    expect(button).toHaveAttribute("type", "button");
  });

  it("klik włącza tryb druku i tytuł pliku, drukuje w następnej klatce, `afterprint` sprząta", () => {
    const { print, flushFrames } = stubPrinting();
    render(<CvDownloadButton identity={{ name: "Anna Nowak" }} />);
    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement).toHaveClass("cv-print-mode");
    expect(document.title).toBe("CV - Anna Nowak");
    expect(print).not.toHaveBeenCalled();
    flushFrames();
    expect(print).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("afterprint"));
    expect(document.documentElement).not.toHaveClass("cv-print-mode");
    expect(document.title).toBe("Anna Nowak - profil");

    // Słuchacz odpiął się sam - kolejny `afterprint` nie rusza tytułu strony.
    document.title = "Inna strona";
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Inna strona");
  });

  it("podwójne kliknięcie drukuje raz i po druku przywraca PRAWDZIWY tytuł strony", () => {
    const { print, flushFrames } = stubPrinting();
    render(<CvDownloadButton identity={{ name: "Anna Nowak" }} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    flushFrames();
    expect(print).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Anna Nowak - profil");
    expect(document.documentElement).not.toHaveClass("cv-print-mode");
  });

  it("wyjście ze strony przed klatką druku nie otwiera okna drukowania i sprząta stan", () => {
    const { print, flushFrames } = stubPrinting();
    const { unmount } = render(<CvDownloadButton identity={{ name: "Anna Nowak" }} />);
    fireEvent.click(screen.getByRole("button"));
    unmount();
    flushFrames();

    expect(print).not.toHaveBeenCalled();
    expect(document.documentElement).not.toHaveClass("cv-print-mode");
    expect(document.title).toBe("Anna Nowak - profil");
  });

  it("wyjście ze strony w trakcie druku (przed `afterprint`) też zdejmuje tryb druku", () => {
    const { print, flushFrames } = stubPrinting();
    const { unmount } = render(<CvDownloadButton identity={{ name: "Anna Nowak" }} />);
    fireEvent.click(screen.getByRole("button"));
    flushFrames();
    unmount();

    expect(print).toHaveBeenCalledTimes(1);
    expect(document.documentElement).not.toHaveClass("cv-print-mode");
    expect(document.title).toBe("Anna Nowak - profil");
  });
});

describe("formatCvDateRange / formatCvMonth - daty CV", () => {
  const t = realT("pl");

  it("pełny zakres, zakres otwarty i pojedyncza data", () => {
    expect(formatCvDateRange("2019-05-01", "2021-01-15", false, "pl", t)).toBe(
      "maj 2019 - sty 2021",
    );
    expect(formatCvDateRange("2019-05-01", null, true, "pl", t)).toBe("maj 2019 - obecnie");
    expect(formatCvDateRange(null, "2021-01-15", null, "pl", t)).toBe("sty 2021");
    expect(formatCvDateRange(null, null, null, "pl", t)).toBe("");
  });

  it("odwrócony zakres wraca chronologicznie, ale „obecnie” nigdy nie zamienia stron", () => {
    expect(formatCvDateRange("2021-01-15", "2018-05-01", false, "pl", t)).toBe(
      "maj 2018 - sty 2021",
    );
    expect(formatCvDateRange("2021-01-15", "2018-05-01", true, "pl", t)).toBe("sty 2021 - obecnie");
  });

  it("uszkodzona data znika zamiast drukować „Invalid Date”", () => {
    expect(formatCvDateRange("nie-data", "2021-01-15", false, "pl", t)).toBe("sty 2021");
    expect(formatCvMonth("2021-13-45", "pl", "long")).toBe("");
  });

  it("miesiąc liczony w UTC - strefa maszyny na zachód od UTC go nie cofa", () => {
    process.env.TZ = "America/New_York";
    expect(formatCvMonth("2020-03-01", "pl", "long")).toBe("marzec 2020");
    expect(formatCvMonth("2020-03-01T00:00:00+00:00", "en", "long")).toBe("March 2020");
    expect(formatCvMonth("2020-03-01", "en", "short")).toBe("Mar 2020");
  });
});
