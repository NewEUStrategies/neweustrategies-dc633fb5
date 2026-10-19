// `LockedMetricTile` - kafel, którego rola nie może zobaczyć: nazwa wskaźnika
// zostaje, liczby nie ma, powód stoi słowami (SPEC §2.5).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { LockedMetricTile } from "@/components/admin/revenue/atoms/LockedMetricTile";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("LockedMetricTile", () => {
  it("grupa nazwana etykietą wskaźnika, z powodem blokady słowami", () => {
    render(<LockedMetricTile label="MRR" reason="admin_only" />);

    const tile = screen.getByRole("group", { name: "MRR" });
    expect(tile).toHaveTextContent("Kwoty widzi wyłącznie administrator");
    expect(tile).toHaveAttribute("data-locked-reason", "admin_only");
    // Podpowiedź, co zrobić, jest opisem grupy - czytnik ją usłyszy.
    expect(tile).toHaveAccessibleDescription(/Poproś administratora o dostęp/);
  });

  it("nie pokazuje żadnej liczby ani zera - zablokowane to nie „0 zł”", () => {
    render(<LockedMetricTile label="ARPU" reason="admin_only" />);

    const tile = screen.getByRole("group", { name: "ARPU" });
    expect(tile.textContent).not.toMatch(/\d/);
  });

  it("brak drugiego składnika ma własny komunikat", () => {
    render(<LockedMetricTile label="Win rate" reason="mfa_required" />);

    expect(screen.getByRole("group", { name: "Win rate" })).toHaveTextContent(
      "Wymaga logowania dwuetapowego",
    );
  });

  it("mówi po angielsku w wersji EN", async () => {
    await i18n.changeLanguage("en");
    render(<LockedMetricTile label="MRR" reason="admin_only" />);

    expect(screen.getByRole("group", { name: "MRR" })).toHaveTextContent(
      "Only an administrator can see amounts",
    );
  });

  it("nie ma naruszeń dostępności (PL i EN)", async () => {
    const pl = render(<LockedMetricTile label="MRR" reason="admin_only" />);
    expect(summarize(await axeViolations(pl.container))).toBe("");
    cleanup();

    await i18n.changeLanguage("en");
    const en = render(<LockedMetricTile label="MRR" reason="mfa_required" />);
    expect(summarize(await axeViolations(en.container))).toBe("");
  });
});
