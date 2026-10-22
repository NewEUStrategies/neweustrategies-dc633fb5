// Kafelek zaangażowania kampanii - dowód na PRAWDZIWEJ instancji i18n.
//
// Test pilnuje trzech rzeczy, które razem tworzyły usterkę widoczną dla
// redakcji jako „otwarcia: 137%":
//   1. wskaźnik liczy ZASIĘG (różnych odbiorców), nie liczbę zdarzeń,
//   2. nigdy nie przekracza 100%,
//   3. mówi PO POLSKU i PO ANGIELSKU - brak klucza dałby surowy identyfikator
//      w panelu, a nie widoczny błąd.
//   4. (I9d-Y2) pomiar tylko za zgodą: mianownik = odbiorcy MIERZENI, gdy
//      kampania zna stan pomiaru; kampania sprzed Y2 - wysłani jak dotąd;
//      notka z dymkiem zawsze, liczba mierzonych - tylko gdy jest znana.
import { describe, expect, it, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import i18n from "@/lib/i18n";
import { CampaignEngagementCard } from "@/components/admin/newsletter/molecules/CampaignEngagementCard";

const KEYS = [
  "adminNewsletter.campaigns.engagementHeading",
  "adminNewsletter.campaigns.uniqueOpens",
  "adminNewsletter.campaigns.uniqueClicks",
  "adminNewsletter.campaigns.opens",
  "adminNewsletter.campaigns.clicks",
  "adminNewsletter.campaigns.ofDelivered",
  "adminNewsletter.campaigns.engagementHint",
] as const;

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

describe("CampaignEngagementCard", () => {
  it("wskaźnik liczy zasięg unikalny, nie liczbę zdarzeń", async () => {
    await i18n.changeLanguage("pl");
    // 120 zdarzeń otwarcia od 40 różnych odbiorców przy 200 dostarczonych:
    // uczciwy wskaźnik to 40/200 = 20%, a nie 120/200 = 60%.
    render(
      <CampaignEngagementCard
        engagement={{ opens: 120, clicks: 30, uniqueOpens: 40, uniqueClicks: 10 }}
        delivered={200}
      />,
    );
    expect(screen.getByText("20% dostarczonych")).toBeInTheDocument();
    expect(screen.getByText("5% dostarczonych")).toBeInTheDocument();
    expect(screen.queryByText("60% dostarczonych")).not.toBeInTheDocument();
  });

  it("nie pokazuje wskaźnika powyżej 100%, nawet gdy dane są rozjechane", async () => {
    await i18n.changeLanguage("pl");
    const { container } = render(
      <CampaignEngagementCard
        engagement={{ opens: 900, clicks: 400, uniqueOpens: 137, uniqueClicks: 120 }}
        delivered={100}
      />,
    );
    expect(screen.getAllByText("100% dostarczonych").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("137%");
  });

  it("bez wysyłki pokazuje myślnik zamiast 0% - brak mianownika to nie zero otwarć", async () => {
    await i18n.changeLanguage("pl");
    const { container } = render(
      <CampaignEngagementCard
        engagement={{ opens: 0, clicks: 0, uniqueOpens: 0, uniqueClicks: 0 }}
        delivered={0}
      />,
    );
    expect(container.textContent).not.toContain("0% dostarczonych");
    expect(container.textContent).toContain("-");
  });

  it("w trakcie ładowania renderuje zera zamiast pustki", async () => {
    await i18n.changeLanguage("pl");
    const { container } = render(<CampaignEngagementCard engagement={undefined} delivered={50} />);
    expect(container.textContent).toContain("0% dostarczonych");
  });

  it("mówi w OBU językach - żaden klucz nie wycieka do panelu", async () => {
    for (const lang of ["pl", "en"] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = render(
        <CampaignEngagementCard
          engagement={{ opens: 5, clicks: 2, uniqueOpens: 4, uniqueClicks: 2 }}
          delivered={10}
        />,
      );
      for (const key of KEYS) {
        expect(i18n.exists(key, { lng: lang }), `${lang}/${key}`).toBe(true);
        expect(container.textContent).not.toContain(key);
      }
      unmount();
    }
    await i18n.changeLanguage("en");
    render(
      <CampaignEngagementCard
        engagement={{ opens: 5, clicks: 2, uniqueOpens: 4, uniqueClicks: 2 }}
        delivered={10}
      />,
    );
    expect(screen.getByText("40% of delivered")).toBeInTheDocument();
  });

  it("I9d-Y2: mianownik = odbiorcy mierzeni, liczba mierzonych i notka o zgodzie", async () => {
    await i18n.changeLanguage("pl");
    // 40 unikalnych otwarć: 200 wysłanych, z czego 80 mierzonych - uczciwy
    // wskaźnik to 40/80 = 50%, a nie 40/200 = 20% (niemierzeni nie mogą otworzyć).
    const { container } = render(
      <CampaignEngagementCard
        engagement={{ opens: 50, clicks: 10, uniqueOpens: 40, uniqueClicks: 8 }}
        delivered={200}
        measurement={{ campaignId: "c", sent: 200, measured: 80, unmeasured: 120, unknown: 0 }}
      />,
    );
    expect(screen.getByText("50% mierzonych")).toBeInTheDocument();
    expect(screen.getByText("10% mierzonych")).toBeInTheDocument();
    expect(screen.getByText("Mierzeni odbiorcy: 80 z 200 wysłanych")).toBeInTheDocument();
    expect(screen.getByText("Tylko odbiorcy ze zgodą na pomiar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Kogo obejmuje pomiar otwarć i kliknięć?" }),
    ).toBeInTheDocument();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("I9d-Y2: kampania sprzed wersji z pomiarem (stan nieznany) dzieli przez wysłanych", async () => {
    await i18n.changeLanguage("pl");
    render(
      <CampaignEngagementCard
        engagement={{ opens: 50, clicks: 10, uniqueOpens: 40, uniqueClicks: 8 }}
        delivered={200}
        measurement={{ campaignId: "c", sent: 200, measured: 0, unmeasured: 0, unknown: 200 }}
      />,
    );
    expect(screen.getByText("20% dostarczonych")).toBeInTheDocument();
    expect(screen.queryByText(/Mierzeni odbiorcy/)).not.toBeInTheDocument();
    expect(screen.getByText("Tylko odbiorcy ze zgodą na pomiar")).toBeInTheDocument();
  });
});
