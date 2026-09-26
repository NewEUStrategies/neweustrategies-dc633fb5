// Karta „Sponsoring wydarzeń" na stronie firmy w CRM (`CompanySponsorshipsCard`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. REDAKTOR CRM WIDZI PUSTĄ KARTĘ Z ODMOWĄ - odmowa `forbidden` (dane
//      Wydarzeń są tylko dla admina) chowa kartę całkowicie; inny błąd mówi
//      zdaniem, że historii nie udało się wczytać.
//   2. WIERSZ PROWADZI DONIKĄD - odnośnik idzie do raportu sponsora W STUDIU
//      TEGO wydarzenia z filtrem TEGO sponsora (`?sponsor=`).
//   3. TYTUŁ W ZŁYM JĘZYKU albo pusty - tytuł z przejściem na drugi język i na
//      slug; poziom tylko, gdy jest.
//   4. KARTA PYTA O CUDZĄ FIRMĘ.
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanySponsorshipRow } from "@/lib/events/sponsorReportApi";

const h = vi.hoisted(() => ({
  lang: "pl",
  query: { isPending: true, isError: false, error: null, data: undefined } as {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: unknown[] | undefined;
  },
  companyIds: [] as string[],
  links: [] as { to: unknown; params: unknown; search: unknown }[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string;
    params: Record<string, string>;
    search: unknown;
    children: ReactNode;
    [key: string]: unknown;
  }) => {
    h.links.push({ to, params, search });
    return (
      <a href={to.replace("$eventId", params.eventId)} {...rest}>
        {children}
      </a>
    );
  },
}));
vi.mock("@/lib/events/useSponsorReport", () => ({
  useCompanySponsorships: (companyId: string) => {
    h.companyIds.push(companyId);
    return h.query;
  },
}));

const { CompanySponsorshipsCard } = await import("@/components/admin/crm/CompanySponsorshipsCard");

const C = "adminEventSponsorReport.company";

function row(patch: Partial<CompanySponsorshipRow>): CompanySponsorshipRow {
  return {
    active_links: 0,
    clicks_unique: 3,
    event_id: "ev1",
    event_slug: "kongres-2099",
    event_starts_at: "2099-06-20T08:00:00Z",
    event_status: "published",
    event_title_en: "Energy Congress",
    event_title_pl: "Kongres Energii",
    is_published: true,
    leads_consented: 1,
    leads_total: 4,
    material_opens: 0,
    meetings_held: 2,
    role: "sponsor",
    sponsor_id: "sp1",
    tier_name_en: "Gold",
    tier_name_pl: "Złoty",
    views_unique: 1200,
    ...patch,
  };
}

function card() {
  return render(<CompanySponsorshipsCard companyId="firma-1" />);
}

beforeEach(() => {
  h.lang = "pl";
  h.query = { isPending: false, isError: false, error: null, data: [] };
  h.companyIds = [];
  h.links = [];
});

describe("CompanySponsorshipsCard", () => {
  it("w trakcie wczytywania nic nie rysuje (strona firmy nie skacze szkieletem)", () => {
    h.query = { isPending: true, isError: false, error: null, data: undefined };
    const { container } = card();
    expect(container.innerHTML).toBe("");
  });

  it("odmowa uprawnień chowa kartę całkowicie", () => {
    h.query = {
      isPending: false,
      isError: true,
      error: new Error("forbidden: event admin required"),
      data: undefined,
    };
    const { container } = card();
    expect(container.innerHTML).toBe("");
  });

  it("inny błąd mówi zdaniem, bez licznika", () => {
    h.query = { isPending: false, isError: true, error: new Error("boom"), data: undefined };
    card();
    expect(screen.getByText(`${C}.loadError`)).toBeTruthy();
    expect(screen.getByRole("region", { name: `${C}.title` })).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("firma bez sponsoringu: licznik zero i zdanie", () => {
    card();
    expect(screen.getByText(`${C}.empty`)).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(h.companyIds.every((id) => id === "firma-1")).toBe(true);
  });

  it("wiersz: tytuł, data, rola, poziom, szkic i metryki; odnośnik do raportu z filtrem sponsora", () => {
    h.query.data = [
      row({}),
      row({
        sponsor_id: "sp2",
        event_id: "ev2",
        event_title_pl: "",
        event_title_en: "",
        tier_name_pl: "",
        tier_name_en: "",
        role: "media_partner",
        is_published: false,
      }),
    ];
    card();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const first = within(items[0]);
    const link = first.getByRole("link", { name: `${C}.openReport(title=Kongres Energii)` });
    expect(link.getAttribute("href")).toBe("/admin/events/ev1/sponsor-report");
    expect(first.getByText("adminEventSponsorReport.roles.sponsor")).toBeTruthy();
    expect(first.getByText("Złoty")).toBeTruthy();
    expect(first.getByText(/2099/)).toBeTruthy();
    expect(first.queryByText(`${C}.unpublished`)).toBeNull();
    // Liczby idą przez formatowanie języka panelu - separator tysięcy zależy od niego.
    const metrics = first.getByText(/company\.metrics\(/).textContent ?? "";
    expect(metrics.replace(/\s/g, "")).toBe(
      `${C}.metrics(clicks=3,consented=1,leads=4,meetings=2,views=1200)`,
    );
    expect(h.links[0]).toEqual({
      to: "/admin/events/$eventId/sponsor-report",
      params: { eventId: "ev1" },
      search: { sponsor: "sp1" },
    });

    const second = within(items[1]);
    // Wydarzenie bez tytułu w obu językach: slug zamiast pustego odnośnika.
    expect(second.getByRole("link").textContent).toBe("kongres-2099");
    expect(second.getByText("adminEventSponsorReport.roles.mediaPartner")).toBeTruthy();
    expect(second.getByText(`${C}.unpublished`)).toBeTruthy();
    expect(second.queryByText("Złoty")).toBeNull();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("po angielsku tytuł i poziom są angielskie", () => {
    h.lang = "en";
    h.query.data = [row({})];
    card();
    expect(screen.getByRole("link").textContent).toBe("Energy Congress");
    expect(screen.getByText("Gold")).toBeTruthy();
  });
});
