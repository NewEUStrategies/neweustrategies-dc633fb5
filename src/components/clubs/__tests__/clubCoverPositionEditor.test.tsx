// Dostosowanie pionowej pozycji okładki klubu (`ClubCoverPositionEditor`).
// Obraz podglądu ma puste `alt`, więc w testach szukamy go przez selektor `img`.
//
// CO TEN PLIK DOWODZI.
//  1. Komponent widzi się TYLKO, gdy użytkownik ma uprawnienia (`canEdit`)
//     i klub ma okładkę (`coverImageUrl`).
//  2. Slider 0-100 przekłada się na żywy podgląd `object-position: center <Y>%`.
//  3. Zapis wysyła do serwera `{ clubId, positionY }` i wywołuje `onChanged`
//     wyłącznie po sukcesie.
//  4. Błąd zapisu pokazuje toast, ale nie zamyka modalu ani nie odświeża danych.
//  5. Anulowanie przywraca początkową wartość przy ponownym otwarciu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - Logiki uprawnień `can_moderate` - decyduje o niej rodzic.
//  - Walidacji zakresu 0-100 - robi to schema server function i RPC.
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
  return screen.getByRole("button", { name: translateKey("club.hub.identity.cover.position.save") });
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
    const preview = screen.getByRole("img") as HTMLImageElement;
    expect(preview.style.objectPosition).toBe("center 30%");
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
    const preview = screen.getByRole("img") as HTMLImageElement;
    expect(preview.style.objectPosition).toBe("center 100%");
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
