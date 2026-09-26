// Wspolny zestaw przypadkow dla CIENKIEJ trasy sekcji studia wydarzenia.
//
// PO CO. Fundament funkcji organizatora zaklada z gory osiem ekranow studia
// (nabor prelegentow, faktury, plan sali, lejek reklam, raport sponsora), a
// kazdy z nich wypelnia potem INNY agent. Kontrakt trasy jest jednak dla
// wszystkich ten sam i ma zostac ten sam po podmianie ciala:
//   * `head()` trzyma studio poza wyszukiwarka (angielski tytul + noindex);
//   * wiersz wydarzenia bierze z parametru SCIEZKI (zgubiony `$eventId`
//     pokazalby dane cudzego wydarzenia);
//   * dopoki wiersza nie ma - milczy (spinner i "nie znaleziono" ma rama);
//   * tytul ekranu to TEN SAM klucz, co etykieta w sidebarze.
// Plik testowy funkcji wola `describeStudioSectionRoute(...)` raz na trase;
// atrapy (`vi.mock`) zostaja w pliku testowym, bo tylko tam sa podnoszone.
import { cleanup, screen, waitFor } from "@testing-library/react";
import type { AnyRoute } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";

import { renderRoute, routeHead } from "@/test/routeHarness";
import type { SupabaseRpcStub } from "@/test/supabase/rpc";

export const STUDIO_ROUTE_EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";

export interface StudioSectionRouteSpec {
  /** Trasa (`Route` z pliku w `src/routes`). */
  route: AnyRoute;
  /** Wzorzec adresu, np. `/admin/events/$eventId/cfp/settings`. */
  path: string;
  /** Klucz sekcji studia = ostatni czlon klucza etykiety w sidebarze. */
  sectionKey: string;
  /** Oczekiwany angielski tytul dokumentu. */
  documentTitle: string;
  /** Atrapa RPC ustawiana w `beforeEach` pliku testowego. */
  rpc: () => SupabaseRpcStub;
}

function detailRow(): Record<string, string> {
  return {
    id: STUDIO_ROUTE_EVENT_ID,
    title_pl: "Kongres Energetyczny",
    title_en: "Energy Congress",
  };
}

function metaEntries(route: AnyRoute): Record<string, unknown>[] {
  return (routeHead(route).meta ?? []) as Record<string, unknown>[];
}

export function describeStudioSectionRoute(spec: StudioSectionRouteSpec): void {
  const entry = spec.path.replace("$eventId", STUDIO_ROUTE_EVENT_ID);
  const titleKey = `adminEvents.studio.sections.${spec.sectionKey}`;

  describe(`${spec.path} - cienka trasa sekcji studia`, () => {
    afterEach(cleanup);

    it("naglowek dokumentu trzyma studio POZA wyszukiwarka", () => {
      const entries = metaEntries(spec.route);
      expect(entries.find((item) => "title" in item)?.title).toBe(spec.documentTitle);
      expect(entries.find((item) => item.name === "robots")?.content).toBe("noindex, nofollow");
      expect(String(entries.find((item) => item.name === "description")?.content)).not.toBe("");
    });

    it("pokazuje ekran pod TYM SAMYM kluczem, co etykieta w sidebarze, dla wydarzenia ze sciezki", async () => {
      spec.rpc().setData("admin_event_detail", [detailRow()]);

      await renderRoute({ route: spec.route, path: spec.path, initialEntry: entry });

      await waitFor(() =>
        expect(screen.getByRole("heading", { level: 1, name: titleKey })).toBeInTheDocument(),
      );
      expect(spec.rpc().lastCall("admin_event_detail")?.arg("p_event_id")).toBe(
        STUDIO_ROUTE_EVENT_ID,
      );
    });

    it("wydarzenie NIEZNALEZIONE zostawia trase pusta - komunikat nalezy do ramy studia", async () => {
      spec.rpc().setData("admin_event_detail", []);

      const { container } = await renderRoute({
        route: spec.route,
        path: spec.path,
        initialEntry: entry,
      });

      await waitFor(() => expect(spec.rpc().callsFor("admin_event_detail")).toHaveLength(1));
      expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
      expect(container.textContent).toBe("");
    });
  });
}
