import { describe, it, expect } from "vitest";
import i18n from "@/lib/i18n";

// Guards the Polish plural forms: i18next must pick one/few/many by count so
// count strings read grammatically ("1 zaznaczony", "2 zaznaczone",
// "5 zaznaczonych"), not the old single genitive-plural form for every count.
describe("Polish pluralization", () => {
  it("selects one/few/many for admin.bulk.selected", async () => {
    await i18n.changeLanguage("pl");
    expect(i18n.t("admin.bulk.selected", { count: 1 })).toBe("1 zaznaczony");
    expect(i18n.t("admin.bulk.selected", { count: 3 })).toBe("3 zaznaczone");
    expect(i18n.t("admin.bulk.selected", { count: 5 })).toBe("5 zaznaczonych");
    expect(i18n.t("admin.bulk.selected", { count: 22 })).toBe("22 zaznaczone");
  });

  it("inflects the noun in admin.bulk.confirmDeleteTitle", async () => {
    await i18n.changeLanguage("pl");
    expect(i18n.t("admin.bulk.confirmDeleteTitle", { count: 1 })).toBe("Usunąć 1 element?");
    expect(i18n.t("admin.bulk.confirmDeleteTitle", { count: 3 })).toBe("Usunąć 3 elementy?");
    expect(i18n.t("admin.bulk.confirmDeleteTitle", { count: 8 })).toBe("Usunąć 8 elementów?");
  });

  it("inflects English item/items", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("admin.bulk.confirmDeleteTitle", { count: 1 })).toBe("Delete 1 item?");
    expect(i18n.t("admin.bulk.confirmDeleteTitle", { count: 2 })).toBe("Delete 2 items?");
  });
});
