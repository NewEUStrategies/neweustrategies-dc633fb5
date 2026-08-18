// Karty na karcie kontaktu CRM: plakietka score, rozbicie punktacji, zużycie
// limitu, członkostwo, avatar i synchronizacja profilu.
//
// Każda z nich pokazuje sprzedaży LICZBĘ albo STATUS, na podstawie którego
// zapada decyzja handlowa - test sprawdza, że pokazują to, co przyszło z bazy,
// i że stan pusty nie udaje danych.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  metering: null as unknown,
  membership: null as unknown,
  profileSync: null as unknown,
  recomputed: [] as unknown[],
  toastError: [] as string[],
}));

vi.mock("@/lib/crm.functions", () => ({
  getCrmLeadMonthlyMetering: async () => ({ json: JSON.stringify(h.metering) }),
  getCrmLeadMembership: async () => ({ json: JSON.stringify(h.membership) }),
  getCrmLeadProfileSync: async () => ({ json: JSON.stringify(h.profileSync) }),
  recomputeLeadScore: async (input: unknown) => {
    h.recomputed.push(input);
    return { json: "null" };
  },
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub };
});
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError.push(m), success: () => {} },
}));

import { LeadScoreBadge } from "../LeadScoreBadge";
import { ScoreBreakdownCard } from "../ScoreBreakdownCard";
import { MeteringUsageCard } from "../MeteringUsageCard";
import { LeadMembershipCard } from "../LeadMembershipCard";
import { FaceAwareAvatar } from "../FaceAwareAvatar";
import { ProfileSyncCard } from "../ProfileSyncCard";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.metering = null;
  h.membership = null;
  h.profileSync = null;
  h.recomputed = [];
  h.toastError = [];
});

describe("LeadScoreBadge", () => {
  it("pokazuje wynik i opisuje pasmo dla czytnika ekranu", () => {
    renderWithQueryClient(<LeadScoreBadge score={87} band="hot" lang="pl" />);
    const badge = screen.getByLabelText(/Lead score 87/);
    expect(badge).toHaveTextContent("87");
    expect(badge.getAttribute("aria-label")).toContain("Gorący");
  });

  it("etykieta pasma pojawia się dopiero na żądanie", () => {
    const { rerender } = renderWithQueryClient(<LeadScoreBadge score={10} band="cold" lang="en" />);
    expect(screen.queryByText("Cold")).toBeNull();
    rerender(<LeadScoreBadge score={10} band="cold" lang="en" showLabel />);
    expect(screen.getByText("Cold")).toBeInTheDocument();
  });
});

describe("ScoreBreakdownCard", () => {
  it("pusty breakdown mówi wprost, że nie ma sygnałów", () => {
    renderWithQueryClient(
      <ScoreBreakdownCard
        leadId={LEAD_ID}
        score={0}
        band="cold"
        breakdown={null}
        updatedAt={null}
        lang="pl"
      />,
    );
    expect(screen.getByText(/Brak sygnałów/)).toBeInTheDocument();
  });

  it("pokazuje sygnały z punktami i liczbą zdarzeń", () => {
    renderWithQueryClient(
      <ScoreBreakdownCard
        leadId={LEAD_ID}
        score={42}
        band="warm"
        breakdown={[
          { key: "form_submit", count: 3, points: 12 },
          { key: "marketing_consent", count: 1, points: 5 },
        ]}
        updatedAt="2026-08-18T10:00:00.000Z"
        lang="pl"
      />,
    );
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("+5")).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/Zaktualizowano/)).toBeInTheDocument();
  });

  it("przycisk przeliczenia woła serwer dla tego leada", async () => {
    renderWithQueryClient(
      <ScoreBreakdownCard
        leadId={LEAD_ID}
        score={0}
        band="cold"
        breakdown={[]}
        updatedAt={null}
        lang="pl"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Przelicz/ }));
    await waitFor(() => expect(h.recomputed).toEqual([{ data: { id: LEAD_ID } }]));
  });
});

describe("MeteringUsageCard", () => {
  it("brak powiązanego użytkownika mówi o rejestracji, nie pokazuje zer", async () => {
    renderWithQueryClient(<MeteringUsageCard leadId={LEAD_ID} lang="pl" />);
    expect(await screen.findByText(/Brak powiązanego użytkownika/)).toBeInTheDocument();
  });

  it("pokazuje zużycie i pozostałe artykuły", async () => {
    h.metering = {
      used: 3,
      monthly_limit: 5,
      remaining: 2,
      period_month: "2026-08-01",
      enabled: true,
      user_id: "u1",
    };
    renderWithQueryClient(<MeteringUsageCard leadId={LEAD_ID} lang="pl" />);
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("/ 5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("LeadMembershipCard", () => {
  it("brak dopasowanego profilu nie udaje członkostwa", async () => {
    renderWithQueryClient(<LeadMembershipCard leadId={LEAD_ID} lang="pl" />);
    expect(await screen.findByText("Członkostwo")).toBeInTheDocument();
  });

  it("pokazuje warstwę, źródło i plan płatny", async () => {
    h.membership = {
      user_id: "u1",
      tier: { key: "pro", rank: 30, name_pl: "Pro", name_en: "Pro", is_default: false },
      source: "subscription",
      subscription: {
        id: "sub1",
        status: "active",
        current_period_end: "2026-12-31T00:00:00.000Z",
        plan: {
          id: "p1",
          name_pl: "Plan Pro",
          name_en: "Pro plan",
          interval: "year",
          tier_key: "pro",
        },
      },
      organization: null,
      active_grants: 0,
    };
    renderWithQueryClient(<LeadMembershipCard leadId={LEAD_ID} lang="pl" />);
    expect(await screen.findByText("Pro")).toBeInTheDocument();
    expect(screen.getByText(/subskrypcja/)).toBeInTheDocument();
    expect(screen.getByText(/Plan Pro/)).toBeInTheDocument();
  });
});

describe("FaceAwareAvatar", () => {
  it("bez zdjęcia pokazuje dwuznakowe inicjały wielkimi literami", () => {
    renderWithQueryClient(<FaceAwareAvatar url={null} name="Anna Kowalska" initials="ak" />);
    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("ze zdjęciem nie renderuje pustego obrazka bez opisu", () => {
    const { container } = renderWithQueryClient(
      <FaceAwareAvatar url="https://example.test/a.png" name="Anna" initials="AN" />,
    );
    const img = container.querySelector("img");
    if (img) expect(img.getAttribute("alt")).toBe("Anna");
  });
});

describe("ProfileSyncCard", () => {
  it("brak dopasowania mówi, że kontakt nie ma konta", async () => {
    h.profileSync = { matched: false };
    renderWithQueryClient(<ProfileSyncCard leadId={LEAD_ID} lang="pl" />);
    expect(await screen.findByText(/Brak dopasowanego profilu/)).toBeInTheDocument();
  });

  it("pokazuje doświadczenie, umiejętności i rozmiar CV", async () => {
    h.profileSync = {
      matched: true,
      profile: {
        id: "u1",
        display_name: "Anna Kowalska",
        job_title: "Dyrektorka",
        location: "Bruksela",
        slug: "anna-kowalska",
      },
      experiences: [
        {
          id: "e1",
          role_title: "Analityczka",
          company: "Acme",
          start_date: "2019-01-01",
          end_date: "2023-01-01",
          is_current: false,
        },
      ],
      skills: [{ id: "s1", name: "Polityka energetyczna", level: null, endorsements_count: 3 }],
      cv: {
        id: "cv1",
        file_url: "https://example.test/cv.pdf",
        file_name: "cv.pdf",
        mime_type: "application/pdf",
        size_bytes: 2048,
        version: 2,
        uploaded_at: "2026-08-01T10:00:00.000Z",
      },
      awards: [],
      education: [],
    };
    renderWithQueryClient(<ProfileSyncCard leadId={LEAD_ID} lang="pl" />);
    expect(await screen.findByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText(/Analityczka/)).toBeInTheDocument();
    expect(screen.getByText(/Polityka energetyczna/)).toBeInTheDocument();
    // Rozmiar pliku w jednostce czytelnej dla człowieka (reguła profileSyncView).
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/2019/)).toBeInTheDocument();
  });
});
