import { describe, expect, it } from "vitest";
import {
  AUTH_DEFAULTS,
  authSettingsEqual,
  isLoginPosition,
  normalizeAuthSettings,
} from "@/lib/authSettings";

describe("normalizeAuthSettings", () => {
  it("zwraca niezależną kopię domyślnych ustawień dla braku danych", () => {
    const normalized = normalizeAuthSettings(null);

    expect(normalized).toEqual(AUTH_DEFAULTS);
    expect(normalized).not.toBe(AUTH_DEFAULTS);
  });

  it("scala częściowy rekord z wartościami domyślnymi", () => {
    const normalized = normalizeAuthSettings({
      popup_enabled: false,
      hero_title_pl: "Nowy tytuł",
    });

    expect(normalized.popup_enabled).toBe(false);
    expect(normalized.hero_title_pl).toBe("Nowy tytuł");
    expect(normalized.hero_title_en).toBe(AUTH_DEFAULTS.hero_title_en);
  });

  it("odrzuca pola o niezgodnym typie", () => {
    const normalized = normalizeAuthSettings({
      popup_enabled: "false",
      hero_title_pl: 42,
      show_back_to_home: null,
    });

    expect(normalized.popup_enabled).toBe(AUTH_DEFAULTS.popup_enabled);
    expect(normalized.hero_title_pl).toBe(AUTH_DEFAULTS.hero_title_pl);
    expect(normalized.show_back_to_home).toBe(AUTH_DEFAULTS.show_back_to_home);
  });

  it("odrzuca pozycję formularza spoza dozwolonego zakresu", () => {
    const normalized = normalizeAuthSettings({ login_position: "bottom" });

    expect(normalized.login_position).toBe("right");
    expect(isLoginPosition("bottom")).toBe(false);
    expect(isLoginPosition("center")).toBe(true);
  });

  it("ignoruje tablice i wartości prymitywne", () => {
    expect(normalizeAuthSettings([])).toEqual(AUTH_DEFAULTS);
    expect(normalizeAuthSettings("settings")).toEqual(AUTH_DEFAULTS);
    expect(normalizeAuthSettings(0)).toEqual(AUTH_DEFAULTS);
  });
});

describe("authSettingsEqual", () => {
  it("porównuje wszystkie pola kontraktu", () => {
    const same = { ...AUTH_DEFAULTS };
    const changed = { ...AUTH_DEFAULTS, terms_url: "/inne" };

    expect(authSettingsEqual(AUTH_DEFAULTS, same)).toBe(true);
    expect(authSettingsEqual(AUTH_DEFAULTS, changed)).toBe(false);
  });
});
