// `RoleGateNotice` - kontrakt I0 (`role="status"`, `data-testid`
// `revenue-role-gate`) i dwa warianty: hub w ogóle (administrator albo
// redaktor) i zakładka wyłącznie administratora.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("RoleGateNotice", () => {
  it("hub w ogóle: tekst rdzenia I0 o administratorach i redaktorach", () => {
    render(<RoleGateNotice requiredRole="admin_or_editor" />);

    const gate = screen.getByTestId("revenue-role-gate");
    expect(gate).toHaveAttribute("role", "status");
    expect(gate).toHaveAttribute("data-required-role", "admin_or_editor");
    expect(gate).toHaveTextContent("dostępny dla administratorów i redaktorów");
    expect(gate).toHaveTextContent("Rola: administrator albo redaktor");
  });

  it("zakładka administratora: mówi DLACZEGO (kwoty), nie tylko „brak dostępu”", () => {
    render(<RoleGateNotice requiredRole="admin" />);

    const gate = screen.getByRole("status");
    expect(gate).toHaveTextContent("wyłącznie dla administratorów, bo pokazuje kwoty");
    expect(gate).toHaveTextContent("Rola: administrator");
    expect(gate.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("wersja angielska obu wariantów", async () => {
    await i18n.changeLanguage("en");
    render(<RoleGateNotice requiredRole="admin_or_editor" />);
    expect(screen.getByRole("status")).toHaveTextContent("available to administrators and editors");
    cleanup();

    render(<RoleGateNotice requiredRole="admin" />);
    expect(screen.getByRole("status")).toHaveTextContent("available to administrators only");
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(
      <div>
        <RoleGateNotice requiredRole="admin" />
        <RoleGateNotice requiredRole="admin_or_editor" />
      </div>,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
