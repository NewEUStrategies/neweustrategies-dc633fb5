// Przełącznik segmentów cennika w lejku (S3, P18): zmiana segmentu jest
// mierzona (`pricing_audience_change`) wyłącznie przy zgodzie analitycznej;
// klik w aktywny segment nie jest zmianą.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PricingAudienceRow } from "@/lib/pricing/queries";

const h = vi.hoisted(() => ({ track: vi.fn(), consent: true }));
vi.mock("@/lib/analytics/track", () => ({ track: h.track }));
vi.mock("@/lib/ads/consent", () => ({ hasAnalyticsConsent: () => h.consent }));

import { AudienceSwitcher } from "@/components/pricing/molecules/AudienceSwitcher";

const audiences = [
  { key: "personal", name_pl: "Dla Ciebie", name_en: "For you", icon: "user" },
  { key: "business", name_pl: "Dla firm", name_en: "For business", icon: "building" },
] as unknown as PricingAudienceRow[];

function renderSwitcher(onChange = vi.fn()) {
  render(
    <AudienceSwitcher
      audiences={audiences}
      value="personal"
      onChange={onChange}
      lang="pl"
      label="Segmenty"
    />,
  );
  return onChange;
}

beforeEach(() => {
  h.track.mockReset();
  h.consent = true;
});

describe("AudienceSwitcher - pomiar segmentu", () => {
  it("zmiana segmentu: zdarzenie z segmentem docelowym i źródłowym", () => {
    const onChange = renderSwitcher();
    fireEvent.click(screen.getByRole("tab", { name: /Dla firm/ }));
    expect(onChange).toHaveBeenCalledWith("business");
    expect(h.track).toHaveBeenCalledWith({
      type: "interaction",
      name: "pricing_audience_change",
      meta: { audience: "business", from: "personal" },
    });
  });

  it("klik w aktywny segment nie jest zmianą", () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("tab", { name: /Dla Ciebie/ }));
    expect(h.track).not.toHaveBeenCalled();
  });

  it("bez zgody analitycznej: przełączenie działa, pomiaru brak", () => {
    h.consent = false;
    const onChange = renderSwitcher();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("business");
    expect(h.track).not.toHaveBeenCalled();
  });
});
