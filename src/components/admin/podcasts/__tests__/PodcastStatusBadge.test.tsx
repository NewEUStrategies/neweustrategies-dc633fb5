// Plakietka statusu: trzy stany, trzy etykiety, trzy tonacje.
//
// CO DOWODZI TEN PLIK. Ta sama plakietka stoi w trzech miejscach panelu
// (lista odcinków, lista programów, podgląd edytora), więc rozjazd między
// stanem a etykietą jest widoczny dla redakcji jako „ten sam odcinek ma dwa
// statusy". Kolor niesie tu znaczenie równorzędne z napisem: szkic na żółto
// mówi „jeszcze nie w serwisie" szybciej niż tekst.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PodcastStatus } from "@/lib/podcast/types";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-podcasts", () => ({ ensureI18n: () => undefined }));

const { PodcastStatusBadge } = await import("@/components/admin/podcasts/PodcastStatusBadge");

afterEach(() => cleanup());

describe("PodcastStatusBadge", () => {
  it.each([
    ["published", "adminPodcasts.status.published", "green"],
    ["draft", "adminPodcasts.status.draft", "amber"],
    ["archived", "adminPodcasts.status.archived", "muted"],
  ])("stan %s dostaje etykiete ze slownika i wlasna tonacje", (status, key, tone) => {
    render(<PodcastStatusBadge status={status as PodcastStatus} />);
    const badge = screen.getByText(key);
    expect(badge).toBeTruthy();
    // Klasa tonacji jest kontraktem wizualnym: dwa stany w tym samym kolorze
    // znoszą sens plakietki.
    expect(badge.className).toContain(tone);
  });

  it("kazdy stan ma INNA tonacje (zaden nie dubluje sasiada)", () => {
    const tones = (["published", "draft", "archived"] as const).map((status) => {
      const view = render(<PodcastStatusBadge status={status} />);
      const badge = view.getByText(`adminPodcasts.status.${status}`);
      const className = badge.className;
      view.unmount();
      return className;
    });
    expect(new Set(tones).size).toBe(3);
  });
});
