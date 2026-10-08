import { useQuery } from "@tanstack/react-query";
import { lazy, memo, Suspense, useEffect, useMemo, useRef } from "react";
import { ChromeDataGate } from "@/lib/ssr/chromeWarmup";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/builder/organisms/BuilderRenderer";
import { defaultDocFor } from "@/lib/builder/chromeDefaults";
import type { BuilderDocument } from "@/lib/builder/types";
import {
  FooterChromeSchema,
  defaultFooterChrome,
  type FooterChrome,
} from "@/lib/theme/footerSettings";
import { BackToTop } from "@/components/footer/BackToTop";
import { RenderErrorBoundary } from "@/components/error/RenderErrorBoundary";
import { LegalLinks } from "@/components/footer/LegalLinks";
import { trackFooterLink, trackFooterNewsletterSubmit } from "@/lib/analytics/footerTracking";
import { FOOTER_LINKS, type FooterLinkGroup } from "@/lib/seo/footerNavigation";
import { useLang } from "@/lib/i18n/useLang";
import { HydrationIsland, islandChunksFor } from "@/lib/performance/hydrationIsland";
import { SECTION_ISLAND_TRIGGER, sectionIslandInfo } from "@/lib/builder/sectionStreaming";

/**
 * STOPKA JEDNĄ WYSPĄ HYDRATACJI (P2.2). Stopka to pełny dokument buildera na
 * każdej stronie i zawsze poniżej zgięcia, a jej hydratacja (renderer,
 * widgety, subskrypcje zapytań, leniwe formularze) szła dotąd w commicie
 * hydratacji strony. Renderer stopki jest teraz wyspą (`hydrationIsland.tsx`):
 * HTML serwera zostaje, a hydratacja rusza przy widoczności (ekran zapasu w
 * dół), pierwszej interakcji (kolejka P0.3, po jednej wyspie na klatkę),
 * dotknięciu lub fokusie we wnętrzu, w punkcie ciszy - albo od razu przy
 * zapisanej sesji. `<footer>` z nasłuchem telemetrii linków i `BackToTop`
 * (pływający przycisk) zostają POZA wyspą i hydratują jak dotąd: telemetria
 * łapie klik w fazie capture na `<footer>`, także w nieuwodnionej treści.
 * Dzieci wyspy to `doc` (stała referencja z ustawień, `useMemo` niżej) i
 * język - re-render stopki kończy się na `memo` wyspy przed jej granicą.
 * Wyzwalacze i typy widgetów (klucze rejestru chunków) - te same co w
 * wyspach sekcji treści (`sectionStreaming.tsx`).
 */

/**
 * LISTWA PRAWNA NIEZALEŻNA OD DOKUMENTU BUILDERA. Regulamin, polityka
 * prywatności, zwroty, cookies i RODO muszą być osiągalne z każdej strony
 * (wymóg operatora płatności), także gdy redakcja przebuduje stopkę
 * w builderze - dlatego listwa idzie z rejestru `FOOTER_LINKS`, a nie
 * z dokumentu. Dawny `CopyrightBar` zszedł ze stopki 2026-09-08 (commity
 * 5b6b114e i 50aaf602, bez uzasadnienia) i z nim zniknęły te linki; listwa nie
 * powtarza wiersza praw autorskich, który dokument stopki ma własny.
 *
 * SERWER RENDERUJE JĄ STATYCZNIE (linki w HTML-u SSR - SEO i zgodność),
 * KLIENT DOCIĄGA JĄ RAZEM Z WYSPĄ. `import.meta.env.SSR` Vite podmienia na
 * literał, więc w bundlu klienta zostaje sam `lazy()`, a statyczny import
 * czystego modułu znika - domknięcie bootu strony głównej nie rośnie o kod
 * listwy, tylko o ten `lazy()` (nazwany chunk `legal-links` w obu
 * konfiguracjach Vite - bez nazwy łączenie małych chunków wkleja listwę
 * z powrotem do wejścia). Chunk jest podany wyspie w `chunks` (kontrakt
 * `hydrationIsland`: każdy `React.lazy` w wyspie jako komponent), więc wyspa
 * go gruntuje przed hydratacją i HTML serwera hydratuje bez zawieszenia. Własna granica
 * `Suspense` chroni dokument stopki przy świeżym montażu po nawigacji SPA
 * (np. z /admin): stopka nie znika na czas pobierania listwy, a listwa
 * dochodzi na samym dole, pod wszystkim, więc niczego nie przesuwa.
 *
 * KOSZT: jedno żądanie chunku `legal-links-*.js` (~0,5 KB gzip, cache
 * `immutable`) na odsłonę, gdy wyspa stopki się otwiera (widoczność,
 * interakcja albo punkt ciszy - zwykle zaraz po boocie, także bez
 * przewijania), poza ścieżką do LCP. Wyspa czeka na ten chunk przed
 * hydratacją stopki. Świadomie: kilkaset bajtów poza domknięciem bootu
 * zamiast kodu listwy w chunku wejściowym każdej strony. Danych listwa nie
 * czyta (rejestr w kodzie, język z `useLang`). Preloadu zależności chunk nie
 * ma (`modulePreload.resolveDependencies` w obu konfiguracjach Vite): importuje
 * wyłącznie chunki vendorowe, które boot już załadował.
 *
 * AWARIA CHUNKU DEGRADUJE DO BRAKU LISTWY, NIE DO EKRANU BŁĘDU.
 * `RenderErrorBoundary` łapie odrzucony import (`React.lazy` rzuca nim przy
 * renderze): React porzuca HTML listwy (najbliższa granica `Suspense`),
 * granica renderuje pusty, ukryty znacznik i raportuje błąd, a dokument
 * stopki, treść i nagłówek zostają. Bez tej granicy wyjątek dochodził do
 * globalnego `ErrorBoundary` korzenia i podmieniał CAŁĄ stronę. Osobno
 * wyspa zgłasza odrzucony chunk (`reportError`), a globalna siatka
 * `cacheBusting.ts` robi na każdy chunk-load error JEDNO twarde przeładowanie
 * (`?_v=`) - celowo, dla dokumentu sprzed wdrożenia, którego chunków już nie
 * ma. Kolejne przeładowanie w ciągu 15 s blokuje strażnik w `sessionStorage`,
 * więc przy trwałej awarii strona po jednym przeładowaniu zostaje - bez listwy
 * (przy zablokowanym `sessionStorage` strażnik nie działa - stan siatki sprzed
 * tej zmiany, wspólny dla każdego leniwego chunku).
 */
const LegalLinksChunk = lazy(() => import("@/components/footer/LegalLinks"));

type FooterSettings = {
  builder_data?: BuilderDocument | null;
  chrome?: Partial<FooterChrome>;
};

interface FooterProps {
  compact?: boolean;
}

function FooterInner({ compact }: FooterProps) {
  // URL-seeded language: SSR-safe first render + synchronous re-render on
  // language switch, without the i18n.language hydration-flicker window.
  const lang = useLang();

  const { data: settingsMap } = useQuery(siteSettingsQueryOptions);
  // `resolveSetting` robi głęboki merge, więc bez `useMemo` oddawałoby NOWY
  // obiekt przy każdym renderze stopki - a od jego tożsamości zależy zarówno
  // walidacja chrome'u niżej, jak i dokument podawany `BuilderRenderer`owi.
  const cfg = useMemo(
    () => resolveSetting<FooterSettings>(settingsMap, "footer", {}),
    [settingsMap],
  );

  // While settings are loading (should be rare - __root prefetches them via
  // ensureQueryData), render the built-in default footer instead of a blank
  // gap. This keeps SSR HTML stable and avoids a "no footer -> real footer"
  // layout shift after hydration.
  //
  // `useMemo`: domyślny dokument powstaje od nowa przy każdym wywołaniu
  // `defaultDocFor`, a dokument jest dzieckiem wyspy stopki - nowa referencja
  // przy każdym renderze stopki docierałaby do jej odwodnionej granicy (P2.2).
  const builderData = cfg.builder_data;
  const doc = useMemo(
    () => (builderData && builderData.sections?.length ? builderData : defaultDocFor("footer")),
    [builderData],
  );

  // Chunki leniwych widgetów stopki i listwy prawnej dla bramki wyspy
  // (czytane przy montażu).
  const islandChunks = useMemo(
    () =>
      islandChunksFor(
        (Array.isArray(doc.sections) ? doc.sections : []).flatMap((section) =>
          section ? sectionIslandInfo(section).widgetTypes : [],
        ),
      ).concat(LegalLinksChunk),
    [doc],
  );

  // Stopka jedzie na KAŻDEJ stronie, a ta walidacja Zodem biegła w każdym jej
  // renderze - także wtedy, gdy ustawienia się nie zmieniły. Parsowanie zależy
  // wyłącznie od `cfg.chrome`, więc jego wynik trzymamy do zmiany ustawień.
  const chromeCfg = useMemo(() => {
    const parsed = FooterChromeSchema.safeParse({
      ...defaultFooterChrome(),
      ...(cfg.chrome ?? {}),
    });
    return parsed.success ? parsed.data : defaultFooterChrome();
  }, [cfg.chrome]);

  const footerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      const isExternal = /^https?:\/\//i.test(href) && !href.includes(window.location.host);
      const registry = FOOTER_LINKS.find((l) => l.href === href);
      const group: FooterLinkGroup | "unknown" = registry?.group ?? "unknown";
      const label = anchor.textContent?.trim() || href;
      trackFooterLink({ href, label, group, external: isExternal });
    };
    const onSubmit = (ev: SubmitEvent) => {
      const form = ev.target as HTMLFormElement | null;
      if (!form) return;
      const isNewsletter =
        form.matches("[data-newsletter-form]") || form.querySelector("input[type='email']") != null;
      if (!isNewsletter) return;
      trackFooterNewsletterSubmit("success", { form_id: form.id || undefined });
    };
    el.addEventListener("click", onClick, { capture: true });
    el.addEventListener("submit", onSubmit, { capture: true });
    return () => {
      el.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
      el.removeEventListener("submit", onSubmit, { capture: true } as EventListenerOptions);
    };
  }, []);

  if (compact) {
    return null;
  }

  if (!doc?.sections?.length) {
    return chromeCfg.back_to_top ? (
      <BackToTop thresholdPx={chromeCfg.back_to_top_threshold_px} />
    ) : null;
  }

  return (
    <>
      <footer
        ref={footerRef}
        data-site-footer
        data-footer-layout={chromeCfg.layout}
        // cv-auto: the footer is below the fold on load - skipping its
        // layout/paint until the reader nears it is a real first-paint win on
        // every page (the footer is a full builder document of its own).
        className="cv-auto"
        style={{ viewTransitionName: "site-footer" }}
      >
        <HydrationIsland id="site-footer" trigger={SECTION_ISLAND_TRIGGER} chunks={islandChunks}>
          <BuilderRenderer doc={doc} lang={lang} />
          <RenderErrorBoundary label="footer:legal-links">
            <Suspense fallback={null}>
              {import.meta.env.SSR ? (
                <LegalLinks links={FOOTER_LINKS} lang={lang} />
              ) : (
                <LegalLinksChunk links={FOOTER_LINKS} lang={lang} />
              )}
            </Suspense>
          </RenderErrorBoundary>
        </HydrationIsland>
      </footer>
      {chromeCfg.back_to_top ? (
        <BackToTop thresholdPx={chromeCfg.back_to_top_threshold_px} />
      ) : null}
    </>
  );
}

export const Footer = memo(function Footer(props: FooterProps) {
  return (
    <Suspense fallback={<footer data-site-footer aria-busy="true" className="cv-auto min-h-40" />}>
      <ChromeDataGate>
        <FooterInner {...props} />
      </ChromeDataGate>
    </Suspense>
  );
});

Footer.displayName = "Footer";
