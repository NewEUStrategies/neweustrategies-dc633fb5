// Dostosowanie pionowej pozycji okładki klubu (`ClubCoverPositionEditor`).
// Obrazy podglądu mają puste `alt`, więc w testach szukamy ich przez ramki
// (`data-testid="cover-preview-*"`).
//
// CO TEN PLIK DOWODZI.
//  1. Komponent widzi się TYLKO, gdy użytkownik ma uprawnienia (`canEdit`)
//     i klub ma okładkę (`coverImageUrl`).
//  2. Slider 0-100 przekłada się na żywy podgląd `object-position: center <Y>%`
//     - w ramce głównej I w każdej miniaturze innej powierzchni.
//  3. Ramka główna ma proporcję pasa ZMIERZONĄ na stronie w chwili otwarcia
//     (`frameRef`), a nie stałą 4:1 - to był zgłoszony rozjazd z desktopem.
//  4. Miniatury mają proporcje atomu `ClubCover` (baner 3:1 i 4:1, kafel 16:9).
//  5. Zapis wysyła do serwera `{ clubId, positionY }` i wywołuje `onChanged`
//     wyłącznie po sukcesie.
//  6. Błąd zapisu pokazuje toast, ale nie zamyka modalu ani nie odświeża danych.
//  7. Anulowanie przywraca początkową wartość przy ponownym otwarciu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - Logiki uprawnień `can_moderate` - decyduje o niej rodzic.
//  - Walidacji zakresu 0-100 - robi to schema server function i RPC.
import { createRef } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
  savePosition: vi.fn<(args: { data: { clubId: string; positionY: number } }) => Promise<number>>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Nakładka rejestruje słownik EFEKTEM UBOCZNYM importu, więc bez tej atrapy
// plik testowy wciągnąłby prawdziwy `@/lib/i18n` (top-level await + `init`)
// tylko po to, żeby wyrzucić wynik - `react-i18next` i tak jest tu atrapą.
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: () => h.savePosition };
});

import { ClubCoverPositionEditor } from "@/components/clubs/molecules/ClubCoverPositionEditor";
import { CLUB_IDS } from "@/test/clubs/fixtures";
import { translateKey } from "@/test/i18nStub";

function openButton(): HTMLElement {
  return screen.getByRole("button", {
    name: translateKey("club.hub.identity.cover.position.open"),
  });
}

function slider(): HTMLElement {
  return screen.getByRole("slider", {
    name: translateKey("club.hub.identity.cover.position.slider"),
  });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", {
    name: translateKey("club.hub.identity.cover.position.save"),
  });
}

function frame(key: string): HTMLElement {
  return screen.getByTestId(`cover-preview-${key}`);
}

/** `aspect-ratio` ramki jako liczba (jsdom normalizuje `4` do `4 / 1`). */
function frameRatio(key: string): number {
  const [w, h = "1"] = frame(key).style.aspectRatio.split("/");
  return Number(w) / Number(h);
}

function framePosition(key: string): string {
  return (frame(key).querySelector("img") as HTMLImageElement).style.objectPosition;
}

/** Pas okładki na stronie o zadanych wymiarach (jsdom nie liczy układu). */
function stripRef(width: number, height: number) {
  const ref = createRef<HTMLDivElement>();
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
  (ref as { current: HTMLDivElement | null }).current = element;
  return ref;
}

describe("ClubCoverPositionEditor", () => {
  beforeEach(() => {
    h.savePosition.mockReset();
    h.toast.success.mockReset();
    h.toast.error.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("is not rendered when user cannot edit", () => {
    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={50}
        canEdit={false}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is not rendered when there is no cover image", () => {
    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl={null}
        positionY={50}
        canEdit={true}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens a modal with a slider and live preview", () => {
    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={30}
        canEdit={true}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(openButton());
    expect(slider()).toBeInTheDocument();
    expect(framePosition("page")).toBe("center 30%");
  });

  it("updates preview while dragging the slider", () => {
    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={30}
        canEdit={true}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(openButton());
    const thumb = slider();
    fireEvent.keyDown(thumb, { key: "End" });
    expect(framePosition("page")).toBe("center 100%");
  });

  it("ramka główna ma proporcję pasa zmierzoną na stronie, nie stałą 4:1", () => {
    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={30}
        frameRef={stripRef(1534, 208)}
        canEdit={true}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(openButton());
    expect(frameRatio("page")).toBeCloseTo(1534 / 208, 6);
    expect(screen.getByText("club.hub.identity.cover.position.preview.page")).toBeInTheDocument();
  });

  it("bez zmierzonego pasa (brak refa albo zerowe wymiary) ramka główna ma 4:1", () => {
    const { unmount } = render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={30}
        canEdit={true}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(openButton());
    expect(frameRatio("page")).toBe(4);
    unmount();

    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={30}
        frameRef={stripRef(0, 0)}
        canEdit={true}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(openButton());
    expect(frameRatio("page")).toBe(4);
  });

  it("miniatury pokazują ten sam kadr w proporcjach bramki, minisite i katalogu", () => {
    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={30}
        canEdit={true}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(openButton());
    expect(frameRatio("bannerMobile")).toBe(3);
    expect(frameRatio("bannerDesktop")).toBe(4);
    expect(frameRatio("card")).toBeCloseTo(16 / 9, 10);
    for (const key of ["bannerMobile", "bannerDesktop", "card"]) {
      expect(
        screen.getByText(`club.hub.identity.cover.position.preview.${key}`),
      ).toBeInTheDocument();
    }

    fireEvent.keyDown(slider(), { key: "Home" });
    for (const key of ["page", "bannerMobile", "bannerDesktop", "card"]) {
      expect(framePosition(key)).toBe("center 0%");
    }
  });

  it("anulowanie odrzuca przesunięcie - ponowne otwarcie startuje od zapisanego kadru", () => {
    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={30}
        canEdit={true}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(openButton());
    fireEvent.keyDown(slider(), { key: "End" });
    expect(framePosition("page")).toBe("center 100%");
    fireEvent.click(
      screen.getByRole("button", { name: translateKey("club.hub.identity.cover.position.cancel") }),
    );
    expect(h.savePosition).not.toHaveBeenCalled();

    fireEvent.click(openButton());
    expect(framePosition("page")).toBe("center 30%");
  });

  it("calls server function with the new position and refreshes data on save", async () => {
    h.savePosition.mockResolvedValue(75);
    const onChanged = vi.fn();
    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={30}
        canEdit={true}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(openButton());
    fireEvent.keyDown(slider(), { key: "End" });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(h.savePosition).toHaveBeenCalledWith({
        data: { clubId: CLUB_IDS.club, positionY: 100 },
      });
    });
    expect(onChanged).toHaveBeenCalled();
    expect(h.toast.success).toHaveBeenCalledWith("club.hub.identity.cover.position.saved");
  });

  it("shows an error toast and does not refresh data when save fails", async () => {
    h.savePosition.mockRejectedValue(new Error("nope"));
    const onChanged = vi.fn();
    render(
      <ClubCoverPositionEditor
        clubId={CLUB_IDS.club}
        coverImageUrl="https://example.com/cover.png"
        positionY={30}
        canEdit={true}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(openButton());
    fireEvent.keyDown(slider(), { key: "End" });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(h.toast.error).toHaveBeenCalledWith("club.hub.identity.cover.position.failed");
    });
    expect(onChanged).not.toHaveBeenCalled();
  });
});
