// Szkielet strony redagowanej w builderze (poziom "template" atomic design).
//
// Strony z buildera są samowystarczalne: mają własny hero, własne nagłówki i
// własne szerokości kontenerów, więc trasa renderuje je "goło" i na pełną
// szerokość - bez dorysowanego `max-w`, breadcrumbów, reklam i bez widocznego
// `h1` z tytułu strony (kanwa buildera 1:1 z opublikowaną stroną).
//
// JEDEN INWARIANT, KTÓRY TEN KOMPONENT PILNUJE: każda taka strona ma DOKŁADNIE
// JEDEN nagłówek poziomu 1.
//   * dokument ma własny `h1` (widget nagłówka z tagiem `h1` albo `<h1>` w
//     treści bogatej) -> nie dorysowujemy nic,
//   * dokument go nie ma -> dorysowujemy `sr-only` `h1` z tytułu strony.
//
// Historia (audyt 2026-08-06, korekta 2): wcześniej `h1.sr-only` był
// BEZWARUNKOWY, co dawało dwa `h1` na stronach z własnym nagłówkiem. Commit
// naprawczy usunął go równie bezwarunkowo i wstawił `aria-label` na
// opakowującym `<div>` - a `aria-label` na elemencie bez roli (`role="generic"`)
// nie jest eksponowany przez czytniki ekranu, więc informacja nie przeniosła
// się do warstwy dostępności, tylko z niej zniknęła. Tu nie ma `aria-label`:
// nazwę strony niesie realny nagłówek.
import type { ReactNode } from "react";

export interface BuilderPageShellProps {
  /** Tytuł strony w aktywnym języku - trafia do `h1`, gdy dokument swojego nie ma. */
  title: string;
  /**
   * Czy dokument buildera renderuje własny nagłówek poziomu 1
   * (`builderDocHasTopHeading` z `@/lib/builder/headings`).
   */
  hasOwnTopHeading: boolean;
  /** `page.header_override` - czyta go warstwa nagłówka witryny (SiteChrome). */
  headerOverride?: string | null;
  /** Wyrenderowany dokument buildera. */
  children: ReactNode;
  /** Warstwy dodatkowe trasy (np. reklamowy FooterSlideup) - poza przepływem treści. */
  footer?: ReactNode;
}

export function BuilderPageShell({
  title,
  hasOwnTopHeading,
  headerOverride,
  children,
  footer,
}: BuilderPageShellProps) {
  return (
    <div
      className="flex flex-col bg-background text-foreground"
      data-page-template="builder"
      data-page-header-override={headerOverride ?? "default"}
    >
      {/* Nagłówek zastępczy stoi PRZED treścią: kolejność dokumentu jest tym,
          co czyta czytnik ekranu i co porządkuje strukturę nagłówków dla
          crawlera. `sr-only` (nie `hidden`, nie `display:none`) - musi zostać
          w drzewie dostępności. */}
      {!hasOwnTopHeading && <h1 className="sr-only">{title}</h1>}
      <div className="flex-1 w-full">{children}</div>
      {footer}
    </div>
  );
}
