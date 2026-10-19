// Klucz uprawnienia w benefitach warstwy (P20, hub S1) - pole edytora cennika.
//
// CO TU JEST DO ZEPSUCIA. `capability_key` łączy punkt karty cennika z bramką:
// macierz plan × benefit i reguła diagnostyki `catalog.promise_without_gate`
// porównują to, co sprzedajemy, z tym, co warstwa realnie odblokowuje.
//   1. Wybór z listy zapisuje klucz W TYM benefitcie i nie rusza reszty pól.
//   2. „Bez powiązania” USUWA pole z obiektu (nie zostawia pustego napisu,
//      który zapis i tak by odrzucił - szkic i zapis mają ten sam kształt).
//   3. Klucz spoza rejestru (zapis z innej wersji panelu) jest widoczny jako
//      wybrana opcja - pole nie udaje „bez powiązania”, gdy w bazie jest klucz.
//   4. Wiersz z kluczem startuje rozwinięty - nic edytowalnego nie znika.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TierBenefit } from "@/lib/billing/tiers";

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => "pl");
});
vi.mock("@/lib/i18n-admin-pricing", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/i18n-admin-membership", () => ({ ensureI18n: () => {} }));

// Radixowy <Select> nie otwiera listy w happy-dom - atrapa oddaje natywny
// <select>. Etykieta dostępna atomu `FormSelect` stoi na wyzwalaczu, więc
// atrapa przenosi ją na <select>, a opcje bierze z treści listy.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Node = React.ReactNode;
  const Select = ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: Node;
  }) => {
    let ariaLabel: string | undefined;
    const options: Node[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { "aria-label"?: string; children?: Node };
      if (props["aria-label"]) ariaLabel = props["aria-label"];
      else options.push(props.children);
    });
    return React.createElement(
      "select",
      {
        "aria-label": ariaLabel,
        value: value ?? "",
        onChange: (e: { target: { value: string } }) => onValueChange?.(e.target.value),
      },
      options as never,
    );
  };
  return {
    Select,
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: () => null,
    SelectItem: ({ value, children }: { value: string; children?: Node }) =>
      React.createElement("option", { value }, children),
  };
});

import { TierBenefitsEditor } from "@/components/admin/pricing/TierBenefitsEditor";

function renderBenefits(initial: TierBenefit[]) {
  const onChange = vi.fn();
  render(<TierBenefitsEditor value={initial} onChange={onChange} />);
  const latest = (): TierBenefit[] =>
    (onChange.mock.calls.at(-1)?.[0] as TierBenefit[] | undefined) ?? initial;
  return { onChange, latest };
}

const LABEL = "adminPricing.benefits.capability #1";

function capabilitySelect(): HTMLSelectElement {
  return screen.getByLabelText(LABEL) as HTMLSelectElement;
}

describe("TierBenefitsEditor - klucz uprawnienia (capability_key)", () => {
  it("wiersz z kluczem startuje rozwinięty i pokazuje wybrane uprawnienie", () => {
    renderBenefits([{ pl: "Linki", en: "Links", capability_key: "gift_links" }]);

    expect(screen.getByText("adminPricing.benefits.more").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(capabilitySelect().value).toBe("gift_links");
  });

  it("wybór uprawnienia zapisuje klucz w TYM benefitcie, reszta pól zostaje", () => {
    const { latest } = renderBenefits([
      { pl: "Analizy", en: "Analyses", detail_pl: "Bez limitów." },
      { pl: "Kluby", en: "Clubs" },
    ]);

    fireEvent.change(capabilitySelect(), { target: { value: "premium_content" } });

    expect(latest()).toEqual([
      {
        pl: "Analizy",
        en: "Analyses",
        detail_pl: "Bez limitów.",
        capability_key: "premium_content",
      },
      { pl: "Kluby", en: "Clubs" },
    ]);
  });

  it("„bez powiązania” usuwa pole z obiektu - zamiast pustego napisu", () => {
    const { latest } = renderBenefits([
      { pl: "Nagrania", en: "Recordings", capability_key: "recordings" },
    ]);

    fireEvent.change(capabilitySelect(), { target: { value: "__none__" } });

    expect(latest()[0]).toEqual({ pl: "Nagrania", en: "Recordings" });
    expect("capability_key" in latest()[0]).toBe(false);
  });

  it("klucz spoza rejestru jest wybraną opcją pod surową nazwą - nie udaje braku", () => {
    renderBenefits([{ pl: "Własny", en: "Custom", capability_key: "custom.flag:v2" }]);

    const select = capabilitySelect();
    expect(select.value).toBe("custom.flag:v2");
    expect(Array.from(select.options).map((option) => option.textContent)).toContain(
      "custom.flag:v2",
    );
  });

  it("opcje rejestru niosą znacznik egzekwowane/deklarowane - widać obietnicę bez bramki", () => {
    renderBenefits([{ pl: "A", en: "A", capability_key: "premium_content" }]);

    const labels = Array.from(capabilitySelect().options).map((option) => option.textContent);
    expect(labels[0]).toBe("adminPricing.benefits.capabilityNone");
    expect(labels).toContain(
      "adminMembership.capabilities.labels.premium_content · adminMembership.capabilities.enforcedBadge",
    );
    expect(labels).toContain(
      "adminMembership.capabilities.labels.vip_concierge · adminMembership.capabilities.decorativeBadge",
    );
  });
});
