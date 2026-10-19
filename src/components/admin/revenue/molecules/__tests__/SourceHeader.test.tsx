// `SourceHeader` - źródło prawdy bytu: kto go edytuje, które pola są czyje,
// gdzie pojawi się ta sama zmiana. Dane z `HUB_SYNC_MANIFEST`.
//
// CO TEN PLIK DOWODZI.
//   1. Każdy ekran-właściciel z manifestu ISTNIEJE w `routeTree.gen.ts`
//      (czytanym jako tekst) - nagłówek nie może prowadzić na 404.
//   2. Każdy właściciel ma ludzką nazwę ekranu (nie surowy adres) w PL i EN -
//      nowy wpis manifestu bez napisu zapala ten test.
//   3. Odnośnik niesie zakładkę modułu w `search` (`/admin/paywall?tab=…`),
//      trasa z parametrem dostaje konkretną wartość, a trasa z parametrem bez
//      wartości (strona KAŻDEGO wpisu) nie udaje jednego miejsca.
//   4. Filtr kolumn pokazuje tylko ekrany-właścicieli tych kolumn.
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { HUB_ENTITY_IDS, HUB_SYNC_MANIFEST } from "@/lib/revenue/syncManifest";
import { axeViolations, summarize } from "@/test/axe";
import { SourceHeader } from "@/components/admin/revenue/molecules/SourceHeader";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

async function renderInRouter(ui: ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const ROUTE_PATHS: ReadonlySet<string> = new Set(
  [...readFileSync("src/routeTree.gen.ts", "utf8").matchAll(/fullPath: '([^']+)'/g)].map(
    (m) => m[1],
  ),
);

describe("manifest właścicieli a drzewo tras", () => {
  const owners = HUB_SYNC_MANIFEST.flatMap((entity) =>
    entity.owners.map((owner) => [entity.id, owner.to] as const),
  );

  it.each(owners)("%s → %s istnieje w routeTree.gen.ts", (_entity, to) => {
    expect(ROUTE_PATHS.has(to) || ROUTE_PATHS.has(`${to}/`), to).toBe(true);
  });
});

describe("SourceHeader", () => {
  it.each(HUB_ENTITY_IDS)("%s: nazwa bytu i ludzkie nazwy ekranów (PL)", async (entity) => {
    await renderInRouter(<SourceHeader entity={entity} />);

    const section = await screen.findByRole("region", { name: /^Źródło prawdy: / });
    expect(section).toHaveAttribute("data-entity", entity);
    // Żaden właściciel nie jest pokazany surowym adresem trasy ani kluczem.
    expect(section.textContent).not.toMatch(/\/admin\/|\/profile\/|adminRevenue\./);
  });

  it("odnośnik do właściciela niesie zakładkę modułu w parametrze search", async () => {
    await renderInRouter(<SourceHeader entity="metering" />);

    const link = await screen.findByRole("link", { name: /Otwórz: Paywall - limit artykułów/ });
    expect(link).toHaveAttribute("href", "/admin/paywall?tab=metering");
  });

  it("trasa z parametrem dostaje konkretną wartość (zakładka huba)", async () => {
    await renderInRouter(<SourceHeader entity="journey" />);

    const link = await screen.findByRole("link", { name: /Otwórz: Hub - ścieżki/ });
    expect(link).toHaveAttribute("href", "/admin/revenue/journeys");
  });

  it("strona KAŻDEGO wpisu nie jest jednym miejscem - bez odnośnika, z wyjaśnieniem", async () => {
    await renderInRouter(<SourceHeader entity="content_access" />);

    const section = await screen.findByRole("region", {
      name: "Źródło prawdy: Reguła dostępu do treści",
    });
    expect(within(section).getByText("Edytujesz w: Edytor wpisu")).toBeInTheDocument();
    expect(within(section).getByText("edycja na stronie każdego elementu")).toBeInTheDocument();
    // Drugi właściciel (wyjątki w Paywallu) ma zwykły odnośnik.
    expect(within(section).getAllByRole("link")).toHaveLength(1);
  });

  it("filtr kolumn: przy zmianie ceny pokazuje tylko ekran-właściciela ceny", async () => {
    const plan = HUB_SYNC_MANIFEST.find((e) => e.id === "access_plan");
    const paywallColumns = plan?.owners.find((o) => o.to === "/admin/paywall")?.columns ?? [];
    expect(paywallColumns.length).toBeGreaterThan(0);

    await renderInRouter(<SourceHeader entity="access_plan" columns={[paywallColumns[0]]} />);

    const section = await screen.findByRole("region", { name: /Plan dostępu i cena/ });
    expect(within(section).getByText("Edytujesz w: Paywall - plany")).toBeInTheDocument();
    expect(within(section).queryByText("Edytujesz w: Członkostwo")).toBeNull();
    expect(within(section).getByText(`Pola: ${paywallColumns[0]}`)).toBeInTheDocument();
    // „Ta sama zmiana pojawi się w…" wymienia WSZYSTKIE miejsca bytu, także
    // te, których kolumny akurat nie dotyczą - tam też zobaczy się wiersz.
    expect(
      within(section).getByText(/Ta sama zmiana pojawi się w: .*Członkostwo/),
    ).toBeInTheDocument();
  });

  it("byt bez ekranu edycji mówi, że zapisuje wyłącznie system", async () => {
    await renderInRouter(<SourceHeader entity="paywall_hit" />);

    const section = await screen.findByRole("region", { name: /Trafienie na paywall/ });
    expect(section).toHaveTextContent("Zapisuje wyłącznie system - ten byt nie ma ekranu edycji.");
    expect(within(section).queryAllByRole("link")).toHaveLength(0);
  });

  it.each(HUB_ENTITY_IDS)("%s: wersja angielska bez surowych adresów", async (entity) => {
    await i18n.changeLanguage("en");
    await renderInRouter(<SourceHeader entity={entity} />);

    const section = await screen.findByRole("region", { name: /^Source of truth: / });
    expect(section.textContent).not.toMatch(/\/admin\/|\/profile\/|adminRevenue\./);
  });

  it("nie ma naruszeń dostępności (PL i EN)", async () => {
    const pl = await renderInRouter(<SourceHeader entity="membership_tier" />);
    await screen.findByRole("region");
    expect(summarize(await axeViolations(pl.container))).toBe("");
    cleanup();

    await i18n.changeLanguage("en");
    const en = await renderInRouter(<SourceHeader entity="content_access" />);
    await screen.findByRole("region");
    expect(summarize(await axeViolations(en.container))).toBe("");
  });
});
