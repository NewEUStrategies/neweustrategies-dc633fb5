// Reguły układu archiwum. Archiwa kategorii i tagów to DRUGA najczęściej
// odwiedzana powierzchnia serwisu po wpisach, a do 18.08.2026 13 z 16 ich
// plików stało na zerze.
//
// Te decyzje widać wyłącznie w przeglądarce i wyłącznie na granicy: jedna
// strona wyników, pusta strona, karta wyróżniona wyłączona w ustawieniach,
// wariant magazynowy zjadający pierwsze pięć wpisów. Dokładnie tam mieszkają
// błędy, po których „brakuje wpisów" - i dokładnie tego nie łapią testy
// renderujące pełne archiwum.
import { describe, expect, it } from "vitest";
import {
  MAGAZINE_SECONDARY_COUNT,
  archiveBodyPlan,
  archiveTotalPages,
  magazineSplit,
} from "../bodyPlan";
import { DEFAULT_ARCHIVE_LAYOUT, type ArchiveLayoutSettings } from "@/lib/archive-layout-settings";

type PlanSettings = Parameters<typeof archiveBodyPlan>[0]["settings"];

function settings(over: Partial<ArchiveLayoutSettings> = {}): PlanSettings {
  return { ...DEFAULT_ARCHIVE_LAYOUT, ...over };
}

/** Wpisy jako etykiety - w regułach układu liczy się ICH LICZBA i kolejność. */
const posts = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe("archiveTotalPages", () => {
  it("dzieli z zaokrągleniem w górę - resztka to osobna strona", () => {
    expect(archiveTotalPages(61, 60)).toBe(2);
    expect(archiveTotalPages(120, 60)).toBe(2);
    expect(archiveTotalPages(121, 60)).toBe(3);
  });

  it("archiwum bez wpisów ma JEDNĄ pustą stronę, nie zero", () => {
    // Zero stron dałoby pasek „strona 1 z 0" i licznik wyników bez sensu.
    expect(archiveTotalPages(0, 60)).toBe(1);
  });

  it("rozmiar strony zerowy albo ujemny nie dzieli przez zero", () => {
    expect(archiveTotalPages(100, 0)).toBe(1);
    expect(archiveTotalPages(100, -5)).toBe(1);
  });

  it("liczby spoza zakresu (NaN z URL-a) nie wywracają rachunku", () => {
    expect(archiveTotalPages(Number.NaN, 60)).toBe(1);
    expect(archiveTotalPages(60, Number.NaN)).toBe(1);
    expect(archiveTotalPages(-10, 60)).toBe(1);
  });
});

describe("archiveBodyPlan - karta wyróżniona", () => {
  it("pierwszy wpis wychodzi z siatki na kartę wyróżnioną", () => {
    // Gdyby nie wychodził, ten sam wpis pokazywałby się DWA RAZY: raz jako
    // duża karta, raz jako pierwsza kafelka siatki.
    const plan = archiveBodyPlan({
      settings: settings({ show_featured_top: true }),
      posts: posts(3),
      total: 3,
      pageSize: 60,
    });
    expect(plan.showFeaturedTop).toBe(true);
    expect(plan.featured).toBe("p1");
    expect(plan.gridPosts).toEqual(["p2", "p3"]);
  });

  it("wyłączona w ustawieniach - wszystkie wpisy zostają w siatce", () => {
    const plan = archiveBodyPlan({
      settings: settings({ show_featured_top: false }),
      posts: posts(3),
      total: 3,
      pageSize: 60,
    });
    expect(plan.showFeaturedTop).toBe(false);
    expect(plan.gridPosts).toEqual(["p1", "p2", "p3"]);
  });

  it("pusta strona nie robi karty wyróżnionej z niczego", () => {
    const plan = archiveBodyPlan({
      settings: settings({ show_featured_top: true }),
      posts: [],
      total: 0,
      pageSize: 60,
    });
    expect(plan.showFeaturedTop).toBe(false);
    expect(plan.featured).toBeUndefined();
    expect(plan.gridPosts).toEqual([]);
  });

  it("wariant z WŁASNĄ kartą wyróżnioną wyłącza generyczną", () => {
    // Inaczej magazyn pokazywałby dwie karty wyróżnione jedna nad drugą.
    const plan = archiveBodyPlan({
      settings: settings({ show_featured_top: true }),
      posts: posts(3),
      total: 3,
      pageSize: 60,
      hasCustomFeaturedTop: true,
    });
    expect(plan.showFeaturedTop).toBe(false);
    expect(plan.gridPosts).toEqual(["p1", "p2", "p3"]);
  });

  it("jeden wpis na stronie: karta wyróżniona i PUSTA siatka", () => {
    const plan = archiveBodyPlan({
      settings: settings({ show_featured_top: true }),
      posts: posts(1),
      total: 1,
      pageSize: 60,
    });
    expect(plan.featured).toBe("p1");
    expect(plan.gridPosts).toEqual([]);
  });
});

describe("archiveBodyPlan - kandydat LCP", () => {
  it("pierwsza karta siatki dostaje priorytet, gdy NAD nią nic nie ma", () => {
    const plan = archiveBodyPlan({
      settings: settings({ show_featured_top: false }),
      posts: posts(3),
      total: 3,
      pageSize: 60,
    });
    expect(plan.firstCardPriority).toBe(true);
  });

  it("z kartą wyróżnioną priorytet zostaje przy NIEJ", () => {
    // Dwa obrazy z `fetchpriority=high` walczą o pasmo - przegrywa ten, który
    // czytelnik faktycznie widzi jako pierwszy.
    const plan = archiveBodyPlan({
      settings: settings({ show_featured_top: true }),
      posts: posts(3),
      total: 3,
      pageSize: 60,
    });
    expect(plan.firstCardPriority).toBe(false);
  });

  it("wariant z własną kartą też zabiera priorytet siatce", () => {
    const plan = archiveBodyPlan({
      settings: settings({ show_featured_top: false }),
      posts: posts(3),
      total: 3,
      pageSize: 60,
      hasCustomFeaturedTop: true,
    });
    expect(plan.firstCardPriority).toBe(false);
  });
});

describe("archiveBodyPlan - pasek stron, sidebar, sekcje", () => {
  it("przy jednej stronie wyników paska stron NIE MA", () => {
    const plan = archiveBodyPlan({
      settings: settings(),
      posts: posts(5),
      total: 5,
      pageSize: 60,
    });
    expect(plan.totalPages).toBe(1);
    expect(plan.showPagination).toBe(false);
  });

  it("dokładnie na granicy strony pasek jeszcze się nie pojawia", () => {
    const plan = archiveBodyPlan({
      settings: settings(),
      posts: posts(10),
      total: 60,
      pageSize: 60,
    });
    expect(plan.showPagination).toBe(false);
  });

  it("jeden wpis ponad limit dokłada drugą stronę", () => {
    const plan = archiveBodyPlan({
      settings: settings(),
      posts: posts(10),
      total: 61,
      pageSize: 60,
    });
    expect(plan.totalPages).toBe(2);
    expect(plan.showPagination).toBe(true);
  });

  it("pozycja sidebara przekłada się na stronę układu", () => {
    const left = archiveBodyPlan({
      settings: settings({ show_sidebar: true, sidebar_position: "left" }),
      posts: [],
      total: 0,
      pageSize: 60,
    });
    expect(left.withSidebar).toBe(true);
    expect(left.sidebarLeft).toBe(true);

    const right = archiveBodyPlan({
      settings: settings({ show_sidebar: true, sidebar_position: "right" }),
      posts: [],
      total: 0,
      pageSize: 60,
    });
    expect(right.sidebarLeft).toBe(false);
  });

  it("sekcja powiązanych taksonomii idzie za ustawieniem", () => {
    expect(
      archiveBodyPlan({
        settings: settings({ show_related_taxonomies: true }),
        posts: [],
        total: 0,
        pageSize: 60,
      }).showRelated,
    ).toBe(true);
  });

  it("PODGLĄD ADMINA wyłącza reklamy - zero beaconów z panelu", () => {
    // Podgląd renderuje to samo archiwum co front; bez tej flagi każde wejście
    // administratora w ustawienia liczyłoby się jako odsłona reklamy.
    const preview = archiveBodyPlan({
      settings: settings(),
      posts: posts(3),
      total: 3,
      pageSize: 60,
      previewMode: true,
    });
    expect(preview.withAds).toBe(false);

    const live = archiveBodyPlan({
      settings: settings(),
      posts: posts(3),
      total: 3,
      pageSize: 60,
    });
    expect(live.withAds).toBe(true);
  });
});

describe("magazineSplit", () => {
  it("dzieli na lead, cztery karty obok i resztę do siatki", () => {
    const split = magazineSplit(posts(10), true);
    expect(split.featured).toBe("p1");
    expect(split.secondary).toEqual(["p2", "p3", "p4", "p5"]);
    expect(split.rest).toEqual(["p6", "p7", "p8", "p9", "p10"]);
    expect(split.secondary).toHaveLength(MAGAZINE_SECONDARY_COUNT);
  });

  it("ŻADEN wpis nie ginie po drodze", () => {
    // To jest cała stawka podziału: lead + kolumna + siatka muszą sumować się
    // do wejścia. Wcześniejsza wersja liczyła `rest.slice(4)` na innej tablicy
    // niż ta, z której brała kolumnę - łatwo o wpis wypadający w środku.
    const wejscie = posts(7);
    const split = magazineSplit(wejscie, true);
    expect([split.featured, ...split.secondary, ...split.rest]).toEqual(wejscie);
  });

  it("mniej niż pięć wpisów: kolumna niepełna, siatka pusta", () => {
    const split = magazineSplit(posts(3), true);
    expect(split.secondary).toEqual(["p2", "p3"]);
    expect(split.rest).toEqual([]);
  });

  it("wyłączona karta wyróżniona zsypuje WSZYSTKO do siatki", () => {
    const split = magazineSplit(posts(6), false);
    expect(split.showFeatured).toBe(false);
    expect(split.featured).toBeUndefined();
    expect(split.secondary).toEqual([]);
    expect(split.rest).toEqual(posts(6));
  });

  it("pusta strona nie robi leadu z niczego", () => {
    const split = magazineSplit([], true);
    expect(split.showFeatured).toBe(false);
    expect(split.rest).toEqual([]);
  });

  it("jeden wpis to sam lead, bez kolumny i bez siatki", () => {
    const split = magazineSplit(posts(1), true);
    expect(split.featured).toBe("p1");
    expect(split.secondary).toEqual([]);
    expect(split.rest).toEqual([]);
  });
});
