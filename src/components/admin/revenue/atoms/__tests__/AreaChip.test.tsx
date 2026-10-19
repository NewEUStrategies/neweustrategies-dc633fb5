// `AreaChip` - obszar huba słowem; każdy z 16 obszarów ma nazwę PL i EN,
// a etykiety są parami różne (dwa obszary o tej samej nazwie byłyby
// nierozróżnialne w filtrach Diagnostyki).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { REVENUE_AREAS } from "@/lib/admin/revenue/hubTabs";
import { axeViolations, summarize } from "@/test/axe";
import { AreaChip } from "@/components/admin/revenue/atoms/AreaChip";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

function labelOf(area: (typeof REVENUE_AREAS)[number]): string {
  const { container } = render(<AreaChip area={area} />);
  const text = container.querySelector(`[data-area="${area}"]`)?.textContent ?? "";
  cleanup();
  return text;
}

describe("AreaChip", () => {
  it("pokazuje polską nazwę obszaru, nie klucz", () => {
    expect(labelOf("dunning")).toBe("Windykacja płatności");
    expect(labelOf("data_quality")).toBe("Jakość danych");
  });

  it.each(["pl", "en"] as const)(
    "%s: 16 obszarów, 16 różnych, przetłumaczonych nazw",
    async (lang) => {
      await i18n.changeLanguage(lang);
      const labels = REVENUE_AREAS.map(labelOf);

      expect(labels.every((label) => label.length > 0 && !label.startsWith("adminRevenue."))).toBe(
        true,
      );
      expect(new Set(labels).size).toBe(REVENUE_AREAS.length);
    },
  );

  it("w wersji EN mówi po angielsku", async () => {
    await i18n.changeLanguage("en");
    expect(labelOf("checkout")).toBe("Checkout");
    expect(labelOf("metering")).toBe("Free-article limit");
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(
      <div>
        {REVENUE_AREAS.map((area) => (
          <AreaChip key={area} area={area} />
        ))}
      </div>,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
