// Sekcja „Co otwiera ta warstwa": podsumowanie, grupy przełączników, limity,
// flagi spoza rejestru i zwijany surowy JSON.
//
// Pilnowane tu wprost: przełącznik ZAPISUJE do draftu features (inaczej admin
// klika, a członek nic nie dostaje), wyłączenie usuwa klucz, limit 0 znika,
// a surowy JSON pozostaje dostępny dla wdrożeniowca.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { radixSwitchStub, reactI18nextStub } from "@/test/admin/pricingFixtures";

let lang: "pl" | "en" = "pl";

vi.mock("react-i18next", () => reactI18nextStub(() => lang));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

const { TierCapabilitiesPanel } =
  await import("@/components/admin/membership/organisms/TierCapabilitiesPanel");
const { CapabilityToggleRow } =
  await import("@/components/admin/membership/atoms/CapabilityToggleRow");
const { LimitField } = await import("@/components/admin/membership/atoms/LimitField");

function renderPanel(value: string) {
  const onChange = vi.fn();
  const view = render(<TierCapabilitiesPanel value={value} onChange={onChange} />);
  return { onChange, view };
}

describe("TierCapabilitiesPanel - grupy i przełączniki", () => {
  it("pokazuje obszary bramek zamiast płaskiej listy kluczy", () => {
    renderPanel("{}");
    expect(screen.getByText("adminMembership.capabilities.gates.content")).toBeTruthy();
    expect(screen.getByText("adminMembership.capabilities.gates.chat")).toBeTruthy();
    expect(screen.getByText("adminMembership.capabilities.gates.none")).toBeTruthy();
  });

  it("włączenie flagi zapisuje ją do draftu", () => {
    const { onChange } = renderPanel("{}");
    fireEvent.click(screen.getByLabelText("adminMembership.capabilities.labels.recordings"));
    expect(JSON.parse(String(onChange.mock.calls[0][0])).recordings).toBe(true);
  });

  it("wyłączenie flagi usuwa klucz z draftu", () => {
    const { onChange } = renderPanel('{"recordings":true}');
    fireEvent.click(screen.getByLabelText("adminMembership.capabilities.labels.recordings"));
    expect(onChange).toHaveBeenCalledWith("{}");
  });

  it("podsumowanie liczy włączone, egzekwowane i deklarowane", () => {
    renderPanel('{"premium_content":true,"working_groups":true}');
    expect(
      screen.getByText(/adminMembership\.capabilities\.summary\.enforced.*"count":1/),
    ).toBeTruthy();
    expect(
      screen.getByText(/adminMembership\.capabilities\.summary\.decorative.*"count":1/),
    ).toBeTruthy();
  });

  it("licznik grupy pokazuje włączone / wszystkie", () => {
    renderPanel('{"premium_content":true}');
    expect(
      screen.getAllByText(/adminMembership\.capabilities\.groupCount.*"enabled":1/).length,
    ).toBeGreaterThan(0);
  });
});

describe("TierCapabilitiesPanel - limity", () => {
  it("renderuje limity liczbowe z draftu", () => {
    renderPanel('{"included_event_tickets":2}');
    const input = screen.getByLabelText(
      "adminMembership.capabilities.limits.included_event_tickets",
    ) as HTMLInputElement;
    expect(input.value).toBe("2");
  });

  it("zmiana limitu zapisuje wartość", () => {
    const { onChange } = renderPanel("{}");
    fireEvent.change(
      screen.getByLabelText("adminMembership.capabilities.limits.included_event_tickets"),
      { target: { value: "5" } },
    );
    expect(onChange).toHaveBeenCalledWith('{"included_event_tickets":5}');
  });

  it("wyzerowanie limitu usuwa klucz", () => {
    const { onChange } = renderPanel('{"included_event_tickets":5}');
    fireEvent.change(
      screen.getByLabelText("adminMembership.capabilities.limits.included_event_tickets"),
      { target: { value: "0" } },
    );
    expect(onChange).toHaveBeenCalledWith("{}");
  });

  it("zniżka procentowa ma sufit 100", () => {
    renderPanel("{}");
    const input = screen.getByLabelText(
      "adminMembership.capabilities.limits.event_ticket_discount_pct",
    );
    expect(input.getAttribute("max")).toBe("100");
  });
});

describe("TierCapabilitiesPanel - JSON i flagi nieznane", () => {
  it("surowy JSON jest dostępny i edytowalny", () => {
    const { onChange } = renderPanel("{}");
    const raw = screen.getByLabelText("adminMembership.capabilities.advanced.heading");
    fireEvent.change(raw, { target: { value: '{"x":true}' } });
    expect(onChange).toHaveBeenCalledWith('{"x":true}');
  });

  it("flaga spoza rejestru jest wypisana", () => {
    renderPanel('{"eksperymentalna":true}');
    expect(screen.getByText("eksperymentalna")).toBeTruthy();
  });

  it("bez flag nieznanych sekcja się nie pojawia", () => {
    renderPanel('{"premium_content":true}');
    expect(screen.queryByText("adminMembership.capabilities.unknown.heading")).toBeNull();
  });

  it("błędny JSON nie wywraca panelu", () => {
    renderPanel("{nie-json");
    expect(screen.getByText("adminMembership.capabilities.heading")).toBeTruthy();
  });

  it("angielski panel czyta opisy EN", () => {
    lang = "en";
    renderPanel("{}");
    expect(screen.getByText(/Content paywall/)).toBeTruthy();
    lang = "pl";
  });
});

describe("CapabilityToggleRow - atom", () => {
  const item = {
    key: "premium_content",
    enabled: false,
    enforced: true,
    gate: "content" as const,
    where: "Paywall",
  };

  it("egzekwowane uprawnienie ma swój znacznik", () => {
    render(<CapabilityToggleRow item={item} label="Analizy" onToggle={() => {}} />);
    expect(screen.getByText("adminMembership.capabilities.enforcedBadge")).toBeTruthy();
    expect(screen.getByText("premium_content")).toBeTruthy();
  });

  it("dekoracyjne uprawnienie ma znacznik deklaracji", () => {
    render(
      <CapabilityToggleRow
        item={{ ...item, enforced: false, enabled: true }}
        label="Grupy"
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("adminMembership.capabilities.decorativeBadge")).toBeTruthy();
  });

  it("wyłączony przełącznik nie woła zwrotki", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <CapabilityToggleRow item={item} label="Analizy" disabled onToggle={onToggle} />,
    );
    fireEvent.click(within(container).getByLabelText("Analizy"));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("LimitField - atom", () => {
  it("nie-liczba czyta się jako 0", () => {
    const onChange = vi.fn();
    render(<LimitField id="l" label="Bilety" value={1} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Bilety"), { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith(0);
  });
});
