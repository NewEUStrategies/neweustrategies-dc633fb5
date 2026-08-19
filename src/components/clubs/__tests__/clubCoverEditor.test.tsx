// Edycja okładki klubu na miejscu (`ClubCoverEditor`).
//
// CO TEN PLIK DOWODZI.
//  1. Komponent WOŁA regułę wejścia (`checkClubCoverFile`) PRZED magazynem:
//     zły typ i za duży plik kończą się komunikatem, a `uploadClubCover` nie
//     dostaje ani jednego wywołania. Bez tego użytkownik płaci transferem za
//     odpowiedź, którą znamy z góry.
//  2. PAYLOAD obu ścieżek zapisu: wgranie niesie `{ clubId, file }`, a
//     zdjęcie okładki to JAWNY `url: null`, nie brak pola.
//  3. ODŚWIEŻENIE danych klubu (`onChanged`) leci WYŁĄCZNIE po sukcesie -
//     przy awarii nagłówek nie ma prawa przeładować się „na wszelki wypadek”.
//  4. Praca w locie blokuje oba przyciski i pokazuje kręciołek zamiast ikony.
//  5. Wejście plików zeruje wartość, więc TEN SAM plik wybrany po nieudanym
//     zapisie wyzwala drugą próbę (bez tego `change` nie wystrzeliłby wcale).
//  6. Kosz pokazuje się tylko wtedy, gdy okładka JEST - przycisk kończący się
//     zawsze błędem jest gorszy niż jego brak.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - LISTY dopuszczonych typów, progu 8 MB i budowy klucza obiektu: to reguły
//    `src/lib/clubs/coverApi.ts` i mają tam własne testy. Tutaj biegnie
//    PRAWDZIWY `checkClubCoverFile` (mockowane są tylko dwie funkcje I/O),
//    więc dowodzimy wyłącznie, że komponent go używa i respektuje wynik.
//  - UPRAWNIEŃ: kto widzi ten pasek, decyduje rodzic (`can_moderate`).
//  - SPRZĄTANIA sieroty w kubełku po nieudanym zapisie adresu - to kontrakt
//    `uploadClubCover`.
//
// DWIE INSTRUKCJE NIEDOBITE ŚWIADOMIE - i to nie jest luka w testach.
// `if (busy) return;` w `pick` (linia 37) oraz w `remove` (linia 66) są
// NIEOSIĄGALNE: oba przyciski niosą `disabled={busy}` dokładnie na tym samym
// warunku, a React celowo połyka zdarzenia myszy na wyszarzonych elementach
// formularza (`shouldPreventMouseEvent`), więc żadne kliknięcie - także
// wysłane wprost przez `fireEvent` - nie wejdzie do handlera. Test „wyszarzony
// przycisk nie startuje drugiej pracy” poniżej dowodzi SKUTKU tej reguły
// (jedno wgranie, zero zdjęć okładki), ale skutek bierze się z `disabled`, nie
// z warunku w handlerze. Dobicie tych dwóch linii wymagałoby zmiany kodu
// produkcyjnego (przeniesienia warunku do `handleFile`, czyli do jedynego
// wejścia, które NIE jest wyszarzane, albo usunięcia martwego warunku) - a
// tego test nie ma prawa wymuszać.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
  uploadCover: vi.fn<(args: { clubId: string; file: File }) => Promise<string>>(),
  setCover: vi.fn<(args: { clubId: string; url: string | null }) => Promise<void>>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({ toast: h.toast }));

vi.mock("@/lib/clubs/coverApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clubs/coverApi")>();
  return { ...actual, uploadClubCover: h.uploadCover, setClubCover: h.setCover };
});

import { ClubCoverEditor } from "@/components/clubs/molecules/ClubCoverEditor";
import { CLUB_IDS } from "@/test/clubs/fixtures";
import { translateKey } from "@/test/i18nStub";

function coverFile(overrides: { name?: string; type?: string; size?: number } = {}): File {
  const file = new File(["baner"], overrides.name ?? "baner.png", {
    type: overrides.type ?? "image/png",
  });
  if (overrides.size !== undefined) {
    Object.defineProperty(file, "size", { value: overrides.size, configurable: true });
  }
  return file;
}

function fileField(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (el === null) throw new Error("brak ukrytego wejścia plików");
  return el;
}

function choose(container: HTMLElement, files: File[]): void {
  const input = fileField(container);
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

function pickButton(hasCover: boolean): HTMLElement {
  return screen.getByRole("button", {
    name: translateKey(hasCover ? "club.hub.identity.cover.change" : "club.hub.identity.cover.add"),
  });
}

function removeButton(): HTMLElement {
  return screen.getByRole("button", { name: translateKey("club.hub.identity.cover.remove") });
}

beforeEach(() => {
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.uploadCover.mockReset();
  h.uploadCover.mockResolvedValue("https://magazyn/okladka.png");
  h.setCover.mockReset();
  h.setCover.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("ClubCoverEditor - powierzchnia", () => {
  it("klub bez okładki zaprasza do dodania i NIE pokazuje kosza", () => {
    render(<ClubCoverEditor clubId={CLUB_IDS.club} hasCover={false} onChanged={vi.fn()} />);
    expect(pickButton(false)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: translateKey("club.hub.identity.cover.remove") }),
    ).toBeNull();
    expect(screen.getByText(translateKey("club.hub.identity.cover.sizeHint"))).toBeInTheDocument();
  });

  it("klub z okładką proponuje podmianę i zdjęcie, a klasa rodzica dojeżdża", () => {
    const { container } = render(
      <ClubCoverEditor
        clubId={CLUB_IDS.club}
        hasCover
        onChanged={vi.fn()}
        className="moja-klasa"
      />,
    );
    expect(pickButton(true)).toBeInTheDocument();
    expect(removeButton()).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("moja-klasa");
  });

  it("widoczny przycisk otwiera ukryte wejście plików", () => {
    const { container } = render(
      <ClubCoverEditor clubId={CLUB_IDS.club} hasCover={false} onChanged={vi.fn()} />,
    );
    const opened = vi.fn<() => void>();
    fileField(container).addEventListener("click", opened);

    fireEvent.click(pickButton(false));

    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe("ClubCoverEditor - reguła wejścia", () => {
  it("plik nieobsługiwanego typu nie rusza magazynu", async () => {
    const onChanged = vi.fn<() => void>();
    const { container } = render(
      <ClubCoverEditor clubId={CLUB_IDS.club} hasCover={false} onChanged={onChanged} />,
    );
    choose(container, [coverFile({ name: "wektor.svg", type: "image/svg+xml" })]);

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("club.hub.identity.cover.badType"),
    );
    expect(h.uploadCover).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("plik ponad limit pokazuje limit w megabajtach", async () => {
    const { container } = render(
      <ClubCoverEditor clubId={CLUB_IDS.club} hasCover={false} onChanged={vi.fn()} />,
    );
    choose(container, [coverFile({ size: 9 * 1024 * 1024 })]);

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        translateKey("club.hub.identity.cover.tooLarge", { max: 8 }),
      ),
    );
    expect(h.uploadCover).not.toHaveBeenCalled();
  });

  it("zdarzenie bez pliku nie woła magazynu", () => {
    const { container } = render(
      <ClubCoverEditor clubId={CLUB_IDS.club} hasCover={false} onChanged={vi.fn()} />,
    );
    choose(container, []);

    expect(h.uploadCover).not.toHaveBeenCalled();
    expect(h.toast.error).not.toHaveBeenCalled();
  });
});

describe("ClubCoverEditor - zapis okładki", () => {
  it("poprawny plik jedzie do magazynu, potwierdza i odświeża klub", async () => {
    const onChanged = vi.fn<() => void>();
    const { container } = render(
      <ClubCoverEditor clubId={CLUB_IDS.club} hasCover={false} onChanged={onChanged} />,
    );
    const file = coverFile();
    choose(container, [file]);

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(h.uploadCover).toHaveBeenCalledWith({ clubId: CLUB_IDS.club, file });
    expect(h.toast.success).toHaveBeenCalledWith("club.hub.identity.cover.saved");
  });

  it("awaria wgrywania pokazuje komunikat i NIE odświeża klubu", async () => {
    h.uploadCover.mockRejectedValue(new Error("magazyn odmówił"));
    const onChanged = vi.fn<() => void>();
    const { container } = render(
      <ClubCoverEditor clubId={CLUB_IDS.club} hasCover={false} onChanged={onChanged} />,
    );
    choose(container, [coverFile()]);

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("club.hub.identity.cover.failed"),
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("ten sam plik po nieudanym zapisie wyzwala drugą próbę", async () => {
    h.uploadCover.mockRejectedValueOnce(new Error("magazyn odmówił"));
    const { container } = render(
      <ClubCoverEditor clubId={CLUB_IDS.club} hasCover={false} onChanged={vi.fn()} />,
    );
    const file = coverFile();
    choose(container, [file]);
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("club.hub.identity.cover.failed"),
    );
    expect(fileField(container).value).toBe("");

    choose(container, [file]);
    await waitFor(() => expect(h.uploadCover).toHaveBeenCalledTimes(2));
    expect(h.toast.success).toHaveBeenCalledWith("club.hub.identity.cover.saved");
  });

  it("praca w locie blokuje oba przyciski i pokazuje kręciołek", async () => {
    let finish = (url: string): void => void url;
    h.uploadCover.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(
      <ClubCoverEditor clubId={CLUB_IDS.club} hasCover onChanged={vi.fn()} />,
    );
    choose(container, [coverFile()]);

    await waitFor(() => expect(pickButton(true)).toBeDisabled());
    expect(removeButton()).toBeDisabled();
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    // Wyszarzony przycisk nie startuje DRUGIEJ pracy - ani wyboru pliku, ani
    // zdjęcia okładki. Obie ścieżki mają własny warunek na `busy`.
    fireEvent.click(pickButton(true));
    fireEvent.click(removeButton());
    expect(h.uploadCover).toHaveBeenCalledTimes(1);
    expect(h.setCover).not.toHaveBeenCalled();

    finish("https://magazyn/okladka.png");
    await waitFor(() => expect(pickButton(true)).toBeEnabled());
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});

describe("ClubCoverEditor - zdjęcie okładki", () => {
  it("zapisuje JAWNY brak adresu, potwierdza i odświeża klub", async () => {
    const onChanged = vi.fn<() => void>();
    render(<ClubCoverEditor clubId={CLUB_IDS.club} hasCover onChanged={onChanged} />);
    fireEvent.click(removeButton());

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(h.setCover).toHaveBeenCalledWith({ clubId: CLUB_IDS.club, url: null });
    expect(h.toast.success).toHaveBeenCalledWith("club.hub.identity.cover.removed");
  });

  it("awaria zdejmowania pokazuje komunikat i NIE odświeża klubu", async () => {
    h.setCover.mockRejectedValue(new Error("brak uprawnienia"));
    const onChanged = vi.fn<() => void>();
    render(<ClubCoverEditor clubId={CLUB_IDS.club} hasCover onChanged={onChanged} />);
    fireEvent.click(removeButton());

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("club.hub.identity.cover.failed"),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
