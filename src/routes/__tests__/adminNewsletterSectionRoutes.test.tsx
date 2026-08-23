// Dziesięć cienkich tras sekcji `/admin/newsletter/*` - samo SKLEJENIE.
//
// Każdy z tych plików ma 6-8 linii i dokładnie jedną decyzję: KTÓRY panel
// podpina pod ten adres (a dwie z nich dodatkowo: z jakim wariantem). Powstały
// przez skopiowanie jednego wzorca, więc jedyny realny sposób, w jaki mogą być
// zepsute, to zapomniana podmiana importu albo propa - i wtedy operator widzi
// pod adresem „subskrybenci" panel dostarczalności, a suita jest zielona, bo
// oba panele mają własne, przechodzące testy.
//
// Dlatego dowód jest tu wąski i celowo taki: znacznik panelu pod adresem,
// przekierowanie z korzenia sekcji i wariant buildera. Zachowanie samych paneli
// należy do `src/components/admin/newsletter/__tests__/` (28 plików).
//
// DOSTĘPU te trasy nie pilnują i pilnować nie mają: robi to wspólny layout
// `/admin` (`isStaff`), którego bramka żyje w `adminRouteAuthority.gate.test.ts`.
// Ten plik chroni STAN i SKLEJENIE, nie autorytet.
import { describe, expect, it, vi } from "vitest";

import { renderRoute } from "@/test/routeHarness";

/** Znacznik zamiast prawdziwego panelu - test dotyczy podpięcia, nie treści. */
function marker(name: string) {
  return () => <div data-testid={`panel-${name}`} />;
}

vi.mock("@/components/admin/newsletter/SubscribersPanel", () => ({
  SubscribersPanel: marker("subscribers"),
}));
vi.mock("@/components/admin/newsletter/deliverability/DeliverabilityPanel", () => ({
  DeliverabilityPanel: marker("deliverability"),
}));
vi.mock("@/components/admin/newsletter/auth-logs/AuthEmailLogsPanel", () => ({
  AuthEmailLogsPanel: marker("auth-logs"),
}));
vi.mock("@/components/admin/newsletter/system-emails/SystemEmailsPanel", () => ({
  SystemEmailsPanel: marker("system-emails"),
}));
vi.mock("@/components/admin/newsletter/system-emails/TxEmailContentPanel", () => ({
  TxEmailContentPanel: marker("email-content"),
}));
vi.mock("@/components/admin/newsletter/system-emails/AuthEmailPreviewPanel", () => ({
  AuthEmailPreviewPanel: marker("email-preview"),
}));
vi.mock("@/components/admin/newsletter/builder/NewsletterBuilder", () => ({
  NewsletterBuilder: ({ variant }: { variant: string }) => (
    <div data-testid="panel-builder" data-variant={variant} />
  ),
}));

import { Route as AuthLogsRoute } from "@/routes/admin.newsletter.auth-logs";
import { Route as CampaignsLayoutRoute } from "@/routes/admin.newsletter.campaigns";
import { Route as DeliverabilityRoute } from "@/routes/admin.newsletter.deliverability";
import { Route as EmailContentRoute } from "@/routes/admin.newsletter.email-content";
import { Route as EmailPreviewRoute } from "@/routes/admin.newsletter.email-preview";
import { Route as IndexRoute } from "@/routes/admin.newsletter.index";
import { Route as InlineRoute } from "@/routes/admin.newsletter.inline";
import { Route as PopupRoute } from "@/routes/admin.newsletter.popup";
import { Route as SubscribersRoute } from "@/routes/admin.newsletter.subscribers";
import { Route as SystemEmailsRoute } from "@/routes/admin.newsletter.system-emails";

/** Trasa sekcji, jej adres w drzewie i znacznik panelu, który MA się pokazać. */
const SECTIONS = [
  {
    nazwa: "subskrybenci",
    route: SubscribersRoute,
    path: "/admin/newsletter/subscribers",
    panel: "panel-subscribers",
  },
  {
    nazwa: "dostarczalność",
    route: DeliverabilityRoute,
    path: "/admin/newsletter/deliverability",
    panel: "panel-deliverability",
  },
  {
    nazwa: "dziennik maili autoryzacyjnych",
    route: AuthLogsRoute,
    path: "/admin/newsletter/auth-logs",
    panel: "panel-auth-logs",
  },
  {
    nazwa: "maile systemowe",
    route: SystemEmailsRoute,
    path: "/admin/newsletter/system-emails",
    panel: "panel-system-emails",
  },
  {
    nazwa: "treść maili transakcyjnych",
    route: EmailContentRoute,
    path: "/admin/newsletter/email-content",
    panel: "panel-email-content",
  },
  {
    nazwa: "podgląd maili autoryzacyjnych",
    route: EmailPreviewRoute,
    path: "/admin/newsletter/email-preview",
    panel: "panel-email-preview",
  },
] as const;

describe("sekcje /admin/newsletter/* - właściwy panel pod właściwym adresem", () => {
  it.each(SECTIONS)("$nazwa pokazuje swój panel", async ({ route, path, panel }) => {
    const { getByTestId } = await renderRoute({ route, path, initialEntry: path });

    expect(getByTestId(panel)).toBeTruthy();
  });

  it("każda sekcja podpina INNY panel - kanarek na skopiowanym imporcie", async () => {
    // Zapomniana podmiana importu przy kopiowaniu wzorca dałaby dwa adresy
    // pokazujące ten sam panel: operator klika „dostarczalność", dostaje
    // subskrybentów i nie ma jak zauważyć, że to nie jest ten ekran.
    const widziane: string[] = [];
    for (const sekcja of SECTIONS) {
      const { container, unmount } = await renderRoute({
        route: sekcja.route,
        path: sekcja.path,
        initialEntry: sekcja.path,
      });
      const node = container.querySelector("[data-testid^='panel-']");
      widziane.push(node?.getAttribute("data-testid") ?? "brak");
      unmount();
    }

    expect(widziane).toEqual(SECTIONS.map((s) => s.panel));
    expect(new Set(widziane).size).toBe(SECTIONS.length);
  });
});

describe("builder newslettera - wariant inline kontra popup", () => {
  it.each([
    ["inline", InlineRoute, "/admin/newsletter/inline"],
    ["popup", PopupRoute, "/admin/newsletter/popup"],
  ] as const)("adres %s przekazuje builderowi swój wariant", async (wariant, route, path) => {
    // Zamiana wariantów oznacza edycję popupu pod adresem formularza inline:
    // redaktor zapisuje zmiany „nie tam", gdzie patrzy, i widzi je dopiero
    // na żywej stronie.
    const { getByTestId } = await renderRoute({ route, path, initialEntry: path });

    expect(getByTestId("panel-builder").getAttribute("data-variant")).toBe(wariant);
  });
});

describe("korzeń sekcji i layout kampanii", () => {
  it("`/admin/newsletter/` przekierowuje na przegląd, zamiast pokazywać pustkę", () => {
    // Bez tego korzeń sekcji jest białą stroną - wygląda jak awaria panelu.
    const beforeLoad = IndexRoute.options.beforeLoad;
    expect(typeof beforeLoad).toBe("function");

    let rzucone: unknown = null;
    try {
      // Trasa przekierowująca nie czyta kontekstu, więc wywołanie bez niego
      // przechodzi przez CAŁE ciało `beforeLoad`.
      (beforeLoad as () => void)();
    } catch (error) {
      rzucone = error;
    }

    expect(rzucone).not.toBeNull();
    expect(JSON.stringify(rzucone)).toContain("/admin/newsletter/overview");
  });

  it("layout kampanii renderuje potomka, a nie własną treść", async () => {
    // `campaigns.tsx` to sam `<Outlet/>`: gdyby dołożyć tu treść, pokazywałaby
    // się nad KAŻDĄ podstroną kampanii, także nad edytorem.
    const { container } = await renderRoute({
      route: CampaignsLayoutRoute,
      path: "/admin/newsletter/campaigns",
      initialEntry: "/admin/newsletter/campaigns",
    });

    expect(container.textContent).toBe("");
  });
});
