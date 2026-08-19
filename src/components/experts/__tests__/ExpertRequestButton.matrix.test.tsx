// Macierz testow ExpertRequestButton: tier/quota/pending x widocznosc, etykiety
// i18n, stan disabled/enabled, brak layout-shiftu w stanie pending i akcja
// klikniecia (otwarcie dialogu przez event-bus).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { ExpertRequestQuota } from "@/lib/chat/useExpertRequests";

const h = vi.hoisted(() => ({
  user: { id: "me" } as { id: string } | null,
  modules: { expert_requests_enabled: true },
  quota: {
    data: undefined as ExpertRequestQuota | undefined,
    isPending: false,
  },
  openDialog: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("@/lib/i18n-expert-request", () => ({ ensureI18n: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user }),
}));

vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => h.modules,
}));

vi.mock("@/lib/chat/useExpertRequests", () => ({
  useMyExpertRequestQuota: () => h.quota,
}));

vi.mock("@/lib/chat/expertRequestDialogBus", () => ({
  openExpertRequestDialog: (...args: unknown[]) => h.openDialog(...args),
}));

import { ExpertRequestButton } from "@/components/experts/ExpertRequestButton";

function renderButton() {
  return renderWithQueryClient(
    <ExpertRequestButton expertId="expert-1" expertName="Jan Kowalski" expertAvatar={null} />,
  );
}

function quotaFor(overrides: Partial<ExpertRequestQuota>): ExpertRequestQuota {
  return {
    quota: 0,
    used: 0,
    remaining: 0,
    unlimited: false,
    direct: false,
    ...overrides,
  };
}

beforeEach(() => {
  h.user = { id: "me" };
  h.modules = { expert_requests_enabled: true };
  h.quota = { data: undefined, isPending: false };
  h.openDialog.mockClear();
});

describe("ExpertRequestButton - macierz", () => {
  it("anon: nic sie nie renderuje", () => {
    h.user = null;
    h.quota = { data: quotaFor({ quota: 5, remaining: 3 }), isPending: false };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("wlasny profil: nic sie nie renderuje", () => {
    h.user = { id: "expert-1" };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("globalna bramka wylaczona (tenant): nic sie nie renderuje", () => {
    h.modules = { expert_requests_enabled: false };
    h.quota = { data: quotaFor({ quota: 5, remaining: 3 }), isPending: false };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("pending: pokazuje stabilny disabled placeholder, nie znika", () => {
    h.quota = { data: undefined, isPending: true };
    renderButton();
    const button = screen.getByRole("button", { hidden: true });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-hidden");
    expect(h.openDialog).not.toHaveBeenCalled();
  });

  it("tier free/essential (brak puli, quota=0): przycisk niewidoczny (quota.direct=false, quota=0 -> chowa sie? nie - brak allowance ale wciaz widoczny bez licznika)", () => {
    h.quota = { data: quotaFor({ quota: 0, remaining: 0, used: 0 }), isPending: false };
    renderButton();
    // Bez puli (quota=0) przycisk nadal renderuje CTA, ale bez licznika.
    expect(screen.getByRole("button", { name: /expertRequest.cta/ })).toBeInTheDocument();
    expect(screen.queryByText(/\/0/)).not.toBeInTheDocument();
  });

  it("tier plus - quota dostepna: pokazuje licznik i jest klikalny", () => {
    h.quota = { data: quotaFor({ quota: 3, remaining: 2, used: 1 }), isPending: false };
    renderButton();
    const button = screen.getByRole("button", { name: /expertRequest.cta/ });
    expect(button).not.toBeDisabled();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    fireEvent.click(button);
    expect(h.openDialog).toHaveBeenCalledWith({
      recipientId: "expert-1",
      recipientName: "Jan Kowalski",
      recipientAvatar: null,
    });
  });

  it("tier pro - quota wyczerpana: licznik w wariancie 'exhausted', przycisk wciaz klikalny (serwer odrzuci)", () => {
    h.quota = { data: quotaFor({ quota: 3, remaining: 0, used: 3 }), isPending: false };
    renderButton();
    const counter = screen.getByText("0/3");
    expect(counter.className).toMatch(/amber/);
    const button = screen.getByRole("button", { name: /expertRequest.cta/ });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(h.openDialog).toHaveBeenCalledTimes(1);
  });

  it("tier vip/ekspert (direct=true): CTA znika - pisza wprost, bez zapytania", () => {
    h.quota = {
      data: quotaFor({ quota: 0, remaining: 0, direct: true, unlimited: true }),
      isPending: false,
    };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("pula nieograniczona (unlimited, ponizej progu direct): brak licznika, klikalny", () => {
    h.quota = {
      data: quotaFor({ quota: 1500, remaining: 1500, unlimited: true }),
      isPending: false,
    };
    renderButton();
    const button = screen.getByRole("button", { name: /expertRequest.cta/ });
    expect(button).not.toBeDisabled();
    expect(screen.queryByText(/\/1500/)).not.toBeInTheDocument();
  });

  it("wariant compact: uzywa skroconej etykiety i18n", () => {
    h.quota = { data: quotaFor({ quota: 3, remaining: 2 }), isPending: false };
    renderWithQueryClient(
      <ExpertRequestButton expertId="expert-1" expertName="Jan Kowalski" compact />,
    );
    expect(screen.getByText("expertRequest.ctaShort")).toBeInTheDocument();
  });

  it("wariant ikonowy: bez etykiety i bez licznika w tresci przycisku", () => {
    // Gesty pasek akcji na profilu - pelna informacja o puli przenosi sie do
    // tooltipa, zeby przycisk nie rozpychal wiersza.
    h.quota = { data: quotaFor({ quota: 3, remaining: 2 }), isPending: false };
    renderWithQueryClient(
      <ExpertRequestButton expertId="expert-1" expertName="Jan Kowalski" iconOnly />,
    );
    const button = screen.getByRole("button", { name: /expertRequest.cta/ });
    expect(button).toHaveTextContent("");
    expect(screen.queryByText("2/3")).not.toBeInTheDocument();
  });

  it("wariant ikonowy z WYCZERPANA pula dostaje kropke ostrzegawcza", () => {
    // Jedyny sygnal wyczerpania w tym wariancie: bez niej uzytkownik klika
    // i dopiero dialog mowi mu, ze puli nie ma.
    h.quota = { data: quotaFor({ quota: 3, remaining: 0 }), isPending: false };
    const { container } = renderWithQueryClient(
      <ExpertRequestButton expertId="expert-1" expertName="Jan Kowalski" iconOnly />,
    );
    expect(container.querySelector("span.bg-amber-500")).toBeInTheDocument();
  });

  it("wariant ikonowy z wolna pula NIE pokazuje kropki", () => {
    h.quota = { data: quotaFor({ quota: 3, remaining: 1 }), isPending: false };
    const { container } = renderWithQueryClient(
      <ExpertRequestButton expertId="expert-1" expertName="Jan Kowalski" iconOnly />,
    );
    expect(container.querySelector("span.bg-amber-500")).toBeNull();
  });
});
