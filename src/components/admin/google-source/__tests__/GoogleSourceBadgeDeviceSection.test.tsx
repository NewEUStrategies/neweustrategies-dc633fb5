// Sekcja jednego urządzenia w panelu „Google - preferowane źródło" - do tego
// pliku na ZERZE (trasa `admin.settings.google-source` montuje ją atrapą).
//
// PRZEDMIOT DOWODU: każde pole zmienia WYŁĄCZNIE swoją właściwość
// rozmieszczenia, opcje odpowiadają typom (`GoogleSourceBadgeVariant`/`Align`),
// a marginesy przechodzą przez `clampMargin` (0-48), zanim trafią do konfiguracji.
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// Radix Select z `fields.tsx` nie działa pod happy-dom - natywny odpowiednik,
// ten sam zabieg co w `adminSeoHubRoutes.test.tsx`.
vi.mock("@/components/admin/blocks/AdminSelect", () => ({
  AdminSelect: ({
    value,
    onChange,
    children,
  }: {
    value?: string | number;
    onChange?: (event: { target: { value: string } }) => void;
    children?: ReactNode;
  }) => (
    <select
      data-testid="admin-select"
      value={value === undefined ? "" : String(value)}
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
    >
      {children}
    </select>
  ),
}));

import { GoogleSourceBadgeDeviceSection } from "@/components/admin/google-source/GoogleSourceBadgeDeviceSection";
import type { GoogleSourceBadgePlacement } from "@/lib/seo/googleSourceBadge";

const PLACEMENT: GoogleSourceBadgePlacement = {
  enabled: true,
  variant: "default",
  align: "start",
  marginTop: 8,
  marginBottom: 12,
  marginX: 0,
};

function setup(placement: GoogleSourceBadgePlacement = PLACEMENT) {
  const onChange = vi.fn();
  render(
    <GoogleSourceBadgeDeviceSection title="Komputerze" placement={placement} onChange={onChange} />,
  );
  return onChange;
}

afterEach(() => cleanup());

describe("GoogleSourceBadgeDeviceSection", () => {
  it("nagłówek i etykieta widoczności niosą nazwę urządzenia", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Komputerze" })).toBeInTheDocument();
    expect(screen.getByText("Pokazuj badge na komputerze")).toBeInTheDocument();
  });

  it("przełącznik widoczności zmienia tylko `enabled`", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith({ ...PLACEMENT, enabled: false });
  });

  it("wariant i wyrównanie: trzy opcje każde, zmiana trafia do swojego pola", () => {
    const onChange = setup();
    const [variant, align] = screen.getAllByTestId("admin-select");
    expect(
      within(variant)
        .getAllByRole("option")
        .map((o) => o.getAttribute("value")),
    ).toEqual(["default", "compact", "icon"]);
    expect(
      within(align)
        .getAllByRole("option")
        .map((o) => o.getAttribute("value")),
    ).toEqual(["start", "center", "end"]);
    fireEvent.change(variant, { target: { value: "icon" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...PLACEMENT, variant: "icon" });
    fireEvent.change(align, { target: { value: "center" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...PLACEMENT, align: "center" });
  });

  it("trzy marginesy mają etykiety z nazwą urządzenia i są klamrowane do 0-48", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("Komputerze - margines górny"), {
      target: { value: "100" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...PLACEMENT, marginTop: 48 });
    fireEvent.change(screen.getByLabelText("Komputerze - margines dolny"), {
      target: { value: "-3" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...PLACEMENT, marginBottom: 0 });
    fireEvent.change(screen.getByLabelText("Komputerze - marginesy boczne"), {
      target: { value: "16" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...PLACEMENT, marginX: 16 });
  });
});
