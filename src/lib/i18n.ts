import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";

const resources = {
  pl: { translation: pl },
  en: { translation: en },
};

const STORAGE_KEY = "lovable.lang";
const COOKIE_KEY = "lovable_lang";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 rok
type AppLang = "pl" | "en";

function normalizeLang(value: string | null | undefined): AppLang | null {
  const code = (value ?? "").toLowerCase().split("-")[0];
  return code === "pl" || code === "en" ? code : null;
}

function readCookieFromHeader(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = header.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function detectBrowserLang(): "pl" | "en" {
  if (typeof navigator === "undefined") return "pl";
  const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""]) as string[];
  for (const l of langs) {
    const code = (l || "").toLowerCase().split("-")[0];
    if (code === "pl" || code === "en") return code;
  }
  return "pl";
}

function readUrlLang(): "pl" | "en" | null {
  if (typeof window === "undefined") return null;
  try {
    const l = new URLSearchParams(window.location.search).get("lang");
    if (l === "pl" || l === "en") return l;
  } catch {
    /* ignore */
  }
  return null;
}

export const getRequestInitialLang = createIsomorphicFn()
  .server((): AppLang => {
    try {
      const req = getRequest();
      const urlLang = normalizeLang(new URL(req.url).searchParams.get("lang"));
      if (urlLang) return urlLang;
      return normalizeLang(readCookieFromHeader(req.headers.get("cookie"), COOKIE_KEY)) ?? "pl";
    } catch {
      return "pl";
    }
  })
  .client((): AppLang => {
    // During hydration the client must not guess from navigator.language, because
    // the server cannot know that value. Use only explicit, SSR-repeatable state.
    return readUrlLang() ?? normalizeLang(readCookie(COOKIE_KEY)) ?? "pl";
  });

function readStoredLang(): "pl" | "en" {
  // An explicit ?lang= (e.g. from an hreflang alternate or a shared deep link)
  // wins over the stored preference so language-addressable URLs work.
  if (typeof window === "undefined") return getRequestInitialLang();
  const fromUrl = readUrlLang();
  if (fromUrl) return fromUrl;
  try {
    const stored = readCookie(COOKIE_KEY) || window.localStorage.getItem(STORAGE_KEY);
    if (stored === "pl" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  return "pl";
}

export async function syncI18nToRequest(): Promise<AppLang> {
  const lang = getRequestInitialLang();
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
  return lang;
}

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: readStoredLang(),
      fallbackLng: "pl",
      supportedLngs: ["pl", "en"],
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });

  if (typeof window !== "undefined") {
    i18n.on("languageChanged", (lng) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, lng);
        writeCookie(COOKIE_KEY, lng);
        document.documentElement.setAttribute("lang", lng);
      } catch {
        /* ignore */
      }
    });
    try {
      document.documentElement.setAttribute("lang", i18n.language);
      // Backfill cookie if missing (np. ustawione tylko w localStorage wcześniej).
      if (!readCookie(COOKIE_KEY)) writeCookie(COOKIE_KEY, i18n.language);
    } catch {
      /* ignore */
    }
  }
}


export default i18n;

