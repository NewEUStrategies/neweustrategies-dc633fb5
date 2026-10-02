// Box „Cytuj tę analizę" - to, co faktycznie trafia do schowka czytelnika.
//
// `postComposition.test.tsx` sprawdza, że box się składa i że kopiowanie
// w ogóle coś wkłada do schowka. Tu są reguły, od których zależy jakość
// cytatu w cudzej pracy: Chicago idzie do schowka BEZ znaczników HTML, APA
// i BibTeX dosłownie; potwierdzenie gaśnie po 2 s i odnawia się przy kolejnym
// kopiowaniu; data dostępu to dzień CZYTELNIKA. Ta ostatnia była liczona
// z `toISOString()` (dzień UTC) - w Warszawie tuż po północy cytat dostawał
// wczorajszą datę dostępu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CitationBox, type CitationBoxProps } from "@/components/post/CitationBox";
import { buildCitations } from "@/lib/citations/format";

const ORIGINAL_TZ = process.env.TZ;
const writeText = vi.fn<(text: string) => Promise<void>>();

const props: CitationBoxProps = {
  title: "Rola UE w regionie",
  lang: "pl",
  publishedAt: "2026-08-01T09:00:00.000Z",
  authors: [{ firstName: "Anna", lastName: "Nowak", displayName: null }],
  url: "https://nes.eu/post/a",
  siteName: "New European Strategies",
};

const copyButton = (format: string) =>
  screen.getByRole("button", { name: `Kopiuj cytowanie w formacie ${format}` });

async function copy(format: string): Promise<void> {
  await act(async () => {
    fireEvent.click(copyButton(format));
  });
}

function openTab(format: string): void {
  // Radix aktywuje zakładkę na wciśnięciu lewego przycisku myszy.
  fireEvent.mouseDown(screen.getByRole("tab", { name: format }), { button: 0 });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-09-10T10:00:00.000Z"));
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("CitationBox - zawartość schowka", () => {
  it("Chicago idzie do schowka bez HTML, APA i BibTeX - dosłownie", async () => {
    const expected = buildCitations({
      ...props,
      siteName: "New European Strategies",
      accessedOn: "2026-09-10",
    });
    render(<CitationBox {...props} />);

    await copy("Chicago");
    expect(writeText).toHaveBeenLastCalledWith(expected.chicagoPlain);
    expect(writeText.mock.lastCall?.[0]).not.toContain("<em>");

    openTab("APA");
    await copy("APA");
    expect(writeText).toHaveBeenLastCalledWith(expected.apa);

    openTab("BibTeX");
    await copy("BibTeX");
    expect(writeText).toHaveBeenLastCalledWith(expected.bibtex);
    expect(writeText.mock.lastCall?.[0]).toContain("urldate      = {2026-09-10},");
  });
});

describe("CitationBox - potwierdzenie kopiowania", () => {
  it("gaśnie po 2 s, a ponowne kopiowanie odnawia odliczanie", async () => {
    render(<CitationBox {...props} />);

    await copy("Chicago");
    expect(screen.getByText("Skopiowano")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await copy("Chicago");
    // 2,5 s od PIERWSZEGO kopiowania - stary timer nie ma prawa zgasić nowego.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Skopiowano")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText("Skopiowano")).toBeNull();
    expect(screen.getByText("Kopiuj")).toBeInTheDocument();
  });

  it("odmontowanie w trakcie potwierdzenia nie zostawia timera", async () => {
    const view = render(<CitationBox {...props} />);
    await copy("Chicago");
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("CitationBox - data dostępu czytelnika", () => {
  it("w Warszawie tuż po północy cytat niesie DZISIEJSZĄ datę, nie wczorajszą (UTC)", () => {
    process.env.TZ = "Europe/Warsaw";
    vi.setSystemTime(new Date("2026-07-20T22:30:00.000Z")); // 21 lipca, 00:30 CEST
    render(<CitationBox {...props} publishedAt={null} />);

    // Bez daty publikacji Chicago podaje datę dostępu - widoczną od razu.
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Udostępniono 21 lipca 2026");

    openTab("BibTeX");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("urldate = {2026-07-21}");
  });
});
