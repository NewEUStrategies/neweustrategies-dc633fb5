import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { renderToString } from "react-dom/server";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";
import { HomeEmptyNotice } from "../HomeEmptyNotice";

describe("empty home SSR", () => {
  it.each([
    ["pl", "Nie ma tu jeszcze treści"],
    ["en", "There's nothing here yet"],
  ] as const)("uses the %s core dictionary before hydration", async (lang, expected) => {
    const i18n = createInstance();
    await i18n.init({
      lng: lang === "pl" ? "en" : "pl",
      resources: { pl: { translation: pl }, en: { translation: en } },
      interpolation: { escapeValue: false },
    });
    const html = renderToString(
      <I18nextProvider i18n={i18n}>
        <HomeEmptyNotice lang={lang} />
      </I18nextProvider>,
    );
    expect(html.replaceAll("&#x27;", "'")).toContain(expected);
    expect(html).not.toContain("common.homeEmptyNotice");
  });
});
