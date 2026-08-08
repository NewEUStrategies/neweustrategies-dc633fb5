// Formatowanie w przestrzeni roboczej wątku - trzy miejsca, w których pomyłka
// jest niewidoczna na ekranie i kosztowna w skutkach:
//
//   * termin całodniowy przesunięty o dobę przy przeliczeniu na UTC,
//   * rozmiar pliku „0 B" przy nieznanym rozmiarze,
//   * zakres godzin sklejony z dwóch identycznych dat.
import { describe, expect, it } from "vitest";
import { formatBytes } from "@/components/clubs/molecules/ClubDocumentRow";
import { milestoneWhen } from "@/components/clubs/molecules/ClubMilestoneRow";
import { toIsoValue, toLocalInputValue } from "@/components/clubs/molecules/ClubMilestoneForm";
import type { ClubThreadMilestoneRow } from "@/lib/clubs/threadWorkspaceTypes";

function milestone(overrides: Partial<ClubThreadMilestoneRow>): ClubThreadMilestoneRow {
  return {
    id: "m1",
    kind: "deadline",
    status: "planned",
    title: "Termin",
    description: null,
    starts_at: "2026-09-14T09:00:00.000Z",
    ends_at: null,
    all_day: false,
    location: null,
    url: null,
    sort_order: 0,
    event_id: null,
    event_slug: null,
    owner_id: null,
    owner_name: null,
    owner_slug: null,
    created_at: "2026-09-01T00:00:00.000Z",
    can_edit: false,
    ...overrides,
  };
}

describe("toIsoValue / toLocalInputValue", () => {
  it("termin całodniowy kotwiczy na południu, więc nie ucieka na poprzedni dzień", () => {
    // Północ czasu lokalnego w strefie UTC+2 to 22:00 dnia POPRZEDNIEGO w UTC.
    // Kotwica na południu daje zapas w obie strony dla całej Europy.
    const iso = toIsoValue("2026-09-14", true);
    expect(iso).not.toBeNull();
    const back = new Date(iso as string);
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(8);
    expect(back.getDate()).toBe(14);
  });

  it("obieg tam i z powrotem zachowuje dzień dla terminu całodniowego", () => {
    const iso = toIsoValue("2026-01-31", true);
    expect(toLocalInputValue(iso, true)).toBe("2026-01-31");
  });

  it("obieg tam i z powrotem zachowuje godzinę dla terminu punktowego", () => {
    const iso = toIsoValue("2026-09-14T17:30", false);
    expect(toLocalInputValue(iso, false)).toBe("2026-09-14T17:30");
  });

  it("puste i niepoprawne wejście daje null zamiast Invalid Date", () => {
    expect(toIsoValue("", false)).toBeNull();
    expect(toIsoValue("nie-data", false)).toBeNull();
    expect(toLocalInputValue(null, false)).toBe("");
    expect(toLocalInputValue("nie-data", false)).toBe("");
  });
});

describe("milestoneWhen", () => {
  it("zakres o identycznych końcach nie dubluje daty", () => {
    const label = milestoneWhen(
      milestone({
        all_day: true,
        starts_at: "2026-09-14T10:00:00.000Z",
        ends_at: "2026-09-14T18:00:00.000Z",
      }),
      "pl",
    );
    expect(label).not.toContain(" - ");
  });

  it("zakres o różnych dniach pokazuje oba końce", () => {
    const label = milestoneWhen(
      milestone({
        all_day: true,
        starts_at: "2026-09-14T10:00:00.000Z",
        ends_at: "2026-09-30T10:00:00.000Z",
      }),
      "pl",
    );
    expect(label).toContain(" - ");
  });
});

describe("formatBytes", () => {
  it("nieznany i zerowy rozmiar daje null, nie „0 B”", () => {
    expect(formatBytes(null, "pl")).toBeNull();
    expect(formatBytes(0, "pl")).toBeNull();
    expect(formatBytes(Number.NaN, "pl")).toBeNull();
  });

  it("skaluje jednostkę i zaokrągla", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(2048, "en")).toBe("2 kB");
    expect(formatBytes(5 * 1024 * 1024, "en")).toBe("5 MB");
  });
});
