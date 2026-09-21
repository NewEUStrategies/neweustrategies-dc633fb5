// Karta licznika nad listą odcinków: etykieta, wartość, tonacja.
//
// CO DOWODZI TEN PLIK. Cztery karty stoją obok siebie i różnią się TYLKO
// etykietą, wartością i kolorem. Karta, która renderuje wartość innej karty
// (albo tonację „sukces" dla szkiców), kłamie o stanie redakcji w jedynym
// miejscu, gdzie ten stan jest widoczny na pierwszy rzut oka.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Mic } from "@/lib/lucide-shim";
import { PodcastStatCard } from "@/components/admin/podcasts/PodcastStatCard";

afterEach(() => cleanup());

describe("PodcastStatCard", () => {
  it("pokazuje etykiete, wartosc i ikone", () => {
    render(<PodcastStatCard icon={Mic} label="Wszystkie" value="12" tone="default" />);
    expect(screen.getByText("Wszystkie")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(document.querySelector("svg")).toBeTruthy();
  });

  it("wartosc idzie jako TEKST - karta nie liczy niczego sama", () => {
    // Karta jest głupia z rozmysłem: liczenie mieszka w `podcastAdminStats`
    // i ma tam własną tabelę przypadków (`lib/podcast/__tests__/shape.test.ts`).
    render(<PodcastStatCard icon={Mic} label="Laczny czas" value="2:02:02" tone="default" />);
    expect(screen.getByText("2:02:02")).toBeTruthy();
  });

  it.each([
    ["default", "primary"],
    ["success", "green"],
    ["warning", "amber"],
  ])("tonacja %s maluje ikone wlasnym kolorem", (tone, expected) => {
    const view = render(
      <PodcastStatCard
        icon={Mic}
        label="Etykieta"
        value="1"
        tone={tone as "default" | "success" | "warning"}
      />,
    );
    // Kafel ikony to pierwszy element z klasą tonacji - szukamy go po SVG
    // w środku, a nie po pozycji w drzewie (pozycja zmienia się z układem).
    const iconBox = view.container.querySelector("svg")?.parentElement;
    expect(iconBox?.className).toContain(expected);
  });
});
