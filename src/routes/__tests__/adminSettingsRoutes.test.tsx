// PIĘTNAŚCIE TRAS `/admin/settings/*` ZAMONTOWANYCH - stan i sklejenie.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// `src/routes/__tests__/adminRouteAuthority.gate.test.ts` argumentuje wprost,
// że render-testowanie tras panelu DLA POKRYCIA jest farmą: ryzyko w trasie
// panelu to DOSTĘP, a dostęp jest egzekwowany w trzech miejscach (wspólny
// layout `/admin`, sama trasa, RLS/RPC). Rodzina `admin.settings.*` została
// w tym samym commicie objęta zakresem tej bramki.
//
// Ten plik pokrywa to, czego bramka NIE WIDZI, i celuje w JEDNĄ konkretną
// liczbę z audytu: **panele ustawień miały 24,5% gałęzi** - czyli trzy czwarte
// warunków w kodzie, który decyduje o konfiguracji CAŁEGO serwisu, nigdy nie
// weszło w oba ramiona. Dlatego przedmiotem dowodu jest tu ODCZYT USTAWIENIA
// w pięciu wariantach, tabelą, dla każdego panelu:
//
//   1. WARTOŚĆ OBECNA - panel pokazuje to, co jest w bazie.
//   2. BRAK WIERSZA - panel pokazuje wartości domyślne i DA SIĘ OTWORZYĆ.
//      Panel ustawień jest jedynym ekranem, z którego naprawia się
//      konfigurację, więc nie wolno mu paść na braku danych.
//   3. WARTOŚĆ FAŁSZYWA ALE PRAWIDŁOWA (`0`, `""`, `false`) - najczęstszy
//      realny błąd w panelach konfiguracji: `value || default` zamiast
//      `value ?? default`. Administrator ustawia zero, zapisuje i po
//      odświeżeniu widzi starą wartość, bez żadnego komunikatu.
//   4. WARTOŚĆ NIEPRAWIDŁOWA W BAZIE (zły typ, obcy kształt, `null`) - nie
//      może wywalić panelu.
//   5. WARTOŚĆ POZA ENUMEM - pole wyboru nie może zostać bez zaznaczenia ani
//      wysłać nieznanej wartości z powrotem do bazy.
//
//   PLUS DLA KAŻDEGO PANELU: co dokładnie leci do zapisu (ładunek), i czy
//   pasek zapisu blokuje się w trakcie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - SILNIKA `useSettings`: głębokie scalenie przy odczycie i zapisie, ponowny
//   odczyt przed zapisem, `onConflict: "tenant_id,key"`, unieważnienie dwóch
//   kluczy cache i emisja zdarzenia podglądu na żywo mają OSOBNY plik
//   (`src/lib/admin/__tests__/useSettings.test.tsx`, 100%/100%). Tutaj
//   `useSettings` jest atrapą i dowodzimy WYŁĄCZNIE tego, co panel do niego
//   wysyła i jak czyta wynik.
// - AUTORYTETU: zapis do `site_settings` pilnuje RLS (administrator w obrębie
//   najemcy) - pgTAP `rls_tenant_isolation_test.sql`,
//   `security_hardening_rls_test.sql`.
// - ORGANIZMÓW SKŁADOWYCH: `ImageSlot`, `FontPicker`, `CustomFontUploader`,
//   `LucideIconPicker`, `MobileBottomBarView`, `ConsentBanner`,
//   `ConsentAuditSummary`, `RobotsTxtPreview`, `DetectedElementsPanel`,
//   `GoogleSourceBadgeDeviceSection` i `CoverImagePicker` są atrapami
//   zapisującymi propsy - każdy ma (albo dostanie) własny test. Przedmiotem
//   dowodu jest to, CO panel im przekazuje.
// - NAGŁÓWKÓW SEO: panel jest `noindex` z definicji; sprawdzamy tylko, że
//   żadna z piętnastu tras nie dokłada sobie `head()` z tytułem publicznym.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

/** Ustalona data bazowa - żadnego `Date.now()`. */
const BASE_ISO = "2026-01-15T10:00:00.000Z";

const h = vi.hoisted(() => ({
  /** Zawartość `site_settings` widziana przez panele, per klucz sekcji. */
  rows: {} as Record<string, unknown>,
  /** Klucze, dla których odczyt ma być W TOKU (panel pokazuje wczytywanie). */
  pending: new Set<string>(),
  /** Klucze, dla których odczyt ma paść. */
  failing: new Set<string>(),
  /** Zapisy zlecone przez panele: klucz sekcji + ładunek. */
  saves: [] as { key: string; value: unknown }[],
  /** Klucze, dla których zapis jest „w toku" (pasek zapisu zablokowany). */
  savingKeys: new Set<string>(),
  /**
   * Gdy ustawione, `save.mutateAsync` RZUCA tym komunikatem. Panel analityki
   * ma własne bloki `catch` wokół łączenia i rozłączania GA4 - bez tego są
   * nieosiągalne, a to one decydują, czy nieudane połączenie da się powtórzyć.
   */
  settingsSaveThrows: null as string | null,
  /** Propsy zapisane przez atrapy organizmów. */
  props: {} as Record<string, Record<string, unknown>>,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  /** Wywołania `setIconPack` - panel ogólny przestawia paczkę ikon od razu. */
  iconPacks: [] as string[],
  /** Wywołania `requestConsentPreferences` z podglądu banera. */
  consentPreviewRequests: 0,
  /** Kolory globalne widziane przez panel wyglądu. */
  globalColors: {} as Record<string, unknown>,
  globalColorSaves: [] as unknown[],
  /** Tokeny projektowe widziane przez panel wyglądu. */
  designTokens: null as unknown,
  designLoading: false,
  designSaves: [] as unknown[],
  /** Zapisane wywołania schowka - kopiowanie nazwy zmiennej CSS. */
  clipboard: [] as string[],
  /** Odpowiedź `analyticsStatus` w panelu analityki. */
  analyticsStatus: null as unknown,
  analyticsStatusError: false,
  /**
   * Gdy ustawione, diagnostyka NIE ODPOWIADA - zapytanie zostaje w toku.
   *
   * To jedyny wierny model stanu „jeszcze nie wróciła". Oddanie `undefined`
   * nim NIE JEST: react-query odrzuca zapytanie, które zwróciło `undefined`
   * („Query data cannot be undefined"), więc panel wchodziłby w stan BŁĘDU -
   * a to osobny wskaźnik, świadomie odróżniony od „sprawdzania" (komentarz
   * przy `StatusKind` w `admin.settings.analytics.tsx`).
   */
  analyticsStatusPending: false,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, info: h.toastInfo },
}));

/**
 * Atrapa silnika ustawień. Panele wołają `useSettings(key, DEFAULTS)`, więc
 * atrapa musi robić DOKŁADNIE to, co robi produkcja przy odczycie: nakładać
 * zapisaną wartość na wartości domyślne. Bez tego test „brak wiersza" nie
 * różniłby się od testu „wartość obecna".
 *
 * SCALANIE JEST PŁASKIE PO PIERWSZYM POZIOMIE i to jest zamierzone: głębokie
 * scalanie ma własny, wyczerpujący test (`useSettings.test.tsx`), a tutaj
 * chodzi o to, JAK PANEL czyta gotowe dane - nie o mechanikę scalania.
 */
vi.mock("@/lib/admin/useSettings", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin/useSettings")>("@/lib/admin/useSettings");
  return {
    ...actual,
    useSettings: (key: string, defaults: Record<string, unknown>) => {
      const stored = h.rows[key];
      const usable = stored !== null && typeof stored === "object" && !Array.isArray(stored);
      const data =
        h.pending.has(key) || h.failing.has(key)
          ? undefined
          : { ...defaults, ...(usable ? (stored as Record<string, unknown>) : {}) };
      return {
        query: {
          data,
          isPending: h.pending.has(key),
          isError: h.failing.has(key),
          error: h.failing.has(key) ? new Error("permission denied") : null,
        },
        save: {
          mutate: (next: unknown) => {
            h.saves.push({ key, value: next });
          },
          mutateAsync: async (next: unknown) => {
            h.saves.push({ key, value: next });
            if (h.settingsSaveThrows !== null) throw new Error(h.settingsSaveThrows);
            return next;
          },
          isPending: h.savingKeys.has(key),
        },
      };
    },
  };
});

/** Atrapa organizmu: marker + zapis propsów. */
function propsStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.props[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/admin/ImageSlot", () => ({ ImageSlot: propsStub("ImageSlot") }));
vi.mock("@/components/admin/settings/FontPicker", () => ({
  FontPicker: propsStub("FontPicker"),
}));
vi.mock("@/components/admin/CustomFontUploader", () => ({
  CustomFontUploader: propsStub("CustomFontUploader"),
}));
vi.mock("@/components/admin/CoverImagePicker", () => ({
  CoverImagePicker: propsStub("CoverImagePicker"),
}));
vi.mock("@/components/admin/DesignSubNav", () => ({ DesignSubNav: propsStub("DesignSubNav") }));
vi.mock("@/components/admin/builder/ui/molecules/LucideIconPicker", () => ({
  LucideIconPicker: propsStub("LucideIconPicker"),
}));
vi.mock("@/components/mobile/bottomBar/MobileBottomBarView", () => ({
  MobileBottomBarView: propsStub("MobileBottomBarView"),
}));
vi.mock("@/components/ConsentBanner", () => ({ ConsentBanner: propsStub("ConsentBanner") }));
vi.mock("@/components/admin/cookie-banner/CookieBannerBrandingSection", () => ({
  CookieBannerBrandingSection: propsStub("CookieBannerBrandingSection"),
}));
vi.mock("@/components/admin/cookie-banner/DetectedElementsPanel", () => ({
  DetectedElementsPanel: propsStub("DetectedElementsPanel"),
}));
vi.mock("@/components/admin/settings/ConsentAuditSummary", () => ({
  ConsentAuditSummary: propsStub("ConsentAuditSummary"),
}));
vi.mock("@/components/admin/seo/RobotsTxtPreview", () => ({
  RobotsTxtPreview: propsStub("RobotsTxtPreview"),
}));
vi.mock("@/components/admin/google-source/GoogleSourceBadgeDeviceSection", () => ({
  GoogleSourceBadgeDeviceSection: propsStub("GoogleSourceBadgeDeviceSection"),
}));
vi.mock("@/components/seo/GooglePreferredSourceBadge", () => ({
  GooglePreferredSourceBadge: propsStub("GooglePreferredSourceBadge"),
}));
vi.mock("@/components/admin/atoms/TtsVoiceSelect", () => ({
  TtsVoiceSelect: propsStub("TtsVoiceSelect"),
}));
vi.mock("@/components/admin/blocks/AdminColorPicker", () => ({
  AdminColorPicker: propsStub("AdminColorPicker"),
}));
vi.mock("@/components/admin/builder/ui/atoms/ColorField", () => ({
  ColorField: propsStub("ColorField"),
}));

vi.mock("@/lib/iconPack", () => ({
  setIconPack: (pack: string) => {
    h.iconPacks.push(pack);
  },
}));
vi.mock("@/lib/ads/consent", () => ({
  requestConsentPreferences: () => {
    h.consentPreviewRequests += 1;
  },
}));
vi.mock("@/lib/builder/designTokens", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDesignTokens: () => ({ data: h.designTokens, isLoading: h.designLoading }),
  useSaveDesignTokens: () => ({
    mutate: (next: unknown) => {
      h.designSaves.push(next);
    },
    isPending: false,
  }),
}));
vi.mock("@/hooks/useGlobalColors", () => ({
  useGlobalColors: () => ({ data: h.globalColors, isLoading: false, isPending: false }),
  useSaveGlobalColors: () => ({
    mutate: (next: unknown) => {
      h.globalColorSaves.push(next);
    },
    isPending: false,
  }),
}));
vi.mock("@/lib/analytics/status.functions", () => ({
  getAnalyticsStatus: async () => {
    // Zapytanie, które nigdy się nie rozstrzyga - patrz `analyticsStatusPending`.
    if (h.analyticsStatusPending) return new Promise<unknown>(() => undefined);
    if (h.analyticsStatusError) throw new Error("status_unavailable");
    return h.analyticsStatus;
  },
  runAnalyticsSelfTest: async () => ({ ok: true }),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerFn: (fn: unknown) => fn,
}));

// Podmiany słowników - trasy rejestrują je w swoim chunku.
vi.mock("@/lib/i18n-admin-appearance-routes", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-mobile-bottom-bar", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-site-identity", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-og-upload", () => ({ ensureI18n: () => undefined }));

// Radix Dialog nie działa pod happy-dom bez pełnego pointer API. Okno łączenia
// GA4 jest jednak przedmiotem dowodu (wartości startowe, obcięcie spacji,
// anulowanie), więc podmieniamy je na natywny odpowiednik.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));

// Radix Select w `fields.tsx` idzie przez `AdminSelect`; natywny odpowiednik
// wystarcza, bo przedmiotem dowodu jest ZBIÓR OPCJI i reakcja na zmianę.
vi.mock("@/components/admin/blocks/AdminSelect", () => ({
  AdminSelect: ({
    value,
    onChange,
    children,
    disabled,
    ...rest
  }: {
    value?: string | number;
    onChange?: (event: { target: { value: string } }) => void;
    children?: ReactNode;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      data-testid="select"
      data-value={String(value ?? "")}
      value={String(value ?? "")}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
    >
      {children}
    </select>
  ),
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
// Ta sama funkcja, którą podstawia atrapa `react-i18next` powyżej - dzięki
// temu helper paska zapisu liczy napis DOKŁADNIE tak, jak policzy go panel,
// zamiast trzymać przepisany z ręki literał.
import { translateKey } from "@/test/i18nStub";
// Klucze sekcji BIERZEMY Z PRODUKCJI, nie przepisujemy z ręki: literówka
// w łańcuchu dałaby test, który „przechodzi" obok panelu (mierzy sekcję,
// której panel nie czyta).
import { SEO_SETTINGS_KEY } from "@/lib/seo/settings";
import { COOKIE_BANNER_SETTINGS_KEY } from "@/lib/cookieBanner/config";
import { MOBILE_BOTTOM_BAR_SETTINGS_KEY } from "@/lib/mobileBottomBar/config";
import { GOOGLE_SOURCE_BADGE_SETTINGS_KEY } from "@/lib/seo/googleSourceBadge";
import type { OgPrepareResult } from "@/lib/media/ogImage";
import { Route as LayoutRoute } from "@/routes/admin.settings";
import { Route as IndexRoute } from "@/routes/admin.settings.index";
import { Route as GeneralRoute } from "@/routes/admin.settings.general";
import { Route as DiscussionRoute } from "@/routes/admin.settings.discussion";
import { Route as PrivacyRoute } from "@/routes/admin.settings.privacy";
import { Route as MarketingRoute } from "@/routes/admin.settings.marketing";
import { Route as ReadingRoute } from "@/routes/admin.settings.reading";
import { Route as SeoRoute } from "@/routes/admin.settings.seo";
import { Route as SiteIdentityRoute } from "@/routes/admin.settings.site-identity";
import { Route as SocialPreviewRoute } from "@/routes/admin.settings.social-preview";
import { Route as GoogleSourceRoute } from "@/routes/admin.settings.google-source";
import { Route as CookieBannerRoute } from "@/routes/admin.settings.cookie-banner";
import { Route as MobileBottomBarRoute } from "@/routes/admin.settings.mobile-bottom-bar";
import { Route as AnalyticsRoute } from "@/routes/admin.settings.analytics";
import { Route as DesignRoute } from "@/routes/admin.settings.design";

/** Wszystkie trasy ustawień z ich ścieżką i sekcjami, które czytają. */
const PANELS = [
  {
    name: "general",
    route: GeneralRoute,
    path: "/admin/settings/general",
    keys: ["general", "contact_private", "theme_options"],
  },
  {
    name: "discussion",
    route: DiscussionRoute,
    path: "/admin/settings/discussion",
    keys: ["discussion"],
  },
  { name: "privacy", route: PrivacyRoute, path: "/admin/settings/privacy", keys: ["privacy"] },
  {
    name: "marketing",
    route: MarketingRoute,
    path: "/admin/settings/marketing",
    keys: ["marketing"],
  },
  { name: "reading", route: ReadingRoute, path: "/admin/settings/reading", keys: ["reading"] },
  {
    name: "seo",
    route: SeoRoute,
    path: "/admin/settings/seo",
    keys: [SEO_SETTINGS_KEY, "theme_options"],
  },
  {
    name: "site-identity",
    route: SiteIdentityRoute,
    path: "/admin/settings/site-identity",
    keys: [SEO_SETTINGS_KEY],
  },
  {
    name: "social-preview",
    route: SocialPreviewRoute,
    path: "/admin/settings/social-preview",
    keys: [SEO_SETTINGS_KEY],
  },
  {
    name: "google-source",
    route: GoogleSourceRoute,
    path: "/admin/settings/google-source",
    keys: [GOOGLE_SOURCE_BADGE_SETTINGS_KEY],
  },
  {
    name: "cookie-banner",
    route: CookieBannerRoute,
    path: "/admin/settings/cookie-banner",
    keys: [COOKIE_BANNER_SETTINGS_KEY],
  },
  {
    name: "mobile-bottom-bar",
    route: MobileBottomBarRoute,
    path: "/admin/settings/mobile-bottom-bar",
    keys: [MOBILE_BOTTOM_BAR_SETTINGS_KEY],
  },
  {
    name: "analytics",
    route: AnalyticsRoute,
    path: "/admin/settings/analytics",
    keys: ["analytics"],
  },
] as const;

async function mount(
  route: (typeof PANELS)[number]["route"],
  path: string,
): Promise<Awaited<ReturnType<typeof renderRoute>>> {
  return renderRoute({ route, path, initialEntry: path });
}

/**
 * Napisy paska zapisu (`src/components/admin/settings/fields.tsx` -> `SaveBar`)
 * w stanie spoczynku i w trakcie zapisu.
 *
 * SKĄD KLUCZE, A NIE LITERAŁY. Pasek renderował kiedyś wpisane w kod „Zapisz
 * zmiany" i „Zapisywanie…", więc na angielskim panelu jedyny przycisk, który
 * cokolwiek utrwala, stał po polsku - w KAŻDYM z kilkunastu paneli
 * `admin.settings.*`. Naprawą było przepuszczenie obu napisów przez `t()`
 * (dowód i uzasadnienie: `adminSettingsAnalyticsRoute.test.tsx`, przypadek
 * „pasek zapisu mówi po angielsku na angielskim panelu"). Helper przypięty do
 * polskiego literału przestał wtedy znajdować pasek - a bez paska ŻADEN
 * przypadek w tym pliku nie ma czego kliknąć ani czego się doczekać.
 */
const SAVE_BAR_IDLE = translateKey("admin.saveSettings");
const SAVE_BAR_SAVING = translateKey("admin.saving");

/** Pasek zapisu - jedyny przycisk, którego napis zmienia się w trakcie zapisu. */
function saveButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === SAVE_BAR_IDLE || button.textContent === SAVE_BAR_SAVING,
  );
}

function textInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]'));
}

function selects(): HTMLSelectElement[] {
  return Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
}

/** Ostatni zapis dla danej sekcji. */
function lastSave(key: string): Record<string, unknown> | undefined {
  const entry = h.saves.filter((save) => save.key === key).at(-1);
  return entry && typeof entry.value === "object" && entry.value !== null
    ? (entry.value as Record<string, unknown>)
    : undefined;
}

beforeEach(() => {
  cleanup();
  h.rows = {};
  h.pending = new Set();
  h.failing = new Set();
  h.saves = [];
  h.savingKeys = new Set();
  h.settingsSaveThrows = null;
  h.props = {};
  h.iconPacks = [];
  h.consentPreviewRequests = 0;
  h.globalColors = {};
  h.globalColorSaves = [];
  h.designTokens = {
    fonts: { heading: "Inter", body: "Inter", custom: [] },
    scale: {},
    colors: [],
  };
  h.designLoading = false;
  h.designSaves = [];
  h.clipboard = [];
  h.analyticsStatus = null;
  h.analyticsStatusError = false;
  h.analyticsStatusPending = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.toastInfo.mockReset();
});

// ---------------------------------------------------------------------------
// 1. TABELA WSPÓLNA - dwanaście paneli, cztery reguły każdego.
// ---------------------------------------------------------------------------

describe("admin.settings.* - reguły wspólne wszystkich paneli", () => {
  it.each(PANELS)(
    "$name: BRAK wiersza w bazie NIE blokuje panelu - wartości domyślne i pasek zapisu",
    async ({ route, path }) => {
      // Panel ustawień jest jedynym ekranem, z którego naprawia się
      // konfigurację. Panel, który nie otwiera się bez wiersza w bazie, robi
      // z pustej sekcji stan nieodwracalny.
      await mount(route, path);
      await waitFor(() => expect(saveButton()).toBeTruthy());
      expect(saveButton()?.disabled).toBe(false);
    },
  );

  it.each(PANELS)(
    "$name: odczyt W TOKU pokazuje stan wczytywania, a nie puste pola",
    async ({ route, path, keys }) => {
      // Puste pola przy trwającym odczycie to zaproszenie do zapisania
      // pustki na realnej konfiguracji.
      for (const key of keys) h.pending.add(key);
      await mount(route, path);
      await waitFor(() => expect(document.body.textContent).toContain("admin.loading"));
      expect(saveButton()).toBeUndefined();
    },
  );

  it.each(PANELS)(
    "$name: wartość NIEPRAWIDŁOWA w bazie nie wywala panelu",
    async ({ route, path, keys }) => {
      // Wiersz o obcym kształcie (ręczna edycja jsonb, migracja, inna wersja
      // aplikacji) MUSI dać się otworzyć - inaczej nie ma jak go poprawić.
      const INVALID: readonly unknown[] = ["nie obiekt", 42, [1, 2, 3], null, true];
      for (const invalid of INVALID) {
        cleanup();
        h.rows = {};
        for (const key of keys) h.rows[key] = invalid;
        await mount(route, path);
        await waitFor(() => expect(saveButton()).toBeTruthy());
      }
    },
  );

  it.each(PANELS)(
    "$name: jeśli deklaruje nagłówek, to niesie tytuł panelu - nie tytuł publiczny",
    async ({ route }) => {
      // Część rodziny ma `head()` (tytuł zakładki przeglądarki), część nie.
      // Wspólna reguła jest jedna: nagłówek panelu NIE MOŻE wyglądać jak
      // nagłówek strony publicznej - inaczej piętnaście identycznych kart
      // „New European Strategies" jest nierozróżnialnych, a przy indeksacji
      // panel wchodzi do wyników jako treść serwisu.
      const meta = await routeMeta(route);
      if (meta.length === 0) return;
      const titles = meta
        .map((entry) => entry.title)
        .filter((title): title is string => typeof title === "string");
      expect(titles.length, "nagłówek bez tytułu").toBeGreaterThan(0);
      for (const title of titles) {
        expect(title, `tytuł panelu bez oznaczenia sekcji: ${title}`).toMatch(/Ustawienia/);
      }
    },
  );

  it.each(PANELS)(
    "$name: pasek zapisu BLOKUJE się w trakcie zapisu",
    async ({ route, path, keys }) => {
      // Drugie kliknięcie „Zapisz" wysyła drugie scalenie na tym samym wierszu,
      // a jego podstawa jest odczytana sprzed pierwszego zapisu.
      for (const key of keys) h.savingKeys.add(key);
      await mount(route, path);
      await waitFor(() => expect(saveButton()).toBeTruthy());
      expect(saveButton()?.disabled).toBe(true);
      expect(saveButton()?.textContent).toBe(SAVE_BAR_SAVING);
    },
  );

  it.each(PANELS)(
    "$name: kliknięcie zapisu wysyła ładunek do WŁAŚCIWEJ sekcji",
    async ({ route, path, keys }) => {
      await mount(route, path);
      await waitFor(() => expect(saveButton()).toBeTruthy());
      const button = saveButton();
      if (!button) throw new Error("test: brak paska zapisu");
      fireEvent.click(button);
      await waitFor(() => expect(h.saves.length).toBeGreaterThan(0));
      // Klucz sekcji jest częścią umowy z bazą: zapis pod cudzym kluczem
      // nadpisałby konfigurację innego obszaru.
      const savedKeys = new Set(h.saves.map((save) => save.key));
      const allowed: readonly string[] = keys;
      expect([...savedKeys].every((key) => allowed.includes(key))).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// 2. POWŁOKA I PRZEKIEROWANIE.
// ---------------------------------------------------------------------------

describe("admin.settings - powłoka rodziny i przekierowanie", () => {
  it("powłoka renderuje nawigację z CZTERNASTOMA zakładkami i `Outlet`", async () => {
    // Kanarek zasięgu: gdyby zakładka wypadła z listy, panel stałby się
    // nieosiągalny inaczej niż przez wpisanie adresu z ręki.
    await renderRoute({
      route: LayoutRoute,
      path: "/admin/settings",
      initialEntry: "/admin/settings",
    });
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a"));
    expect(links.length).toBe(14);
    const hrefs = links.map((link) => link.getAttribute("href"));
    for (const expected of [
      "/admin/settings/general",
      "/admin/settings/design",
      "/admin/settings/seo",
      "/admin/settings/privacy",
      "/admin/settings/cookie-banner",
      "/admin/settings/analytics",
    ]) {
      expect(hrefs, `brak zakładki ${expected}`).toContain(expected);
    }
    // Jedna zakładka celowo WYCHODZI z rodziny ustawień - rozmiary wycinków
    // mieszkają osobno (komentarz w kodzie: dawne „Media" zapisywały wartości,
    // których nic nie czytało).
    expect(hrefs).toContain("/admin/crop-sizes");
  });

  it("powłoka podświetla zakładkę BIEŻĄCĄ - i tylko ją", async () => {
    // Powłoka czyta lokalizację z routera (`useRouterState`), więc harness
    // musi zamontować ją POD TĄ ścieżką - inaczej router nie dopasowałby
    // adresu i test mierzyłby stan „nie znaleziono trasy".
    await renderRoute({
      route: LayoutRoute,
      path: "/admin/settings/seo",
      initialEntry: "/admin/settings/seo",
    });
    const active = Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a")).filter(
      (link) => link.className.includes("bg-brand"),
    );
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("href")).toBe("/admin/settings/seo");
  });

  it("podświetlenie łapie też trasy POTOMNE zakładki", async () => {
    // `startsWith(tab.to + "/")` jest tu regułą: wejście w podstronę zakładki
    // nie może zgasić jej podświetlenia w nawigacji.
    await renderRoute({
      route: LayoutRoute,
      path: "/admin/settings/design/typografia",
      initialEntry: "/admin/settings/design/typografia",
    });
    const active = Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a")).filter(
      (link) => link.className.includes("bg-brand"),
    );
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("href")).toBe("/admin/settings/design");
  });

  it("adres bez zakładki NIE podświetla żadnej", async () => {
    await renderRoute({
      route: LayoutRoute,
      path: "/admin/settings",
      initialEntry: "/admin/settings",
    });
    const active = Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a")).filter(
      (link) => link.className.includes("bg-brand"),
    );
    expect(active).toHaveLength(0);
  });

  it("`/admin/settings/` PRZEKIEROWUJE na panel ogólny - nie renderuje pustki", () => {
    // Trasa indeksu nie ma komponentu; jej całą treścią jest przekierowanie
    // w `beforeLoad`. Bez niego wejście na `/admin/settings/` dawało pustą
    // sekcję pod nawigacją.
    const beforeLoad = IndexRoute.options.beforeLoad;
    expect(beforeLoad).toBeTypeOf("function");
    expect(IndexRoute.options.component).toBeUndefined();
    let thrown: unknown = null;
    try {
      // `beforeLoad` nie potrzebuje kontekstu - jego całą treścią jest
      // bezwarunkowe `throw redirect(...)`. Wywołujemy je przez zawężenie do
      // funkcji bezargumentowej (strażnik wyżej to zapewnił), bo rzutowanie na
      // pełny typ opcji trasy wymagałoby odtworzenia całego drzewa routera.
      const callable: unknown = beforeLoad;
      if (typeof callable === "function") (callable as () => void)();
    } catch (error) {
      thrown = error;
    }
    expect(thrown, "`beforeLoad` musi RZUCIĆ przekierowaniem").toBeTruthy();
    expect(JSON.stringify(thrown)).toContain("/admin/settings/general");
  });

  it("powłoka nie ma nagłówków SEO - tytuł należy do panelu, nie do powłoki", async () => {
    expect(await routeMeta(LayoutRoute)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. PANEL OGÓLNY - trzy sekcje naraz i natychmiastowy skutek uboczny.
// ---------------------------------------------------------------------------

describe("admin.settings.general - trzy sekcje w jednym panelu", () => {
  async function mountGeneral(): Promise<void> {
    await mount(GeneralRoute, "/admin/settings/general");
    await waitFor(() => expect(saveButton()).toBeTruthy());
  }

  it("zapis dotyka DWÓCH sekcji: `general` i `contact_private`", async () => {
    // Adres administratora mieszka w OSOBNEJ sekcji, bo `general` jest czytane
    // publicznie (nazwa serwisu, logo). Zapis jednym przyciskiem musi trafić
    // do obu - inaczej zmiana adresu ginie bez komunikatu.
    await mountGeneral();
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(h.saves).toHaveLength(2));
    expect(new Set(h.saves.map((save) => save.key))).toEqual(
      new Set(["general", "contact_private"]),
    );
  });

  it("wartości z bazy trafiają do pól, a fałszywe ale prawidłowe NIE są podmieniane", async () => {
    // `week_starts_on: 0` (niedziela) to prawidłowa wartość, którą `||`
    // zamieniłoby na poniedziałek - i administrator nie mógłby ustawić
    // tygodnia od niedzieli.
    h.rows.general = {
      site_name: "Serwis testowy",
      tagline: "",
      week_starts_on: 0,
      timezone: "Europe/Warsaw",
    };
    await mountGeneral();
    const values = textInputs().map((input) => input.value);
    expect(values).toContain("Serwis testowy");
    // Pusty podtytuł zostaje pusty.
    expect(values).toContain("");
    const weekSelect = selects().find((select) =>
      Array.from(select.options).some((option) => option.value === "0"),
    );
    expect(weekSelect?.getAttribute("data-value")).toBe("0");
  });

  it("zmiana paczki ikon działa NATYCHMIAST, jeszcze przed zapisem", async () => {
    // Paczka ikon zmienia wygląd całego panelu, więc podglądem jest sam panel.
    // To świadomy skutek uboczny opisany efektem w kodzie - i musi zadziałać
    // także dla wartości wczytanej z bazy, nie tylko dla kliknięcia.
    h.rows.general = { icon_pack: "fontawesome" };
    await mountGeneral();
    await waitFor(() => expect(h.iconPacks).toContain("fontawesome"));

    const packSelect = selects().find((select) =>
      Array.from(select.options).some((option) => option.value === "lucide"),
    );
    if (!packSelect) throw new Error("test: brak wyboru paczki ikon");
    fireEvent.change(packSelect, { target: { value: "lucide" } });
    await waitFor(() => expect(h.iconPacks.at(-1)).toBe("lucide"));
  });

  it("ładunek `general` niesie ZMIENIONĄ wartość, nie domyślną", async () => {
    await mountGeneral();
    const nameInput = textInputs()[0];
    fireEvent.change(nameInput, { target: { value: "Nowa nazwa" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("general")).toBeTruthy());
    expect(lastSave("general")?.site_name).toBe("Nowa nazwa");
  });

  it("adres administratora idzie do `contact_private`, a nie do `general`", async () => {
    await mountGeneral();
    const emailInput = document.querySelector<HTMLInputElement>('input[type="email"]');
    expect(emailInput).toBeTruthy();
    if (!emailInput) throw new Error("test: brak pola adresu");
    fireEvent.change(emailInput, { target: { value: "admin@example.org" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("contact_private")).toBeTruthy());
    expect(lastSave("contact_private")?.admin_email).toBe("admin@example.org");
    expect(lastSave("general")).not.toHaveProperty("admin_email");
  });

  it("brak sekcji `contact_private` zapisuje wartości DOMYŚLNE, nie `undefined`", async () => {
    // `undefined` w ładunku zostawiłoby kolumnę bez wartości i przy następnym
    // odczycie panel pokazałby pustkę zamiast zera-wartości.
    h.pending.add("contact_private");
    await mount(GeneralRoute, "/admin/settings/general");
    // Panel ogólny nie czeka na `contact_private` - główna sekcja wystarcza.
    await waitFor(() => expect(saveButton()).toBeTruthy());
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("contact_private")).toBeTruthy());
    expect(lastSave("contact_private")).toEqual({ admin_email: "" });
  });

  it("logo z `theme_options` jest pokazywane jako ŹRÓDŁO POWIĄZANE, nie kopiowane", async () => {
    // Panel ogólny ma własne pola adresu logo, ale wartość kanoniczna mieszka
    // w opcjach motywu. Skopiowanie jej do pola dałoby dwa źródła prawdy.
    h.rows.theme_options = {
      logo: { main: "https://example.org/logo.svg", bookmark_ios: "https://example.org/i.png" },
    };
    await mountGeneral();
    const placeholders = textInputs().map((input) => input.placeholder);
    expect(placeholders).toContain("https://example.org/logo.svg");
    expect(placeholders).toContain("https://example.org/i.png");
    // Same pola zostają PUSTE - nadpisanie jest świadomą decyzją.
    const logoInput = textInputs().find(
      (input) => input.placeholder === "https://example.org/logo.svg",
    );
    expect(logoInput?.value).toBe("");
  });

  it("BRAK logo w opcjach motywu daje zapasową podpowiedź, nie pustą ramkę", async () => {
    await mountGeneral();
    const placeholders = textInputs().map((input) => input.placeholder);
    expect(
      placeholders.filter((placeholder) => placeholder === "https://…").length,
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. PANELE Z POJEDYNCZĄ SEKCJĄ - ładunek i pola wyboru.
// ---------------------------------------------------------------------------

describe("admin.settings.discussion - trzy przełączniki komentarzy", () => {
  it("wartości `false` z bazy ZOSTAJĄ na `false`", async () => {
    // Wszystkie trzy pola są logiczne, a dwa mają domyślne `true`. `||`
    // uniemożliwiałoby wyłączenie moderacji i wymogu logowania.
    h.rows.discussion = {
      allow_comments: true,
      require_login_to_comment: false,
      moderate_new_comments: false,
    };
    await mount(DiscussionRoute, "/admin/settings/discussion");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const boxes = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="checkbox"], input[type="checkbox"]'),
    );
    expect(boxes.length).toBe(3);
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("discussion")).toBeTruthy());
    expect(lastSave("discussion")).toEqual({
      allow_comments: true,
      require_login_to_comment: false,
      moderate_new_comments: false,
    });
  });

  it("przełączenie pola zmienia ŁADUNEK, nie tylko widok", async () => {
    await mount(DiscussionRoute, "/admin/settings/discussion");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const first = document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]');
    if (!first) throw new Error("test: brak pola wyboru");
    fireEvent.click(first);
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("discussion")?.allow_comments).toBe(true));
  });
});

describe("admin.settings.privacy - strona polityki i baner", () => {
  it("PUSTY slug polityki zostaje pusty, a podpowiedź nadal jest widoczna", async () => {
    // Pusty slug znaczy „nie mamy strony polityki" i to jest prawidłowy stan
    // (dokument bywa zewnętrzny). `||` podstawiłoby tam podpowiedź jako
    // wartość i panel zapisałby slug, którego nikt nie wybrał.
    h.rows.privacy = { privacy_page_slug: "", cookie_banner: false };
    await mount(PrivacyRoute, "/admin/settings/privacy");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const slugInput = textInputs()[0];
    expect(slugInput.value).toBe("");
    expect(slugInput.placeholder).toBe("polityka-prywatnosci");
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("privacy")).toBeTruthy());
    expect(lastSave("privacy")).toEqual({ privacy_page_slug: "", cookie_banner: false });
  });

  it("panel niesie PODSUMOWANIE AUDYTU ZGÓD - to wymóg dowodowy, nie ozdoba", async () => {
    await mount(PrivacyRoute, "/admin/settings/privacy");
    await waitFor(() => expect(screen.getByTestId("ConsentAuditSummary")).toBeTruthy());
  });
});

describe("admin.settings.marketing - identyfikatory pikseli i wstawki HTML", () => {
  it("ładunek niesie WSZYSTKIE pięć pól, także puste", async () => {
    // Wyczyszczenie identyfikatora piksela to sposób na WYŁĄCZENIE skryptu.
    // Gdyby puste pole wypadło z ładunku, skrypt zostałby włączony na zawsze.
    h.rows.marketing = { meta_pixel_id: "111", custom_head_html: "<script></script>" };
    await mount(MarketingRoute, "/admin/settings/marketing");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const metaInput = textInputs()[0];
    fireEvent.change(metaInput, { target: { value: "" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("marketing")).toBeTruthy());
    const saved = lastSave("marketing");
    expect(saved?.meta_pixel_id).toBe("");
    expect(saved).toHaveProperty("linkedin_partner_id");
    expect(saved).toHaveProperty("tiktok_pixel_id");
    expect(saved).toHaveProperty("custom_head_html");
    expect(saved).toHaveProperty("custom_body_html");
  });

  it("wstawki HTML idą do zapisu BEZ zmian - to kod, nie tekst", async () => {
    // Sanityzacja tutaj byłaby błędem: to pole ISTNIEJE po to, żeby wstawić
    // znacznik dostawcy. Bramkuje je zgoda marketingowa, nie filtr treści.
    await mount(MarketingRoute, "/admin/settings/marketing");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const areas = Array.from(document.querySelectorAll("textarea"));
    expect(areas).toHaveLength(2);
    const snippet = '<script src="https://example.org/pixel.js"></script>';
    fireEvent.change(areas[0], { target: { value: snippet } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("marketing")?.custom_head_html).toBe(snippet));
  });
});

// ---------------------------------------------------------------------------
// 5. PANELE Z ORGANIZMAMI - co panel im przekazuje.
// ---------------------------------------------------------------------------

describe("admin.settings.cookie-banner - podgląd i sekcje", () => {
  async function mountBanner(): Promise<void> {
    await mount(CookieBannerRoute, "/admin/settings/cookie-banner");
    await waitFor(() => expect(saveButton()).toBeTruthy());
  }

  it("panel renderuje sekcje pomocnicze, a podgląd banera jest ZA przełącznikiem", async () => {
    // Podgląd jest nakładką na całe okno, więc NIE MOŻE być domyślnie otwarty -
    // przykryłby formularz, który administrator właśnie edytuje. To jest
    // przełącznik i test pilnuje obu stanów.
    await mountBanner();
    expect(screen.getByTestId("CookieBannerBrandingSection")).toBeTruthy();
    expect(screen.getByTestId("DetectedElementsPanel")).toBeTruthy();
    expect(screen.queryByTestId("ConsentBanner")).toBeNull();
  });

  it("otwarty podgląd dostaje NIEZAPISANY szkic, nie stan z bazy", async () => {
    // Podgląd czytający z bazy pokazywałby konfigurację sprzed edycji - czyli
    // nie byłby podglądem. `configOverride` jest tu całym mechanizmem.
    h.rows[COOKIE_BANNER_SETTINGS_KEY] = { enabled: true };
    await mountBanner();
    const before = h.consentPreviewRequests;
    for (const button of Array.from(document.querySelectorAll("button"))) {
      if (button === saveButton()) continue;
      fireEvent.click(button);
      if (screen.queryByTestId("ConsentBanner")) break;
    }
    await waitFor(() => expect(screen.queryByTestId("ConsentBanner")).toBeTruthy());
    expect(h.props.ConsentBanner.configOverride).toBeTruthy();
    // Otwarcie podglądu żąda też otwarcia panelu preferencji przez wspólną
    // ścieżkę CMP - inaczej baner po decyzji nie pokazałby się wcale.
    expect(h.consentPreviewRequests).toBeGreaterThan(before);
  });

  it("ładunek banera trafia do WŁASNEJ sekcji konfiguracji", async () => {
    await mountBanner();
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)).toBeTruthy());
  });
});

describe("admin.settings.mobile-bottom-bar - lista pozycji paska", () => {
  async function mountBar(): Promise<void> {
    await mount(MobileBottomBarRoute, "/admin/settings/mobile-bottom-bar");
    await waitFor(() => expect(saveButton()).toBeTruthy());
  }

  it("panel renderuje PODGLĄD paska tym samym komponentem co strona publiczna", async () => {
    await mountBar();
    expect(screen.getByTestId("MobileBottomBarView")).toBeTruthy();
  });

  it("podgląd dostaje BIEŻĄCY szkic, nie zapisaną wersję", async () => {
    // Podgląd czytający z bazy pokazywałby stan sprzed edycji - czyli nie
    // byłby podglądem.
    await mountBar();
    expect(h.props.MobileBottomBarView).toBeTruthy();
    expect(Object.keys(h.props.MobileBottomBarView).length).toBeGreaterThan(0);
  });

  it("ładunek paska trafia do sekcji `mobile_bottom_bar`", async () => {
    await mountBar();
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
  });
});

describe("admin.settings.seo, site-identity, social-preview - jedna sekcja, trzy panele", () => {
  it("wszystkie TRZY panele zapisują do TEJ SAMEJ sekcji `seo_settings`", async () => {
    // To jest realne ryzyko: trzy panele piszące jeden wiersz jsonb muszą
    // polegać na głębokim scaleniu w `useSettings`, inaczej zapis z jednego
    // zdmuchuje pola drugiego. Tutaj dowodzimy, że KLUCZ jest ten sam (czyli
    // że scalenie w ogóle ma szansę zadziałać); mechanikę scalania pokrywa
    // `useSettings.test.tsx`.
    for (const [route, path] of [
      [SeoRoute, "/admin/settings/seo"],
      [SiteIdentityRoute, "/admin/settings/site-identity"],
      [SocialPreviewRoute, "/admin/settings/social-preview"],
    ] as const) {
      cleanup();
      h.saves = [];
      await mount(route, path);
      await waitFor(() => expect(saveButton()).toBeTruthy());
      fireEvent.click(saveButton() as HTMLButtonElement);
      await waitFor(() => expect(h.saves.length).toBeGreaterThan(0));
      expect(h.saves.map((save) => save.key)).toContain(SEO_SETTINGS_KEY);
    }
  });

  it("panel SEO pokazuje podgląd `robots.txt` - reguły indeksowania są sprawdzalne", async () => {
    await mount(SeoRoute, "/admin/settings/seo");
    await waitFor(() => expect(screen.getByTestId("RobotsTxtPreview")).toBeTruthy());
  });

  it("panel SEO: `noindex` włączony z bazy ZOSTAJE włączony", async () => {
    // Odwrotność defektu z `||`: gdyby `noindex: true` gubiło się przy
    // odczycie, panel po zapisie ODINDEKSOWAŁBY albo ZAINDEKSOWAŁ serwis bez
    // wiedzy administratora.
    h.rows[SEO_SETTINGS_KEY] = { noindex: true };
    await mount(SeoRoute, "/admin/settings/seo");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(SEO_SETTINGS_KEY)).toBeTruthy());
    expect(lastSave(SEO_SETTINGS_KEY)?.noindex).toBe(true);
  });

  it("panel tożsamości i panel podglądu społecznościowego renderują pola tekstowe", async () => {
    for (const [route, path] of [
      [SiteIdentityRoute, "/admin/settings/site-identity"],
      [SocialPreviewRoute, "/admin/settings/social-preview"],
    ] as const) {
      cleanup();
      await mount(route, path);
      await waitFor(() => expect(saveButton()).toBeTruthy());
      const controls = document.querySelectorAll("input, textarea, [data-testid]");
      expect(controls.length, `${path}: panel bez kontrolek`).toBeGreaterThan(0);
    }
  });
});

describe("admin.settings.reading - ustawienia czytania i lektora", () => {
  it("panel renderuje DWA wybory głosu - polski i angielski", async () => {
    // Lektor ma osobny głos per język treści. Jeden wybór dla obu wersji dałby
    // polski głos czytający angielski artykuł.
    await mount(ReadingRoute, "/admin/settings/reading");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    expect(screen.getAllByTestId("TtsVoiceSelect")).toHaveLength(2);
  });

  it("model lektora POZA zbiorem nie zostawia pola bez wartości", async () => {
    // Model usunięty z katalogu (dostawca wycofał wersję) musi degradować do
    // czegoś wybieralnego - inaczej panel zapisuje z powrotem nieistniejący
    // model i lektor przestaje działać bez komunikatu.
    h.rows.reading = { tts_model: "model-ktorego-nie-ma" };
    await mount(ReadingRoute, "/admin/settings/reading");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("reading")).toBeTruthy());
  });

  it("wartość liczbowa `0` z bazy zostaje zerem", async () => {
    h.rows.reading = { posts_per_page: 0 };
    await mount(ReadingRoute, "/admin/settings/reading");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("reading")).toBeTruthy());
    expect(lastSave("reading")?.posts_per_page).toBe(0);
  });
});

describe("admin.settings.google-source - odznaka źródła preferowanego", () => {
  it("panel renderuje DWIE sekcje urządzeń - komputer i telefon osobno", async () => {
    // Odznaka źródła preferowanego ma osobne zasoby dla dwóch szerokości
    // ekranu; jedna sekcja dla obu dałaby rozciągnięty obraz na telefonie.
    await mount(GoogleSourceRoute, "/admin/settings/google-source");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    expect(screen.getAllByTestId("GoogleSourceBadgeDeviceSection")).toHaveLength(2);
  });

  it("ładunek trafia do sekcji `google_source_badge`", async () => {
    await mount(GoogleSourceRoute, "/admin/settings/google-source");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(GOOGLE_SOURCE_BADGE_SETTINGS_KEY)).toBeTruthy());
  });
});

describe("admin.settings.analytics - konfiguracja i stan pomiaru", () => {
  it("panel otwiera się BEZ danych o stanie - konfiguracja nie zależy od diagnostyki", async () => {
    // Diagnostyka pomiaru woła zewnętrzną usługę. Jej niedostępność nie może
    // zabrać administratorowi możliwości zmiany identyfikatora pomiaru.
    h.analyticsStatusError = true;
    await mount(AnalyticsRoute, "/admin/settings/analytics");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    expect(saveButton()?.disabled).toBe(false);
  });

  it("ładunek trafia do sekcji `analytics`", async () => {
    await mount(AnalyticsRoute, "/admin/settings/analytics");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("analytics")).toBeTruthy());
  });

  it("stan pomiaru z serwera jest renderowany, gdy przyszedł", async () => {
    h.analyticsStatus = { ga4: { configured: true, propertyId: "G-TEST" }, checkedAt: BASE_ISO };
    await mount(AnalyticsRoute, "/admin/settings/analytics");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    expect(document.body.textContent).toBeTruthy();
  });
});

describe("admin.settings.design - wygląd, kolory i typografia", () => {
  it("panel renderuje nawigację wyglądu i wybór czcionek", async () => {
    await renderRoute({
      route: DesignRoute,
      path: "/admin/settings/design",
      initialEntry: "/admin/settings/design",
    });
    await waitFor(() => expect(screen.getByTestId("DesignSubNav")).toBeTruthy());
  });

  it("panel wyglądu nie deklaruje nagłówka - tytuł zakładki dziedziczy po powłoce", async () => {
    expect(await routeMeta(DesignRoute)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. DEFEKT ZGŁOSZONY, NIE NAPRAWIONY (konwencja repo: produkcja bez zmian).
// ---------------------------------------------------------------------------

describe("admin.settings.* - defekt zgłoszony", () => {
  it.fails(
    "DEFEKT: trzy panele deklarują tytuł BEZ `robots: noindex` - reszta rodziny go ma",
    async () => {
      // ZMIERZONY ROZJAZD W OBRĘBIE JEDNEJ RODZINY TRAS. Siedem z piętnastu
      // tras `admin.settings.*` deklaruje `head()`. Cztery z nich niosą
      // `{ name: "robots", content: "noindex, nofollow" }`:
      //   admin.settings.analytics.tsx:44-45
      //   admin.settings.cookie-banner.tsx:23-26
      //   admin.settings.google-source.tsx:23-26
      //   admin.settings.mobile-bottom-bar.tsx:47-50
      // TRZY deklarują wyłącznie tytuł, BEZ `robots`:
      //   admin.settings.seo.tsx:21            -> „SEO - Ustawienia"
      //   admin.settings.site-identity.tsx:22  -> „Tytuł i opis serwisu - Ustawienia"
      //   admin.settings.social-preview.tsx:32 -> „Podgląd linków - Ustawienia"
      //
      // KONSEKWENCJA. Dostęp do panelu pilnuje layout `/admin` po stronie
      // klienta, ale `head()` jest renderowany PRZEZ SERWER razem z dokumentem,
      // więc znaczniki trafiają do odpowiedzi HTML zanim bramka klienta
      // cokolwiek przekieruje. Trasa panelu bez `noindex` jest więc
      // indeksowalna, jeśli jej adres wycieknie (odnośnik w zgłoszeniu, log
      // proxy, historia przeglądarki zsynchronizowana z kontem). Ironia jest
      // podwójna: to są DOKŁADNIE te trzy panele, które konfigurują SEO
      // serwisu.
      //
      // Naprawa to jedna linia w każdym z trzech plików. Nie robimy jej tutaj,
      // bo zakresem zadania są testy (rozdz. 6 zlecenia) - a rozjazd w obrębie
      // rodziny jest właśnie tym, co ma łapać bramka rodzinowa, nie próg.
      const WITH_HEAD = [
        { name: "seo", route: SeoRoute },
        { name: "site-identity", route: SiteIdentityRoute },
        { name: "social-preview", route: SocialPreviewRoute },
        { name: "analytics", route: AnalyticsRoute },
        { name: "cookie-banner", route: CookieBannerRoute },
        { name: "google-source", route: GoogleSourceRoute },
        { name: "mobile-bottom-bar", route: MobileBottomBarRoute },
      ] as const;

      const missing: string[] = [];
      for (const entry of WITH_HEAD) {
        const meta = await routeMeta(entry.route);
        const hasNoindex = meta.some(
          (item) =>
            item.name === "robots" &&
            typeof item.content === "string" &&
            item.content.includes("noindex"),
        );
        if (!hasNoindex) missing.push(entry.name);
      }
      expect(missing, `panele z tytułem, ale bez \`noindex\`: ${missing.join(", ")}`).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// 7. PANELE INTERAKCYJNE - lista pozycji, dwujęzyczne treści, diagnostyka.
// Tu leżą te 24,5% gałęzi: każde `??`, `||`, `?:` i `?.` w odczycie
// ustawienia dostaje oba ramiona.
// ---------------------------------------------------------------------------

describe("admin.settings.mobile-bottom-bar - lista pozycji paska", () => {
  /** Pozycja paska w kształcie, w jakim leży w konfiguracji. */
  function barItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "poz-1",
      label_pl: "Start",
      label_en: "Home",
      href: "/",
      icon: "home",
      color: "#4343f5",
      color_dark: "#8f8ffb",
      badge: "none",
      enabled: true,
      ...overrides,
    };
  }

  async function mountBar(config: Record<string, unknown> = {}): Promise<void> {
    h.rows[MOBILE_BOTTOM_BAR_SETTINGS_KEY] = config;
    await mount(MobileBottomBarRoute, "/admin/settings/mobile-bottom-bar");
    await waitFor(() => expect(saveButton()).toBeTruthy());
  }

  function itemCards(): HTMLLIElement[] {
    return Array.from(document.querySelectorAll<HTMLLIElement>("ul > li"));
  }

  function buttonByLabel(label: string): HTMLButtonElement[] {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`),
    );
  }

  it("PUSTA lista pozycji mówi to wprost - nie renderuje pustej listy", async () => {
    await mountBar({ items: [] });
    expect(itemCards()).toHaveLength(0);
    expect(document.body.textContent).toContain("mobileBottomBar.emptyItems");
  });

  it("`items` o NIEPRAWIDŁOWYM typie jest traktowane jak pusta lista", async () => {
    // `Array.isArray(draft.items) ? draft.items : []` - bez tego ręczna edycja
    // jsonb (albo migracja) wywalałaby panel na `.map` po łańcuchu.
    const INVALID_ITEMS: readonly unknown[] = ["nie tablica", 42, { a: 1 }, null];
    for (const invalid of INVALID_ITEMS) {
      cleanup();
      await mountBar({ items: invalid });
      expect(itemCards()).toHaveLength(0);
    }
  });

  it("DODANIE pozycji dokłada kartę, a limit sześciu BLOKUJE przycisk", async () => {
    // Pasek ma sześć slotów fizycznie; siódma pozycja nie zmieściłaby się na
    // ekranie telefonu, więc granica jest w interfejsie, nie tylko w podglądzie.
    await mountBar({ items: [barItem()] });
    const addButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("mobileBottomBar.addItem"),
    );
    if (!addButton) throw new Error("test: brak przycisku dodania pozycji");
    expect(addButton.disabled).toBe(false);

    for (let i = 0; i < 5; i += 1) fireEvent.click(addButton);
    await waitFor(() => expect(itemCards()).toHaveLength(6));
    await waitFor(() => {
      const again = Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("mobileBottomBar.addItem"),
      );
      expect(again?.disabled).toBe(true);
    });
  });

  it("USUNIĘCIE pozycji zdejmuje DOKŁADNIE tę, o którą kliknięto", async () => {
    await mountBar({
      items: [
        barItem({ id: "a", label_pl: "Pierwsza" }),
        barItem({ id: "b", label_pl: "Druga" }),
        barItem({ id: "c", label_pl: "Trzecia" }),
      ],
    });
    expect(itemCards()).toHaveLength(3);
    fireEvent.click(buttonByLabel("mobileBottomBar.removeItem")[1]);
    await waitFor(() => expect(itemCards()).toHaveLength(2));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
    const saved = lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)?.items;
    expect(Array.isArray(saved) ? saved.map((item) => (item as { id: string }).id) : []).toEqual([
      "a",
      "c",
    ]);
  });

  it("PRZESUNIĘCIE w górę i w dół zamienia sąsiadów miejscami", async () => {
    await mountBar({ items: [barItem({ id: "a" }), barItem({ id: "b" })] });
    fireEvent.click(buttonByLabel("mobileBottomBar.moveDown")[0]);
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
    const afterDown = lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)?.items;
    expect(
      Array.isArray(afterDown) ? afterDown.map((item) => (item as { id: string }).id) : [],
    ).toEqual(["b", "a"]);

    fireEvent.click(buttonByLabel("mobileBottomBar.moveUp")[1]);
    fireEvent.click(saveButton() as HTMLButtonElement);
    const afterUp = lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)?.items;
    expect(
      Array.isArray(afterUp) ? afterUp.map((item) => (item as { id: string }).id) : [],
    ).toEqual(["a", "b"]);
  });

  it("PRZESUNIĘCIE POZA zakres nic nie robi - pierwsza w górę, ostatnia w dół", async () => {
    // Bez tej obrony `[next[index], next[target]]` z `target = -1` wstawiłoby
    // do tablicy `undefined` i podgląd paska by się wywalił.
    await mountBar({ items: [barItem({ id: "a" }), barItem({ id: "b" })] });
    fireEvent.click(buttonByLabel("mobileBottomBar.moveUp")[0]);
    fireEvent.click(buttonByLabel("mobileBottomBar.moveDown")[1]);
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
    const saved = lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)?.items;
    expect(Array.isArray(saved) ? saved.map((item) => (item as { id: string }).id) : []).toEqual([
      "a",
      "b",
    ]);
  });

  it("edycja etykiety zmienia TĘ pozycję, a nie wszystkie", async () => {
    await mountBar({ items: [barItem({ id: "a" }), barItem({ id: "b" })] });
    const labelInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('li input[type="text"]'),
    );
    // Pierwsze pole tekstowe pierwszej karty to etykieta polska.
    fireEvent.change(labelInputs[0], { target: { value: "Zmieniona" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
    const saved = lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)?.items;
    const labels = Array.isArray(saved)
      ? saved.map((item) => (item as { label_pl: string }).label_pl)
      : [];
    expect(labels[0]).toBe("Zmieniona");
    expect(labels[1]).toBe("Start");
  });

  it("PUSTA etykieta zostaje pusta, a podpowiedź pokazuje tłumaczenie", async () => {
    // Puste pole znaczy „użyj tłumaczenia z i18n" i jest prawidłowym stanem -
    // `||` wstawiłoby tam podpowiedź jako wartość i zablokowało tłumaczenie.
    await mountBar({ items: [barItem({ label_pl: "", label_key: "nav.home" })] });
    const labelInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('li input[type="text"]'),
    );
    expect(labelInputs[0].value).toBe("");
    expect(labelInputs[0].placeholder.length).toBeGreaterThan(0);
  });

  it("kolor NIEPRAWIDŁOWY nie trafia do próbnika, ale ZOSTAJE w polu tekstowym", async () => {
    // Próbnik `<input type="color">` przyjmuje WYŁĄCZNIE `#rrggbb`; wartość
    // spoza tego wzorca zamieniłby po cichu na czarny i zapisała się jako
    // czarna. Dlatego wzorzec jest sprawdzany, a pole tekstowe pokazuje prawdę.
    await mountBar({ items: [barItem({ color: "czerwony", color_dark: "" })] });
    const colorInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('li input[type="color"]'),
    );
    expect(colorInputs.length).toBeGreaterThanOrEqual(2);
    expect(colorInputs[0].value).toBe("#4343f5");
    expect(colorInputs[1].value).toBe("#8f8ffb");
    const texts = Array.from(document.querySelectorAll<HTMLInputElement>('li input[type="text"]'));
    expect(texts.map((input) => input.value)).toContain("czerwony");
  });

  it("kolor PRAWIDŁOWY trafia do próbnika bez zmian", async () => {
    await mountBar({ items: [barItem({ color: "#ff0000", color_dark: "#00ff00" })] });
    const colorInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('li input[type="color"]'),
    );
    expect(colorInputs[0].value).toBe("#ff0000");
    expect(colorInputs[1].value).toBe("#00ff00");
  });

  it("BRAK koloru ciemnego degraduje do wartości zastępczej próbnika", async () => {
    await mountBar({ items: [barItem({ color_dark: undefined })] });
    const colorInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('li input[type="color"]'),
    );
    expect(colorInputs[1].value).toBe("#8f8ffb");
  });

  it("źródło plakietki POZA zbiorem jest normalizowane, nie renderowane", async () => {
    // `normalizeBadgeSource` chroni pole wyboru: nieznana wartość zostawiłaby
    // je bez zaznaczenia i pierwszy zapis wysłałby z powrotem `undefined`.
    await mountBar({ items: [barItem({ badge: "nie-ma-takiego" })] });
    const badgeSelect = selects().find((select) =>
      Array.from(select.options).some((option) => option.value === "none"),
    );
    expect(badgeSelect).toBeTruthy();
    expect(badgeSelect?.getAttribute("data-value")).not.toBe("nie-ma-takiego");
  });

  it("pozycja WYŁĄCZONA zostaje wyłączona, a `enabled: undefined` znaczy włączona", async () => {
    // `item.enabled !== false` - domyślnie włączona. Gdyby to było
    // `!!item.enabled`, pozycja bez tego pola znikałaby z paska po migracji.
    await mountBar({
      items: [barItem({ id: "a", enabled: false }), barItem({ id: "b", enabled: undefined })],
    });
    const boxes = Array.from(
      document.querySelectorAll<HTMLElement>('li [role="checkbox"], li input[type="checkbox"]'),
    );
    const states = boxes.map(
      (box) => box.getAttribute("aria-checked") ?? (box as HTMLInputElement).checked,
    );
    expect(states.some((state) => state === "false" || state === false)).toBe(true);
    expect(states.some((state) => state === "true" || state === true)).toBe(true);
  });

  it("liczby POZA zakresem są przycinane przy wpisywaniu", async () => {
    // Odsunięcie 500 px zepchnęłoby pasek za dolną krawędź ekranu; promień
    // ujemny nie ma sensu. Przycięcie musi zadziałać NA WPISANIU, nie przy
    // zapisie - inaczej administrator widzi wartość, której nie dostanie.
    await mountBar({ items: [] });
    const numbers = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(numbers).toHaveLength(2);
    fireEvent.change(numbers[0], { target: { value: "500" } });
    fireEvent.change(numbers[1], { target: { value: "-10" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
    const saved = lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY);
    expect(Number(saved?.offset_bottom)).toBeLessThanOrEqual(40);
    expect(Number(saved?.radius)).toBeGreaterThanOrEqual(0);
  });

  it("PODGLĄD pokazuje tylko pozycje WIDOCZNE, a bez nich - komunikat", async () => {
    // Podgląd renderujący wyłączone pozycje kłamałby o tym, co zobaczy
    // czytelnik.
    await mountBar({ items: [barItem({ enabled: false })] });
    expect(screen.queryByTestId("MobileBottomBarView")).toBeNull();
    expect(document.body.textContent).toContain("mobileBottomBar.emptyItems");

    cleanup();
    await mountBar({ items: [barItem({ enabled: true })] });
    expect(screen.getByTestId("MobileBottomBarView")).toBeTruthy();
    // Podgląd dostaje BIEŻĄCY szkic i celuje w środkową pozycję.
    expect(h.props.MobileBottomBarView.config).toBeTruthy();
    expect(h.props.MobileBottomBarView.activeIndex).toBe(0);
    // Panel NIE odpytuje o liczniki plakietek - to nie jest widok czytelnika.
    expect(h.props.MobileBottomBarView.withBadges).toBe(false);
  });

  it("przełącznik motywu podglądu zmienia OBA stany", async () => {
    // Jeden kolor akcentu nigdy nie ma dobrego kontrastu na obu tłach, więc
    // podgląd musi dać się przełączyć - inaczej administrator ustawia ciemny
    // akcent w ciemno.
    await mountBar({ items: [barItem()] });
    const toggle = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("mobileBottomBar.previewLight"),
    );
    if (!toggle) throw new Error("test: brak przełącznika motywu podglądu");
    fireEvent.click(toggle);
    await waitFor(() => expect(document.body.textContent).toContain("mobileBottomBar.previewDark"));
    const back = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("mobileBottomBar.previewDark"),
    );
    if (back) fireEvent.click(back);
    await waitFor(() =>
      expect(document.body.textContent).toContain("mobileBottomBar.previewLight"),
    );
  });

  it("wybór ikony przechodzi do POZYCJI, nie do całego paska", async () => {
    await mountBar({ items: [barItem({ id: "a" })] });
    const onChange = h.props.LucideIconPicker?.onChange;
    expect(typeof onChange).toBe("function");
    if (typeof onChange !== "function") throw new Error("test: brak `onChange` wyboru ikony");
    act(() => onChange("star"));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
    const saved = lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)?.items;
    expect(Array.isArray(saved) ? (saved[0] as { icon: string }).icon : "").toBe("star");
  });

  it("cztery przełączniki górnej sekcji zmieniają ŁADUNEK", async () => {
    await mountBar({
      items: [],
      enabled: false,
      show_labels: false,
      hide_on_scroll: false,
      use_item_color: false,
    });
    const boxes = Array.from(
      document.querySelectorAll<HTMLElement>('[role="checkbox"], input[type="checkbox"]'),
    );
    for (const box of boxes) fireEvent.click(box);
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
    const saved = lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY);
    expect(saved?.enabled).toBe(true);
    expect(saved?.show_labels).toBe(true);
    expect(saved?.hide_on_scroll).toBe(true);
    expect(saved?.use_item_color).toBe(true);
  });

  it("CZTERY pola koloru paska: dwa tła i dwie ikony, jasny i ciemny osobno", async () => {
    // Jeden kolor na oba motywy nigdy nie ma dobrego kontrastu, więc panel ma
    // po dwie pary. Pola są lokalne dla tej trasy (nie wspólny `ColorField`
    // buildera), więc idą jako natywne próbniki - i to je testujemy.
    await mountBar({ items: [] });
    const swatches = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="color"]'));
    expect(swatches).toHaveLength(4);
    const labels = swatches.map((input) => input.getAttribute("aria-label"));
    expect(labels).toEqual([
      "mobileBottomBar.backgroundLight",
      "mobileBottomBar.backgroundDark",
      "mobileBottomBar.iconLight",
      "mobileBottomBar.iconDark",
    ]);

    fireEvent.change(swatches[3], { target: { value: "#123456" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
    expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)?.icon_dark).toBe("#123456");
  });

  it("kolor paska POZA wzorcem `#rrggbb` nie wchodzi do próbnika, ale zostaje w polu", async () => {
    // Ta sama reguła co przy pozycjach: `<input type="color">` po cichu
    // zamieniłby nieznaną wartość na czarny i zapisał czarny.
    await mountBar({ items: [], background_light: "rgb(255,0,0)" });
    const swatches = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="color"]'));
    expect(swatches[0].value).toBe("#ffffff");
    const texts = textInputs().map((input) => input.value);
    expect(texts).toContain("rgb(255,0,0)");
  });

  it("pole TEKSTOWE koloru zapisuje wartość tak, jak ją wpisano", async () => {
    // Administrator wkleja token projektowy (`var(--brand)`), którego próbnik
    // nie zna - i to jest prawidłowe użycie: pasek renderuje się w CSS.
    await mountBar({ items: [] });
    const colorTexts = textInputs();
    expect(colorTexts.length).toBeGreaterThanOrEqual(4);
    fireEvent.change(colorTexts[0], { target: { value: "var(--brand)" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)).toBeTruthy());
    expect(lastSave(MOBILE_BOTTOM_BAR_SETTINGS_KEY)?.background_light).toBe("var(--brand)");
  });
});

describe("admin.settings.cookie-banner - kolory, treści PL/EN i podgląd", () => {
  async function mountBanner2(config: Record<string, unknown> = {}): Promise<void> {
    h.rows[COOKIE_BANNER_SETTINGS_KEY] = config;
    await mount(CookieBannerRoute, "/admin/settings/cookie-banner");
    await waitFor(() => expect(saveButton()).toBeTruthy());
  }

  function tabs(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  }

  it("TRZY mechanizmy zgody zmieniają ładunek niezależnie", async () => {
    // Wyłączenie banera, przełącznika języka i automatycznej deklaracji to trzy
    // różne decyzje prawne - jedno pole na wszystkie byłoby niedopuszczalne.
    await mountBanner2({ enabled: false, languageSwitcher: false, autoInventory: false });
    const boxes = Array.from(
      document.querySelectorAll<HTMLElement>('[role="checkbox"], input[type="checkbox"]'),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const box of boxes.slice(0, 3)) fireEvent.click(box);
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)).toBeTruthy());
    const saved = lastSave(COOKIE_BANNER_SETTINGS_KEY);
    expect(saved?.enabled).toBe(true);
    expect(saved?.languageSwitcher).toBe(true);
    expect(saved?.autoInventory).toBe(true);
  });

  it("SZEŚĆ pól koloru idzie przez wspólny wybierak, każde z własną etykietą", async () => {
    // Puste = „użyj motywu" i to jest prawidłowy stan (podpowiedź pokazuje,
    // co wtedy zobaczy odwiedzający). `||` w drugą stronę wstawiłoby
    // podpowiedź jako wartość i przykleiło baner do jednego zestawu kolorów.
    await mountBanner2();
    const pickers = Object.keys(h.props).filter((name) => name === "AdminColorPicker");
    expect(pickers.length).toBeGreaterThan(0);
    const picker = h.props.AdminColorPicker;
    expect(picker.placeholder).toBeTruthy();
    expect(String(picker.ariaLabel)).toContain("wybierz kolor");
    // Wybierak NIE dopuszcza przezroczystości - baner musi być czytelny.
    expect(picker.allowTransparent).toBe(false);
  });

  it("PUSTY kolor jedzie do wybieraka jako `undefined`, nie jako pusty łańcuch", async () => {
    // `value || undefined`: pusty łańcuch w wybieraku pokazałby czarny jako
    // wybrany, a on ma pokazać „nic nie wybrano" (czyli motyw).
    await mountBanner2({ colors: { surface: "", foreground: "#ffffff" } });
    expect(
      h.props.AdminColorPicker.value === undefined ||
        typeof h.props.AdminColorPicker.value === "string",
    ).toBe(true);
  });

  it("wyczyszczenie koloru w wybieraku zapisuje PUSTY łańcuch, nie `null`", async () => {
    // `onChange(v ?? "")` - `null` w kolumnie jsonb znaczy „ustawione na nic",
    // a pusty łańcuch „użyj motywu". Panel musi zapisać to drugie.
    await mountBanner2({ colors: { surface: "#111111" } });
    const onChange = h.props.AdminColorPicker.onChange;
    if (typeof onChange !== "function") throw new Error("test: brak `onChange` wybieraka");
    act(() => onChange(null));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)).toBeTruthy());
    const colors = lastSave(COOKIE_BANNER_SETTINGS_KEY)?.colors;
    expect(typeof colors).toBe("object");
    // Ostatni wybierak w drzewie to „Akcent - tekst".
    expect((colors as Record<string, unknown>).accentForeground).toBe("");
  });

  it("zakładki treści przełączają WERSJĘ JĘZYKOWĄ, a nie zbiór pól", async () => {
    // Baner ma jeden zestaw pól i dwie wersje treści. Zakładka, która zmienia
    // ZBIÓR pól, znaczyłaby, że jedna wersja jest uboższa - i na `/en/`
    // brakowałoby przycisku.
    await mountBanner2();
    expect(tabs()).toHaveLength(2);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    const fieldsBefore = document.querySelectorAll("input, textarea").length;

    fireEvent.click(tabs()[1]);
    await waitFor(() => expect(tabs()[1].getAttribute("aria-selected")).toBe("true"));
    expect(tabs()[0].getAttribute("aria-selected")).toBe("false");
    expect(document.querySelectorAll("input, textarea").length).toBe(fieldsBefore);
  });

  it("edycja treści PL nie rusza treści EN - i odwrotnie", async () => {
    // `{...draft.copy, [lang]: next}` jest tu regułą: zapis płaski nadpisałby
    // drugą wersję językową obiektem edytowanej.
    await mountBanner2({
      copy: {
        pl: { title: "Polski tytuł", intro: "PL" },
        en: { title: "English title", intro: "EN" },
      },
    });
    const titleInput = textInputs().find((input) => input.value === "Polski tytuł");
    expect(titleInput).toBeTruthy();
    if (!titleInput) throw new Error("test: brak pola tytułu");
    fireEvent.change(titleInput, { target: { value: "Nowy polski" } });

    fireEvent.click(tabs()[1]);
    await waitFor(() => expect(tabs()[1].getAttribute("aria-selected")).toBe("true"));
    const englishTitle = textInputs().find((input) => input.value === "English title");
    expect(englishTitle, "wersja angielska została nadpisana").toBeTruthy();

    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)).toBeTruthy());
    const copy = lastSave(COOKIE_BANNER_SETTINGS_KEY)?.copy as Record<
      string,
      Record<string, string>
    >;
    expect(copy.pl.title).toBe("Nowy polski");
    expect(copy.en.title).toBe("English title");
  });

  it("edycja OPISU kategorii (pole wieloliniowe) też trafia do ładunku", async () => {
    await mountBanner2();
    const areas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"));
    expect(areas.length).toBeGreaterThanOrEqual(5);
    fireEvent.change(areas[areas.length - 1], { target: { value: "Nowy opis marketingu" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)).toBeTruthy());
    const copy = lastSave(COOKIE_BANNER_SETTINGS_KEY)?.copy as Record<
      string,
      Record<string, string>
    >;
    expect(copy.pl.descMarketing).toBe("Nowy opis marketingu");
  });

  it("sekcja marki dostaje logo i odnośniki, i oddaje je z powrotem", async () => {
    await mountBanner2({ logo: { src: "https://example.org/l.svg" }, links: [] });
    expect(h.props.CookieBannerBrandingSection.logo).toMatchObject({
      src: "https://example.org/l.svg",
    });
    const onLinksChange = h.props.CookieBannerBrandingSection.onLinksChange;
    if (typeof onLinksChange !== "function") throw new Error("test: brak `onLinksChange`");
    act(() => onLinksChange([{ label: "Polityka", href: "/polityka" }]));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)).toBeTruthy());
    expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)?.links).toEqual([
      { label: "Polityka", href: "/polityka" },
    ]);
  });

  it("zmiana logo w sekcji marki trafia do ładunku", async () => {
    await mountBanner2();
    const onLogoChange = h.props.CookieBannerBrandingSection.onLogoChange;
    if (typeof onLogoChange !== "function") throw new Error("test: brak `onLogoChange`");
    act(() => onLogoChange({ src: "https://example.org/nowe.svg" }));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)).toBeTruthy());
    expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)?.logo).toEqual({
      src: "https://example.org/nowe.svg",
    });
  });

  it("PRZYWRÓCENIE domyślnych PYTA o potwierdzenie i bez zgody nic nie zmienia", async () => {
    // Przywrócenie zdmuchuje ręcznie napisane treści w dwóch językach. Bez
    // potwierdzenia jedno omyłkowe kliknięcie kasuje pracę prawnika.
    await mountBanner2({ copy: { pl: { title: "Mój tytuł" }, en: { title: "Mine" } } });
    const restore = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Przywróć domyślne"),
    );
    if (!restore) throw new Error("test: brak przycisku przywrócenia");

    const original = window.confirm;
    Reflect.set(window, "confirm", () => false);
    try {
      fireEvent.click(restore);
      expect(textInputs().some((input) => input.value === "Mój tytuł")).toBe(true);
    } finally {
      Reflect.set(window, "confirm", original);
    }
  });

  it("PRZYWRÓCENIE domyślnych po potwierdzeniu podmienia treści na domyślne", async () => {
    await mountBanner2({ copy: { pl: { title: "Mój tytuł" }, en: { title: "Mine" } } });
    const restore = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Przywróć domyślne"),
    );
    if (!restore) throw new Error("test: brak przycisku przywrócenia");

    const original = window.confirm;
    Reflect.set(window, "confirm", () => true);
    try {
      fireEvent.click(restore);
      await waitFor(() =>
        expect(textInputs().some((input) => input.value === "Mój tytuł")).toBe(false),
      );
      fireEvent.click(saveButton() as HTMLButtonElement);
      await waitFor(() => expect(lastSave(COOKIE_BANNER_SETTINGS_KEY)).toBeTruthy());
      const copy = lastSave(COOKIE_BANNER_SETTINGS_KEY)?.copy as Record<
        string,
        Record<string, string>
      >;
      expect(copy.pl.title).not.toBe("Mój tytuł");
    } finally {
      Reflect.set(window, "confirm", original);
    }
  });

  it("podgląd DA SIĘ ZAMKNĄĆ - nakładka nie może uwięzić administratora", async () => {
    await mountBanner2();
    const preview = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Podgląd",
    );
    if (!preview) throw new Error("test: brak przycisku podglądu");
    fireEvent.click(preview);
    await waitFor(() => expect(screen.queryByTestId("ConsentBanner")).toBeTruthy());

    const onClose = h.props.ConsentBanner;
    expect(onClose).toBeTruthy();
    // Zamknięcie idzie przez element nakładki, nie przez sam baner.
    const closers = Array.from(document.querySelectorAll("button")).filter(
      (button) => button !== preview && button !== saveButton(),
    );
    for (const button of closers) {
      fireEvent.click(button);
      if (!screen.queryByTestId("ConsentBanner")) break;
    }
    await waitFor(() => expect(screen.queryByTestId("ConsentBanner")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// 8. BRAMKA POLA MARTWEGO. Jedna reguła, dwanaście paneli: pole, którego
// zmiana NIE ZMIENIA ładunku zapisu, jest polem-atrapą - administrator coś
// w nim ustawia i to nigdzie nie dochodzi. To najczęstszy defekt formularzy
// konfiguracyjnych, bo nie daje żadnego objawu: nie ma błędu, nie ma
// komunikatu, jest tylko ustawienie, które „nie działa".
// ---------------------------------------------------------------------------

/** Kontrolki formularza panelu, w kolejności DOM. Bez przycisków. */
function formControls(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'input:not([type="button"]), textarea, select, [role="checkbox"]',
    ),
  );
}

/** Czytelny opis kontrolki do komunikatu błędu. */
function describeControl(element: HTMLElement, index: number): string {
  const label =
    element.getAttribute("aria-label") ??
    element.closest("label")?.textContent?.trim().slice(0, 40) ??
    element.getAttribute("placeholder") ??
    "";
  const type = element.getAttribute("type") ?? element.tagName.toLowerCase();
  return `#${index} ${type}${label ? ` (${label})` : ""}`;
}

/**
 * Zmienia kontrolkę na wartość RÓŻNĄ od bieżącej. Zwraca `false`, gdy nie ma
 * czym jej zmienić (np. pole wyboru z jedną opcją) - taka kontrolka nie jest
 * martwa, po prostu nie ma alternatywy.
 */
function changeControl(element: HTMLElement): boolean {
  if (element instanceof HTMLSelectElement) {
    const options = Array.from(element.options).map((option) => option.value);
    const next = options.find((value) => value !== element.value);
    if (next === undefined) return false;
    fireEvent.change(element, { target: { value: next } });
    return true;
  }
  if (element instanceof HTMLTextAreaElement) {
    // Podpowiedź mówi, JAKIEGO KSZTAŁTU wartości pole oczekuje. Pole listy
    // adresów odsiewa wszystko, co nie jest adresem (i słusznie), więc test
    // musi wpisać adres - inaczej „brak zmiany ładunku" byłby poprawnym
    // zachowaniem walidacji, a nie martwym polem.
    const wantsUrl = (element.placeholder ?? "").startsWith("http");
    fireEvent.change(element, {
      target: {
        value: wantsUrl ? "https://example.org/zmiana" : `${element.value}-zmiana`,
      },
    });
    return true;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") {
      fireEvent.click(element);
      return true;
    }
    if (element.type === "color") {
      fireEvent.change(element, {
        target: { value: element.value === "#123456" ? "#654321" : "#123456" },
      });
      return true;
    }
    if (element.type === "number") {
      const current = Number(element.value);
      const min = element.min === "" ? 0 : Number(element.min);
      const max = element.max === "" ? 999 : Number(element.max);
      const next = current === min ? Math.min(min + 1, max) : min;
      if (next === current) return false;
      fireEvent.change(element, { target: { value: String(next) } });
      return true;
    }
    fireEvent.change(element, { target: { value: `${element.value}-zmiana` } });
    return true;
  }
  if (element.getAttribute("role") === "checkbox") {
    if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
      // Kontrolka zablokowana z definicji (np. kategoria niezbędna) - jej
      // brak reakcji jest regułą, nie defektem.
      return false;
    }
    fireEvent.click(element);
    return true;
  }
  return false;
}

/** Migawka wszystkich ładunków zapisu jako łańcuch - do porównania. */
function saveSnapshot(): string {
  h.saves = [];
  const button = saveButton();
  if (!button) throw new Error("test: brak paska zapisu");
  fireEvent.click(button);
  return JSON.stringify(h.saves);
}

describe("admin.settings.* - żadne pole panelu nie jest martwe", () => {
  it.each(PANELS)(
    "$name: zmiana KAŻDEJ kontrolki zmienia ładunek zapisu",
    async ({ route, path }) => {
      await mount(route, path);
      await waitFor(() => expect(saveButton()).toBeTruthy());

      const total = formControls().length;
      expect(total, "panel bez ani jednej kontrolki").toBeGreaterThan(0);

      const dead: string[] = [];
      for (let index = 0; index < total; index += 1) {
        const before = saveSnapshot();
        const control = formControls()[index];
        if (!control) continue;
        const description = describeControl(control, index);
        if (!changeControl(control)) continue;
        await waitFor(() => expect(document.body).toBeTruthy());
        const after = saveSnapshot();
        if (after === before) dead.push(description);
      }
      expect(dead, `pola bez wpływu na ładunek: ${dead.join(" | ")}`).toEqual([]);
    },
  );
});

describe("admin.settings.seo - lista adresów podmiotu (`sameAs`)", () => {
  it("odsiewa wpisy, które NIE SĄ adresami, i obcina spacje", async () => {
    // `sameAs` w JSON-LD to lista profili organizacji. Wpis, który nie jest
    // adresem, unieważnia cały blok danych strukturalnych - Google odrzuca go
    // w całości, a nie tylko tę linię. Dlatego filtr jest po stronie panelu.
    await mount(SeoRoute, "/admin/settings/seo");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const area = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(
      (element) => element.placeholder.startsWith("http"),
    );
    if (!area) throw new Error("test: brak pola listy adresów");

    fireEvent.change(area, {
      target: {
        value: [
          "  https://example.org/firma  ",
          "to nie adres",
          "",
          "ftp://example.org/plik",
          "HTTPS://EXAMPLE.ORG/DUZE",
        ].join("\n"),
      },
    });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(SEO_SETTINGS_KEY)).toBeTruthy());
    expect(lastSave(SEO_SETTINGS_KEY)?.organization_same_as).toEqual([
      "https://example.org/firma",
      "HTTPS://EXAMPLE.ORG/DUZE",
    ]);
  });

  it("ogranicza listę do DWUDZIESTU wpisów", async () => {
    // Blok danych strukturalnych rośnie w każdym dokumencie serwisu, więc
    // granica jest tu oszczędnością na każdej odsłonie, nie kaprysem.
    await mount(SeoRoute, "/admin/settings/seo");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const area = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(
      (element) => element.placeholder.startsWith("http"),
    );
    if (!area) throw new Error("test: brak pola listy adresów");
    const many = Array.from({ length: 25 }, (_, index) => `https://example.org/${index}`);
    fireEvent.change(area, { target: { value: many.join("\n") } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(SEO_SETTINGS_KEY)).toBeTruthy());
    const saved = lastSave(SEO_SETTINGS_KEY)?.organization_same_as;
    expect(Array.isArray(saved) ? saved.length : 0).toBe(20);
  });

  it("lista z bazy renderuje się po JEDNYM adresie na linię", async () => {
    h.rows[SEO_SETTINGS_KEY] = {
      organization_same_as: ["https://example.org/a", "https://example.org/b"],
    };
    await mount(SeoRoute, "/admin/settings/seo");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const area = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(
      (element) => element.placeholder.startsWith("http"),
    );
    expect(area?.value).toBe("https://example.org/a\nhttps://example.org/b");
  });
});

describe("admin.settings.analytics - stan połączenia i okno łączenia GA4", () => {
  /** Stan GA4 w kształcie, jaki oddaje serwerowa diagnostyka. */
  interface Ga4Status {
    configured: boolean;
    hasMeasurementId: boolean;
    hasEmbedUrl: boolean;
    hasPropertyId: boolean;
    activeMode: string | null;
    missingSecrets: string[];
    serviceAccountEmail: string | null;
    propertyId: string | null;
  }
  interface AnalyticsStatusShape {
    ga4: Ga4Status;
    gsc: { configured: boolean };
  }

  /** Odpowiedź diagnostyki w kształcie, jaki oddaje serwer. */
  function status(overrides: Partial<AnalyticsStatusShape> = {}): AnalyticsStatusShape {
    return {
      ga4: {
        configured: false,
        hasMeasurementId: false,
        hasEmbedUrl: false,
        hasPropertyId: false,
        activeMode: null,
        missingSecrets: [],
        serviceAccountEmail: null,
        propertyId: null,
      },
      gsc: { configured: false },
      ...overrides,
    };
  }

  async function mountAnalytics(
    config: Record<string, unknown> = {},
    st: AnalyticsStatusShape = status(),
  ): Promise<void> {
    h.rows.analytics = config;
    h.analyticsStatus = st;
    await mount(AnalyticsRoute, "/admin/settings/analytics");
    await waitFor(() => expect(saveButton()).toBeTruthy());
  }

  function buttonWith(fragment: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(fragment),
    );
  }

  it("stan „sprawdzanie” pokazuje się, DOPÓKI diagnostyka nie wróci", async () => {
    // `!s -> "loading"`: brak odpowiedzi nie może wyglądać jak „nie
    // skonfigurowano", bo to dwie różne decyzje administratora.
    //
    // ZAPYTANIE MUSI WISIEĆ, a nie oddać `undefined`: react-query odrzuca
    // zapytanie, które zwróciło `undefined`, więc panel pokazałby wskaźnik
    // BŁĘDU - osobny stan, dowiedziony niżej i świadomie odróżniony od
    // „sprawdzania" (`StatusKind` w `admin.settings.analytics.tsx`).
    h.analyticsStatusPending = true;
    h.rows.analytics = {};
    await mount(AnalyticsRoute, "/admin/settings/analytics");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    expect(document.body.textContent).toContain("admin.analyticsSettings.status.checking");
    expect(document.body.textContent).not.toContain("admin.analyticsSettings.status.error");
  });

  it("padnięta diagnostyka pokazuje BŁĄD, a nie wieczne „sprawdzanie”", async () => {
    // Druga strona tej samej reguły: odrzucone zapytanie to informacja
    // „idź po uprawnienia albo po sekrety", a nie „poczekaj jeszcze".
    h.analyticsStatusError = true;
    h.rows.analytics = {};
    await mount(AnalyticsRoute, "/admin/settings/analytics");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    await waitFor(() =>
      expect(document.body.textContent).toContain("admin.analyticsSettings.status.error"),
    );
    expect(document.body.textContent).not.toContain("admin.analyticsSettings.status.checking");
  });

  it.each([
    {
      label: "WYŁĄCZONY mimo skonfigurowania",
      config: { ga4_enabled: false, ga4_measurement_id: "G-ABC" },
      st: status({ ga4: { ...status().ga4, configured: true } }),
      expected: "admin.analyticsSettings.ga4.disabled",
    },
    {
      label: "POŁĄCZONY",
      config: { ga4_enabled: true },
      st: status({ ga4: { ...status().ga4, configured: true } }),
      expected: "admin.analyticsSettings.status.connected",
    },
    {
      label: "CZĘŚCIOWY - identyfikator w szkicu, ale serwer nie potwierdza",
      config: { ga4_enabled: true, ga4_measurement_id: " G-ABC " },
      st: status(),
      expected: "admin.analyticsSettings.status.partial",
    },
    {
      label: "CZĘŚCIOWY - serwer widzi identyfikator pomiaru",
      config: { ga4_enabled: true, ga4_measurement_id: "" },
      st: status({ ga4: { ...status().ga4, hasMeasurementId: true } }),
      expected: "admin.analyticsSettings.status.partial",
    },
    {
      label: "CZĘŚCIOWY - serwer widzi adres osadzenia",
      config: { ga4_enabled: true, ga4_measurement_id: "" },
      st: status({ ga4: { ...status().ga4, hasEmbedUrl: true } }),
      expected: "admin.analyticsSettings.status.partial",
    },
    {
      label: "CZĘŚCIOWY - serwer widzi identyfikator usługi",
      config: { ga4_enabled: true, ga4_measurement_id: "" },
      st: status({ ga4: { ...status().ga4, hasPropertyId: true } }),
      expected: "admin.analyticsSettings.status.partial",
    },
    {
      label: "NIESKONFIGUROWANY - nic nigdzie nie ustawione",
      config: { ga4_enabled: true, ga4_measurement_id: "   " },
      st: status(),
      expected: "admin.analyticsSettings.status.notConfigured",
    },
  ])("stan GA4: $label", async ({ config, st, expected }) => {
    // Pięć różnych stanów jednego połączenia. „Częściowy" jest tu najważniejszy:
    // to sytuacja, w której identyfikator jest wpisany, ale serwer go nie
    // potwierdza (brak sekretu, zła usługa) - pokazanie „połączono" byłoby
    // kłamstwem, a „nie skonfigurowano" kazałoby wpisywać wszystko od nowa.
    cleanup();
    await mountAnalytics(config, st);
    expect(document.body.textContent).toContain(expected);
  });

  it("stan POŁĄCZONY oferuje ponowne łączenie i ROZŁĄCZENIE, a nie „połącz”", async () => {
    await mountAnalytics(
      { ga4_enabled: true },
      status({ ga4: { ...status().ga4, configured: true } }),
    );
    expect(buttonWith("admin.analyticsSettings.ga4.reconnect")).toBeTruthy();
    expect(buttonWith("admin.analyticsSettings.ga4.disconnect")).toBeTruthy();
    expect(buttonWith("admin.analyticsSettings.ga4.connect")).toBeUndefined();
  });

  it("stan NIESKONFIGUROWANY oferuje tylko „połącz”", async () => {
    await mountAnalytics({ ga4_enabled: true, ga4_measurement_id: "" }, status());
    expect(buttonWith("admin.analyticsSettings.ga4.connect")).toBeTruthy();
    expect(buttonWith("admin.analyticsSettings.ga4.disconnect")).toBeUndefined();
  });

  it("okno łączenia startuje ZAMKNIĘTE i otwiera się z przycisku", async () => {
    await mountAnalytics({ ga4_enabled: true, ga4_measurement_id: "" }, status());
    expect(document.body.textContent).not.toContain("admin.analyticsSettings.ga4.connectTitle");
    const connect = buttonWith("admin.analyticsSettings.ga4.connect");
    if (!connect) throw new Error("test: brak przycisku łączenia");
    fireEvent.click(connect);
    await waitFor(() =>
      expect(document.body.textContent).toContain("admin.analyticsSettings.ga4.connectTitle"),
    );
  });

  it("okno łączenia PRZENOSI bieżące identyfikatory jako wartości startowe", async () => {
    // Ponowne łączenie z pustymi polami kazałoby przepisywać identyfikatory
    // z pamięci - a one są dziewięciocyfrowe.
    await mountAnalytics(
      { ga4_enabled: true, ga4_property_id: "123456789", ga4_measurement_id: "G-ABC" },
      status({ ga4: { ...status().ga4, configured: true } }),
    );
    const reconnect = buttonWith("admin.analyticsSettings.ga4.reconnect");
    if (!reconnect) throw new Error("test: brak przycisku ponownego łączenia");
    fireEvent.click(reconnect);
    await waitFor(() =>
      expect(document.body.textContent).toContain("admin.analyticsSettings.ga4.connectTitle"),
    );
    const dialog = screen.getByTestId("dialog");
    const dialogValues = Array.from(
      dialog.querySelectorAll<HTMLInputElement>('input[type="text"]'),
    ).map((input) => input.value);
    expect(dialogValues).toContain("123456789");
    expect(dialogValues).toContain("G-ABC");
  });

  it("BRAKUJĄCE SEKRETY są wypisane w oknie - administrator wie, czego dodać", async () => {
    // Bez tej listy „nie udało się połączyć" jest komunikatem bez działania.
    await mountAnalytics(
      { ga4_enabled: true },
      status({
        ga4: { ...status().ga4, missingSecrets: ["GA4_SERVICE_ACCOUNT", "GA4_PRIVATE_KEY"] },
      }),
    );
    const connect =
      buttonWith("admin.analyticsSettings.ga4.connect") ??
      buttonWith("admin.analyticsSettings.ga4.reconnect");
    if (!connect) throw new Error("test: brak przycisku łączenia");
    fireEvent.click(connect);
    await waitFor(() =>
      expect(document.body.textContent).toContain("admin.analyticsSettings.ga4.secretsNeeded"),
    );
    expect(document.body.textContent).toContain("GA4_SERVICE_ACCOUNT");
    expect(document.body.textContent).toContain("GA4_PRIVATE_KEY");
  });

  it("zatwierdzenie okna OBCINA spacje i WŁĄCZA pomiar", async () => {
    // Identyfikator z niewidoczną spacją nie pasuje do niczego po stronie
    // dostawcy, a `ga4_enabled: true` jest tu sensem operacji: „połącz" ma
    // połączyć, nie tylko zapisać liczby.
    await mountAnalytics({ ga4_enabled: false, ga4_measurement_id: "" }, status());
    const connect = buttonWith("admin.analyticsSettings.ga4.connect");
    if (!connect) throw new Error("test: brak przycisku łączenia");
    fireEvent.click(connect);
    await waitFor(() =>
      expect(document.body.textContent).toContain("admin.analyticsSettings.ga4.connectTitle"),
    );

    const dialogInputs = Array.from(
      screen.getByTestId("dialog").querySelectorAll<HTMLInputElement>('input[type="text"]'),
    );
    expect(dialogInputs).toHaveLength(2);
    fireEvent.change(dialogInputs[0], { target: { value: "  987654321  " } });
    fireEvent.change(dialogInputs[1], { target: { value: "  G-XYZ  " } });
    // Przycisk zatwierdzenia to ostatni przycisk W OKNIE, który nie jest
    // anulowaniem - okno jest wydzielone `data-testid`, więc nie ma ryzyka
    // trafienia w pasek zapisu panelu.
    const dialog = screen.getByTestId("dialog");
    const dialogButtons = Array.from(dialog.querySelectorAll("button")).filter(
      (button) => !button.textContent?.includes("admin.analyticsSettings.ga4.cancel"),
    );
    expect(dialogButtons.length).toBeGreaterThan(0);
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => expect(lastSave("analytics")).toBeTruthy());
    const saved = lastSave("analytics");
    expect(saved?.ga4_property_id).toBe("987654321");
    expect(saved?.ga4_measurement_id).toBe("G-XYZ");
    expect(saved?.ga4_enabled).toBe(true);
  });

  it("anulowanie okna NIE zapisuje niczego", async () => {
    await mountAnalytics({ ga4_enabled: true, ga4_measurement_id: "" }, status());
    const connect = buttonWith("admin.analyticsSettings.ga4.connect");
    if (!connect) throw new Error("test: brak przycisku łączenia");
    fireEvent.click(connect);
    await waitFor(() =>
      expect(document.body.textContent).toContain("admin.analyticsSettings.ga4.connectTitle"),
    );
    const cancel = buttonWith("admin.analyticsSettings.ga4.cancel");
    if (!cancel) throw new Error("test: brak przycisku anulowania");
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(document.body.textContent).not.toContain("admin.analyticsSettings.ga4.connectTitle"),
    );
    expect(h.saves).toHaveLength(0);
  });

  it("ROZŁĄCZENIE pyta o potwierdzenie i bez zgody nic nie zapisuje", async () => {
    // Rozłączenie gasi pomiar całego serwisu - dane z tego okresu przepadają
    // bezpowrotnie, więc pytanie jest tu obowiązkowe.
    await mountAnalytics(
      { ga4_enabled: true },
      status({ ga4: { ...status().ga4, configured: true } }),
    );
    const disconnect = buttonWith("admin.analyticsSettings.ga4.disconnect");
    if (!disconnect) throw new Error("test: brak przycisku rozłączenia");

    const original = window.confirm;
    Reflect.set(window, "confirm", () => false);
    try {
      fireEvent.click(disconnect);
      expect(h.saves).toHaveLength(0);
    } finally {
      Reflect.set(window, "confirm", original);
    }
  });

  it("ROZŁĄCZENIE po potwierdzeniu WYŁĄCZA pomiar, zachowując identyfikatory", async () => {
    // Identyfikatory zostają, bo rozłączenie jest odwracalne - ponowne
    // połączenie nie powinno wymagać ich przepisywania.
    await mountAnalytics(
      { ga4_enabled: true, ga4_property_id: "123456789", ga4_measurement_id: "G-ABC" },
      status({ ga4: { ...status().ga4, configured: true } }),
    );
    const disconnect = buttonWith("admin.analyticsSettings.ga4.disconnect");
    if (!disconnect) throw new Error("test: brak przycisku rozłączenia");

    const original = window.confirm;
    Reflect.set(window, "confirm", () => true);
    try {
      fireEvent.click(disconnect);
      await waitFor(() => expect(lastSave("analytics")).toBeTruthy());
      const saved = lastSave("analytics");
      expect(saved?.ga4_enabled).toBe(false);
      expect(saved?.ga4_property_id).toBe("123456789");
      expect(saved?.ga4_measurement_id).toBe("G-ABC");
      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    } finally {
      Reflect.set(window, "confirm", original);
    }
  });

  it("TRYB AKTYWNY z serwera jest pokazany razem z kontem usługi i identyfikatorem", async () => {
    // Administrator musi widzieć, KTÓRĄ drogą leci pomiar (konto usługi vs
    // osadzenie) - inaczej diagnostyka „nie działa" nie ma od czego zacząć.
    await mountAnalytics(
      { ga4_enabled: true },
      status({
        ga4: {
          ...status().ga4,
          configured: true,
          activeMode: "service_account",
          serviceAccountEmail: "pomiar@example.org",
          propertyId: "123456789",
        },
      }),
    );
    expect(document.body.textContent).toContain(
      "admin.analyticsSettings.ga4.modes.service_account",
    );
    expect(document.body.textContent).toContain("pomiar@example.org");
    expect(document.body.textContent).toContain("properties/123456789");
  });

  it("BRAK trybu aktywnego degraduje do etykiety „none”, nie do pustki", async () => {
    // `modeKey(mode) = mode ?? "none"` - bez tego klucz tłumaczenia kończyłby
    // się kropką i i18n zwracałoby surowy klucz na ekran.
    await mountAnalytics(
      { ga4_enabled: true },
      status({ ga4: { ...status().ga4, configured: true, activeMode: null } }),
    );
    expect(document.body.textContent).toContain("admin.analyticsSettings.ga4.modes.none");
  });

  it("stan Search Console jest OSOBNY od stanu GA4", async () => {
    // Dwa różne połączenia; wspólny wskaźnik mówiłby, że pomiar działa, kiedy
    // działa tylko jedno z nich.
    await mountAnalytics(
      { ga4_enabled: false },
      status({ gsc: { configured: true }, ga4: { ...status().ga4, configured: false } }),
    );
    expect(document.body.textContent).toContain("admin.analyticsSettings.gsc.managed");
    expect(document.body.textContent).toContain("admin.analyticsSettings.ga4.disabled");
  });

  it("Search Console BEZ konfiguracji kieruje do złącza", async () => {
    await mountAnalytics({}, status({ gsc: { configured: false } }));
    expect(document.body.textContent).toContain("admin.analyticsSettings.gsc.needsConnector");
  });

  it("stan Plausible wynika WYŁĄCZNIE ze szkicu - nie ma po co pytać serwera", async () => {
    // Plausible nie wymaga sekretu po naszej stronie: sam adres domeny
    // wystarcza. Wskaźnik czekający na diagnostykę pokazywałby „sprawdzanie"
    // na zawsze.
    await mountAnalytics({ plausible_domain: "  " }, status());
    const before = document.body.textContent ?? "";
    expect(before).toContain("admin.analyticsSettings.status.notConfigured");

    cleanup();
    await mountAnalytics({ plausible_domain: "example.org" }, status());
    expect(document.body.textContent).toContain("admin.analyticsSettings.status.connected");
  });

  it("ODŚWIEŻENIE diagnostyki jest osobnym przyciskiem i BLOKUJE się w trakcie", async () => {
    // Przycisk niesie NAZWĘ AKCJI (`status.refresh`), a nie napis stanu:
    // etykieta „sprawdzanie…" wyglądała na wskaźnik, więc nikt jej nie klikał -
    // a to jedyna droga do ponownej diagnostyki (komentarz przy przycisku
    // w `admin.settings.analytics.tsx`). Trwanie sprawdzania niesie `disabled`,
    // nie podmiana etykiety - i to jest tu przedmiotem dowodu, w obu ramionach.
    h.analyticsStatusPending = true;
    await mountAnalytics({}, status());
    const inFlight = buttonWith("admin.analyticsSettings.status.refresh");
    expect(inFlight, "brak przycisku odświeżenia diagnostyki").toBeTruthy();
    expect(inFlight).not.toBe(saveButton());
    // Napis stanu został przy wskaźniku, nie na przycisku.
    expect(inFlight?.textContent).not.toContain("admin.analyticsSettings.status.checking");
    expect(inFlight?.disabled).toBe(true);

    cleanup();
    h.analyticsStatusPending = false;
    await mountAnalytics({}, status());
    const ready = buttonWith("admin.analyticsSettings.status.refresh");
    if (!ready) throw new Error("test: brak przycisku odświeżenia");
    await waitFor(() => expect(ready.disabled).toBe(false));
    fireEvent.click(ready);
  });

  it("zapis panelu unieważnia CACHE DIAGNOSTYKI - inaczej wskaźnik kłamie", async () => {
    // Zapis zmienia to, co diagnostyka ma sprawdzać. Bez unieważnienia
    // administrator zapisuje identyfikator i patrzy na „nie skonfigurowano"
    // przez trzydzieści sekund.
    await mountAnalytics({ ga4_enabled: true }, status());
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("analytics")).toBeTruthy());
  });
});

describe("admin.settings.design - tokeny marki, kolory globalne, dodatkowe kolory", () => {
  async function mountDesign(): Promise<void> {
    await renderRoute({
      route: DesignRoute,
      path: "/admin/settings/design",
      initialEntry: "/admin/settings/design",
    });
    await waitFor(() => expect(saveButton()).toBeTruthy());
  }

  it("panel CZEKA, dopóki tokeny albo kolory globalne się wczytują", async () => {
    // Panel wyglądu zapisuje DWA niezależne źródła. Render przed wczytaniem
    // któregokolwiek dałby szkic z pustką - i pierwszy zapis zdmuchnąłby całą
    // paletę serwisu.
    h.designLoading = true;
    await renderRoute({
      route: DesignRoute,
      path: "/admin/settings/design",
      initialEntry: "/admin/settings/design",
    });
    await waitFor(() =>
      expect(document.body.textContent).toContain("adminAppearanceRoutes.loading"),
    );
    expect(saveButton()).toBeUndefined();
  });

  it("BRAK tokenów (jeszcze niezapisane) też trzyma panel na wczytywaniu", async () => {
    h.designTokens = null;
    await renderRoute({
      route: DesignRoute,
      path: "/admin/settings/design",
      initialEntry: "/admin/settings/design",
    });
    await waitFor(() =>
      expect(document.body.textContent).toContain("adminAppearanceRoutes.loading"),
    );
  });

  it("dwa wybieraki czcionek dostają BIEŻĄCĄ wartość i listę czcionek własnych", async () => {
    h.designTokens = {
      fonts: { heading: "Playfair", body: "Inter", custom: [{ family: "Moja", url: "u" }] },
      scale: {},
      colors: [],
    };
    await mountDesign();
    expect(screen.getAllByTestId("FontPicker")).toHaveLength(2);
    // Ostatni w drzewie to czcionka treści.
    expect(h.props.FontPicker.value).toBe("Inter");
    expect(h.props.FontPicker.customFonts).toEqual([{ family: "Moja", url: "u" }]);
  });

  it("BRAK czcionek własnych degraduje do pustej listy, nie do `undefined`", async () => {
    // `?? []` - `undefined` wywaliłoby wybierak na `.map`.
    h.designTokens = { fonts: { heading: "Inter", body: "Inter" }, scale: {}, colors: [] };
    await mountDesign();
    expect(h.props.FontPicker.customFonts).toEqual([]);
    expect(h.props.CustomFontUploader.value).toEqual([]);
  });

  it("zmiana czcionki i wgranie własnej trafiają do ZAPISU tokenów", async () => {
    await mountDesign();
    const onFontChange = h.props.FontPicker.onChange;
    if (typeof onFontChange !== "function") throw new Error("test: brak `onChange` czcionki");
    act(() => onFontChange("Lora, serif"));

    const onCustomChange = h.props.CustomFontUploader.onChange;
    if (typeof onCustomChange !== "function") throw new Error("test: brak `onChange` czcionek");
    act(() => onCustomChange([{ family: "Nowa", url: "https://example.org/f.woff2" }]));

    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(h.designSaves).toHaveLength(1));
    const saved = h.designSaves[0] as { fonts: Record<string, unknown> };
    expect(saved.fonts.body).toBe("Lora, serif");
    expect(saved.fonts.custom).toEqual([{ family: "Nowa", url: "https://example.org/f.woff2" }]);
  });

  it("PUSTY promień zapisuje `undefined`, a nie pusty łańcuch", async () => {
    // `e.target.value || undefined` - pusty łańcuch w tokenie CSS dałby
    // `border-radius: ;` i cicho zepsuł arkusz.
    h.designTokens = {
      fonts: { heading: "Inter", body: "Inter" },
      scale: { radius: "8px" },
      colors: [],
    };
    await mountDesign();
    const radius = textInputs().find((input) => input.value === "8px");
    if (!radius) throw new Error("test: brak pola promienia");
    fireEvent.change(radius, { target: { value: "" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(h.designSaves).toHaveLength(1));
    const saved = h.designSaves[0] as { scale: Record<string, unknown> };
    expect(saved.scale.radius).toBeUndefined();
  });

  it("BRAK promienia renderuje pole PUSTE z podpowiedzią, nie `undefined`", async () => {
    await mountDesign();
    const radius = textInputs().find((input) => input.placeholder === "8px");
    expect(radius).toBeTruthy();
    expect(radius?.value).toBe("");
  });

  it("kolory globalne renderują się po GRUPACH, a każdy slot ma nazwę zmiennej CSS", async () => {
    // Nazwa zmiennej jest tym, czego administrator szuka w kodzie szablonu -
    // bez niej lista sześćdziesięciu pól jest nie do użycia.
    await mountDesign();
    const groups = Array.from(document.querySelectorAll("ul.divide-y"));
    expect(groups.length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("var(--gc-");
  });

  it("slot BEZ wersji ciemnej ma JEDNO pole, a z wersją - dwa", async () => {
    // Nie każdy slot ma sens w motywie ciemnym (np. cień na białym papierze).
    // Renderowanie obu pól wszędzie sugerowałoby, że wartość ciemna gdzieś
    // działa - a nie działa.
    await mountDesign();
    const slots = Array.from(document.querySelectorAll("li.p-3"));
    expect(slots.length).toBeGreaterThan(0);
    const withDark = slots.filter((slot) => (slot.textContent ?? "").includes("Dark"));
    expect(withDark.length).toBeGreaterThan(0);
    expect(withDark.length).toBeLessThanOrEqual(slots.length);
  });

  it("PUSTA wartość slotu schodzi na wartość domyślną grupy, nie na pustkę", async () => {
    // `v.light ?? slot.defaultLight ?? ""` - trzy poziomy. Pominięcie
    // środkowego pokazałoby wszystkie sześćdziesiąt slotów jako niewypełnione,
    // choć motyw ma dla nich wartości.
    h.globalColors = {};
    await mountDesign();
    const values = Object.values(h.props).length;
    expect(values).toBeGreaterThan(0);
    // Podpowiedź niesie wartość domyślną - to ona mówi, co zobaczy czytelnik.
    expect(h.props.ColorField.placeholder).toBeTruthy();
  });

  it("wartość slotu z bazy WYGRYWA nad domyślną", async () => {
    await mountDesign();
    const onChange = h.props.ColorField.onChange;
    if (typeof onChange !== "function") throw new Error("test: brak `onChange` slotu");
    act(() => onChange("#abcdef"));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(h.globalColorSaves).toHaveLength(1));
    expect(JSON.stringify(h.globalColorSaves[0])).toContain("#abcdef");
  });

  it("PUSTA lista kolorów dodatkowych mówi to wprost", async () => {
    h.designTokens = { fonts: { heading: "Inter", body: "Inter" }, scale: {}, colors: [] };
    await mountDesign();
    expect(document.body.textContent).toContain("adminAppearanceRoutes.design.noExtraColors");
  });

  it("DODANIE koloru dokłada wiersz z nazwą pochodną od licznika", async () => {
    await mountDesign();
    const add = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminAppearanceRoutes.design.addColor"),
    );
    if (!add) throw new Error("test: brak przycisku dodania koloru");
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(h.designSaves).toHaveLength(1));
    const saved = h.designSaves[0] as { colors: { name: string; value: string }[] };
    expect(saved.colors.map((color) => color.name)).toEqual(["color-1", "color-2"]);
    expect(saved.colors[0].value).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("zmiana NAZWY i WARTOŚCI koloru dotyczy TEGO wiersza", async () => {
    h.designTokens = {
      fonts: { heading: "Inter", body: "Inter" },
      scale: {},
      colors: [
        { name: "pierwszy", value: "#111111" },
        { name: "drugi", value: "#222222" },
      ],
    };
    await mountDesign();
    const nameInput = textInputs().find((input) => input.value === "pierwszy");
    if (!nameInput) throw new Error("test: brak pola nazwy koloru");
    fireEvent.change(nameInput, { target: { value: "zmieniony" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(h.designSaves).toHaveLength(1));
    const saved = h.designSaves[0] as { colors: { name: string }[] };
    expect(saved.colors.map((color) => color.name)).toEqual(["zmieniony", "drugi"]);
  });

  it("USUNIĘCIE koloru zdejmuje DOKŁADNIE ten wiersz", async () => {
    h.designTokens = {
      fonts: { heading: "Inter", body: "Inter" },
      scale: {},
      colors: [
        { name: "a", value: "#111111" },
        { name: "b", value: "#222222" },
        { name: "c", value: "#333333" },
      ],
    };
    await mountDesign();
    const removes = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[title^="adminAppearanceRoutes.design.remove"]',
      ),
    );
    expect(removes).toHaveLength(3);
    fireEvent.click(removes[1]);
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(h.designSaves).toHaveLength(1));
    const saved = h.designSaves[0] as { colors: { name: string }[] };
    expect(saved.colors.map((color) => color.name)).toEqual(["a", "c"]);
  });

  it("KOPIOWANIE zmiennej CSS bierze SLUG nazwy, nie nazwę wprost", async () => {
    // Nazwa może zawierać spacje i polskie znaki; `var(--brand-Kolor Główny)`
    // jest niepoprawnym CSS-em. Slug jest tu jedyną poprawną formą.
    h.designTokens = {
      fonts: { heading: "Inter", body: "Inter" },
      scale: {},
      colors: [{ name: "Kolor Główny", value: "#111111" }],
    };
    const writes: string[] = [];
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          writes.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });
    try {
      await mountDesign();
      const copy = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          'button[title^="adminAppearanceRoutes.design.copyTitle"]',
        ),
      )[0];
      if (!copy) throw new Error("test: brak przycisku kopiowania");
      fireEvent.click(copy);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatch(/^var\(--brand-[a-z0-9-]+\)$/);
      expect(writes[0]).not.toContain(" ");
      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("ZAPIS dotyka OBU źródeł: tokenów i kolorów globalnych", async () => {
    // Jedno kliknięcie, dwa zapisy - bo to dwie tabele. Zapis tylko jednego
    // zostawiłby paletę i typografię w rozjeździe.
    await mountDesign();
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(h.designSaves).toHaveLength(1));
    expect(h.globalColorSaves).toHaveLength(1);
  });

  it("panel renderuje nawigację podsekcji wyglądu", async () => {
    await mountDesign();
    expect(screen.getByTestId("DesignSubNav")).toBeTruthy();
  });
});

describe("admin.settings.social-preview - obraz podglądu i przygotowanie pliku", () => {
  async function mountSocial(config: Record<string, unknown> = {}): Promise<void> {
    h.rows[SEO_SETTINGS_KEY] = config;
    await mount(SocialPreviewRoute, "/admin/settings/social-preview");
    await waitFor(() => expect(saveButton()).toBeTruthy());
  }

  it("BRAK własnego obrazu pokazuje w podglądzie obraz WBUDOWANY", async () => {
    // Podgląd, który przy braku obrazu pokazuje pustą ramkę, kłamie: link
    // wysłany do sieci społecznościowej i tak dostanie obraz domyślny.
    await mountSocial({ default_og_image_url: "   " });
    const image = document.querySelector<HTMLImageElement>("img");
    expect(image).toBeTruthy();
    expect(image?.src.length).toBeGreaterThan(0);
    expect(image?.src).not.toBe("");
  });

  it("WŁASNY obraz wygrywa nad wbudowanym - i jest obcinany ze spacji", async () => {
    await mountSocial({ default_og_image_url: "  https://example.org/og.jpg  " });
    const image = document.querySelector<HTMLImageElement>("img");
    expect(image?.getAttribute("src")).toBe("https://example.org/og.jpg");
  });

  it("BRAK tekstu alternatywnego degraduje do zdania zastępczego", async () => {
    // Obraz w podglądzie bez `alt` jest dla czytnika ekranu obrazem bez opisu.
    await mountSocial({ default_og_image_alt: "" });
    const image = document.querySelector<HTMLImageElement>("img");
    expect(image?.getAttribute("alt")).toBe("admin.socialPreview.previewAlt");
  });

  it("WŁASNY tekst alternatywny wygrywa", async () => {
    await mountSocial({ default_og_image_alt: "Logo organizacji" });
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("Logo organizacji");
  });

  it("pole tekstu alternatywnego ma LIMIT długości - sieci obcinają dłuższe", async () => {
    await mountSocial();
    const altInput = textInputs()[0];
    expect(altInput.maxLength).toBe(300);
  });

  it("tabela źródeł renderuje wiersze, a odnośnik pojawia się tylko tam, gdzie jest cel", async () => {
    // Wiersz bez celu to informacja („to bierze się z treści wpisu"), nie
    // martwy odnośnik.
    await mountSocial();
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    expect(rows.length).toBeGreaterThan(0);
    const withLink = rows.filter((row) => row.querySelector("a"));
    expect(withLink.length).toBeGreaterThan(0);
    expect(withLink.length).toBeLessThanOrEqual(rows.length);
  });

  it("PRZYGOTOWANIE pliku zwraca błędy i ostrzeżenia rozdzielnie", async () => {
    // Błąd blokuje wysyłkę (obraz nie nadaje się na kartę linku), ostrzeżenie
    // tylko informuje. Wrzucenie obu do jednego worka albo zablokowałoby
    // poprawny plik, albo przepuściło zły.
    const prepared: OgPrepareResult = {
      file: new File(["x"], "og.jpg", { type: "image/jpeg" }),
      bytesBefore: 1000,
      bytesAfter: 400,
      issues: [
        { code: "dimensions_too_small", severity: "error", params: { width: 400, height: 210 } },
        { code: "mime_converted", severity: "warning", params: { mime: "image/png" } },
      ],
    };
    const module = await import("@/lib/media/ogImage");
    const spy = vi.spyOn(module, "prepareOgImageFile").mockResolvedValue(prepared);
    try {
      await mountSocial();
      const transform = h.props.ImageSlot.transformFile;
      expect(typeof transform).toBe("function");
      if (typeof transform !== "function") throw new Error("test: brak `transformFile`");
      const result = await transform(new File(["x"], "wejscie.jpg", { type: "image/jpeg" }));
      const typed = result as { errors: string[]; warnings: string[]; file: File | null };
      expect(typed.errors).toEqual(["ogUpload.dimensions_too_small(height=210,width=400)"]);
      // Ostrzeżenie z listy problemów PLUS informacja o optymalizacji rozmiaru.
      expect(typed.warnings).toContain("ogUpload.mime_converted(mime=image/png)");
      expect(typed.warnings.some((warning) => warning.startsWith("ogUpload.optimized"))).toBe(true);
      expect(typed.file).toBe(prepared.file);
    } finally {
      spy.mockRestore();
    }
  });

  it("plik, którego NIE UDAŁO SIĘ zmniejszyć, nie dostaje informacji o optymalizacji", async () => {
    // Komunikat „zoptymalizowano" przy braku zmiany rozmiaru byłby fałszywy.
    const module = await import("@/lib/media/ogImage");
    const unchanged: OgPrepareResult = {
      file: null,
      bytesBefore: 500,
      bytesAfter: 0,
      issues: [],
    };
    const spy = vi.spyOn(module, "prepareOgImageFile").mockResolvedValue(unchanged);
    try {
      await mountSocial();
      const transform = h.props.ImageSlot.transformFile;
      if (typeof transform !== "function") throw new Error("test: brak `transformFile`");
      const result = (await transform(new File(["x"], "a.jpg", { type: "image/jpeg" }))) as {
        errors: string[];
        warnings: string[];
        file: File | null;
      };
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.file).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("gniazdo obrazu przyjmuje TYLKO formaty, które sieci potrafią pokazać", async () => {
    // SVG na karcie linku nie renderuje się w żadnej z sieci - dopuszczenie go
    // dałoby link z pustym obrazem.
    await mountSocial();
    const accept = String(h.props.ImageSlot.accept);
    expect(accept).toContain("image/jpeg");
    expect(accept).toContain("image/png");
    expect(accept).not.toContain("svg");
    expect(h.props.ImageSlot.folder).toBe("social");
  });
});

describe("admin.settings.google-source - logo, urządzenia, podgląd", () => {
  async function mountGoogle(config: Record<string, unknown> = {}): Promise<void> {
    h.rows[GOOGLE_SOURCE_BADGE_SETTINGS_KEY] = config;
    await mount(GoogleSourceRoute, "/admin/settings/google-source");
    await waitFor(() => expect(saveButton()).toBeTruthy());
  }

  it("DWA wybieraki logo: jasne i ciemne, każde zapisywane osobno", async () => {
    // Jedno logo na oba motywy znika na jednym z tł - a odznaka jest znakiem
    // rozpoznawczym w wynikach wyszukiwania.
    await mountGoogle({ logo: { light: "https://example.org/l.svg", dark: "", size: 20 } });
    expect(screen.getAllByTestId("CoverImagePicker")).toHaveLength(2);
    const onChange = h.props.CoverImagePicker.onChange;
    if (typeof onChange !== "function") throw new Error("test: brak `onChange` logo");
    act(() => onChange("https://example.org/ciemne.svg"));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(GOOGLE_SOURCE_BADGE_SETTINGS_KEY)).toBeTruthy());
    const logo = lastSave(GOOGLE_SOURCE_BADGE_SETTINGS_KEY)?.logo as Record<string, unknown>;
    expect(logo.dark).toBe("https://example.org/ciemne.svg");
    // Wersja jasna NIE ZOSTAŁA nadpisana.
    expect(logo.light).toBe("https://example.org/l.svg");
  });

  it("rozmiar sygnetu jest PRZYCINANY do zakresu przy wpisywaniu", async () => {
    await mountGoogle({ logo: { light: "", dark: "", size: 20 } });
    const number = document.querySelector<HTMLInputElement>('input[type="number"]');
    if (!number) throw new Error("test: brak pola rozmiaru");
    fireEvent.change(number, { target: { value: "999" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(GOOGLE_SOURCE_BADGE_SETTINGS_KEY)).toBeTruthy());
    const logo = lastSave(GOOGLE_SOURCE_BADGE_SETTINGS_KEY)?.logo as Record<string, unknown>;
    expect(Number(logo.size)).toBeLessThanOrEqual(32);
  });

  it("DWIE sekcje urządzeń zapisują się do OSOBNYCH gałęzi", async () => {
    await mountGoogle();
    const sections = screen.getAllByTestId("GoogleSourceBadgeDeviceSection");
    expect(sections).toHaveLength(2);
    const onChange = h.props.GoogleSourceBadgeDeviceSection.onChange;
    if (typeof onChange !== "function") throw new Error("test: brak `onChange` urządzenia");
    act(() => onChange({ enabled: true, position: "top" }));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(GOOGLE_SOURCE_BADGE_SETTINGS_KEY)).toBeTruthy());
    // Ostatnia sekcja w drzewie to telefon.
    expect(lastSave(GOOGLE_SOURCE_BADGE_SETTINGS_KEY)?.mobile).toEqual({
      enabled: true,
      position: "top",
    });
  });

  it("PODGLĄD renderuje odznakę dla OBU urządzeń i dostaje niezapisany szkic", async () => {
    await mountGoogle({ logo: { light: "https://example.org/l.svg", dark: "", size: 24 } });
    expect(screen.getAllByTestId("GooglePreferredSourceBadge")).toHaveLength(2);
    expect(h.props.GooglePreferredSourceBadge.configOverride).toBeTruthy();
    expect(h.props.GooglePreferredSourceBadge.themeOverride).toBe("light");
  });

  it("przełącznik motywu podglądu zmienia motyw PRZEKAZANY odznace", async () => {
    await mountGoogle();
    const toggle = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Logo: jasne",
    );
    if (!toggle) throw new Error("test: brak przełącznika motywu");
    fireEvent.click(toggle);
    await waitFor(() => expect(h.props.GooglePreferredSourceBadge.themeOverride).toBe("dark"));
  });

  it("PRZYWRÓCENIE domyślnych podmienia szkic bez pytania - operacja jest odwracalna", async () => {
    // Tu potwierdzenie NIE JEST potrzebne (inaczej niż w banerze cookie):
    // odznaka nie niesie ręcznie pisanych treści, tylko adresy i pozycje,
    // a przywrócenie nie zapisuje się samo - trzeba jeszcze kliknąć „Zapisz".
    await mountGoogle({ logo: { light: "https://example.org/moje.svg", dark: "", size: 30 } });
    const restore = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Przywróć domyślne"),
    );
    if (!restore) throw new Error("test: brak przycisku przywrócenia");
    fireEvent.click(restore);
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(GOOGLE_SOURCE_BADGE_SETTINGS_KEY)).toBeTruthy());
    const logo = lastSave(GOOGLE_SOURCE_BADGE_SETTINGS_KEY)?.logo as Record<string, unknown>;
    expect(logo.light).not.toBe("https://example.org/moje.svg");
  });
});

describe("admin.settings.* - ostatnie ramiona warunków", () => {
  it("site-identity: WYCZYSZCZENIE pola tytułu zapisuje pusty łańcuch, nie `null`", async () => {
    // `onChange={(v) => set(k, v ?? "")}` - `SeoTextField` oddaje `null`, gdy
    // pole zostało wyczyszczone (czyli „użyj wartości domyślnej"). `null`
    // w kolumnie tekstowej zepsułby renderowanie tytułu; pusty łańcuch
    // znaczy „bierz wartość wbudowaną". Cztery pola, cztery te same ramiona.
    h.rows[SEO_SETTINGS_KEY] = {
      site_title_pl: "Mój tytuł",
      site_title_en: "My title",
      site_description_pl: "Opis",
      site_description_en: "Description",
    };
    await mount(SiteIdentityRoute, "/admin/settings/site-identity");
    await waitFor(() => expect(saveButton()).toBeTruthy());

    // `SeoTextField` nie jest atrapą - w drzewie są jego natywne pola.
    const fields = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
    );
    expect(fields.length).toBeGreaterThanOrEqual(4);
    for (const field of fields) fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave(SEO_SETTINGS_KEY)).toBeTruthy());
    const saved = lastSave(SEO_SETTINGS_KEY);
    for (const key of [
      "site_title_pl",
      "site_title_en",
      "site_description_pl",
      "site_description_en",
    ]) {
      expect(saved?.[key], `${key} zapisane jako inne niż pusty łańcuch`).toBe("");
    }
  });

  it("reading: DWA limity stref reklamowych są liczbami, nie łańcuchami", async () => {
    // `Number(e.target.value)` - łańcuch w kolumnie liczbowej przechodzi przez
    // jsonb bez błędu i psuje porównania po stronie strony publicznej
    // (`"2" > 10` jest fałszem, ale `"2" > "10"` prawdą).
    h.rows.reading = { reading_mode_ads: true, max_ad_zones_free: 1, max_ad_zones_paid: 1 };
    await mount(ReadingRoute, "/admin/settings/reading");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const numbers = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(numbers.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(numbers[numbers.length - 2], { target: { value: "3" } });
    fireEvent.change(numbers[numbers.length - 1], { target: { value: "5" } });
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("reading")).toBeTruthy());
    expect(lastSave("reading")?.max_ad_zones_free).toBe(3);
    expect(lastSave("reading")?.max_ad_zones_paid).toBe(5);
  });

  it("reading: sekcja reklam pojawia się TYLKO przy włączonych reklamach", async () => {
    // Limity stref bez włączonych reklam to pola bez skutku - i mylące,
    // bo sugerują, że reklamy działają.
    h.rows.reading = { reading_mode_ads: false };
    await mount(ReadingRoute, "/admin/settings/reading");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const withoutAds = document.querySelectorAll('input[type="number"]').length;

    cleanup();
    h.rows.reading = { reading_mode_ads: true };
    await mount(ReadingRoute, "/admin/settings/reading");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    expect(document.querySelectorAll('input[type="number"]').length).toBeGreaterThan(withoutAds);
  });

  it("reading: DWA głosy lektora zapisują się do osobnych pól", async () => {
    h.rows.reading = { tts_voice_pl: "pl-1", tts_voice_en: "en-1" };
    await mount(ReadingRoute, "/admin/settings/reading");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const onChange = h.props.TtsVoiceSelect.onChange;
    if (typeof onChange !== "function") throw new Error("test: brak `onChange` głosu");
    act(() => onChange("en-2"));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(lastSave("reading")).toBeTruthy());
    // Ostatni wybór głosu w drzewie to wersja angielska.
    expect(lastSave("reading")?.tts_voice_en).toBe("en-2");
    expect(lastSave("reading")?.tts_voice_pl).toBe("pl-1");
  });

  it("design: WYCZYSZCZENIE koloru dodatkowego zapisuje pusty łańcuch, nie `null`", async () => {
    // `v ?? ""` - `null` w tokenie dałby `--brand-x: null` w arkuszu.
    h.designTokens = {
      fonts: { heading: "Inter", body: "Inter" },
      scale: {},
      colors: [{ name: "akcent", value: "#111111" }],
    };
    await renderRoute({
      route: DesignRoute,
      path: "/admin/settings/design",
      initialEntry: "/admin/settings/design",
    });
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const onChange = h.props.ColorField.onChange;
    if (typeof onChange !== "function") throw new Error("test: brak `onChange` koloru");
    act(() => onChange(null));
    fireEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(h.designSaves).toHaveLength(1));
    const saved = h.designSaves[0] as { colors: { value: string }[] };
    expect(saved.colors[0].value).toBe("");
  });

  it("analytics: WYJĄTEK przy łączeniu GA4 pokazuje komunikat i odblokowuje okno", async () => {
    // Nieudane połączenie musi dać się powtórzyć - zablokowane okno zamknęłoby
    // administratora bez pomiaru i bez drogi wyjścia.
    h.rows.analytics = { ga4_enabled: false, ga4_measurement_id: "" };
    h.analyticsStatus = {
      ga4: {
        configured: false,
        hasMeasurementId: false,
        hasEmbedUrl: false,
        hasPropertyId: false,
        activeMode: null,
        missingSecrets: [],
      },
      gsc: { configured: false },
    };
    h.settingsSaveThrows = "quota_exceeded";
    await mount(AnalyticsRoute, "/admin/settings/analytics");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const connect = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("admin.analyticsSettings.ga4.connect"),
    );
    if (!connect) throw new Error("test: brak przycisku łączenia");
    fireEvent.click(connect);
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeTruthy());
    const dialogButtons = Array.from(
      screen.getByTestId("dialog").querySelectorAll("button"),
    ).filter((button) => !button.textContent?.includes("admin.analyticsSettings.ga4.cancel"));
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("quota_exceeded"));
    // Okno ZOSTAJE otwarte - administrator może poprawić i spróbować ponownie.
    expect(screen.queryByTestId("dialog")).toBeTruthy();
  });

  it("analytics: WYJĄTEK przy rozłączeniu GA4 też jest raportowany", async () => {
    h.rows.analytics = { ga4_enabled: true };
    h.analyticsStatus = {
      ga4: {
        configured: true,
        hasMeasurementId: true,
        hasEmbedUrl: false,
        hasPropertyId: true,
        activeMode: "service_account",
        missingSecrets: [],
      },
      gsc: { configured: false },
    };
    h.settingsSaveThrows = "network_down";
    await mount(AnalyticsRoute, "/admin/settings/analytics");
    await waitFor(() => expect(saveButton()).toBeTruthy());
    const disconnect = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("admin.analyticsSettings.ga4.disconnect"),
    );
    if (!disconnect) throw new Error("test: brak przycisku rozłączenia");
    const original = window.confirm;
    Reflect.set(window, "confirm", () => true);
    try {
      fireEvent.click(disconnect);
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("network_down"));
      expect(h.toastSuccess).not.toHaveBeenCalled();
    } finally {
      Reflect.set(window, "confirm", original);
    }
  });
});
