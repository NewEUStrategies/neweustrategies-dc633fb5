// Atom: ODNOŚNIK DO PODSTRONY WYDARZENIA - jeden warunek na cały front.
//
// PO CO ISTNIEJE. Pozycja menu wydarzenia ma DWA możliwe adresy i wybór między
// nimi jest jedną regułą, nie trzema:
//
//   * pozycja MODUŁOWA (`event_pages.module` niepuste) idzie do trasy
//     dedykowanej `/events/<slug>/<module>`. Tam pod dokumentem strony CMS
//     stoją dane z bazy - lista uczestników, siatka prelegentów, program.
//     Adres splata pokazałby sam wstęp, bez ani jednego wiersza danych;
//   * pozycja ZWYKŁA (znacznik `NULL`) idzie tam, gdzie zawsze: pod pełną
//     ścieżkę strony w trasie splat (`src/routes/$.tsx`).
//
// GDYBY TEN WARUNEK STAŁ W KAŻDYM SPISIE Z OSOBNA (pasek zakładek, spis sekcji
// na stronie głównej, menu list/grid), pierwsza zmiana reguły rozjechałaby trzy
// nawigacje jednego wydarzenia - a rozjazd byłoby widać dopiero po kliknięciu.
//
// `to="/$"`, A NIE `href`: przejście ma zostać w routerze i nie przeładowywać
// aplikacji. `path` z RPC jest CAŁĄ ścieżką strony (RPC składa ją rekurencyjnie
// z łańcucha slugów rodziców), więc splat dostaje ją bez doklejania czegokolwiek.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { EVENT_MODULE_ROUTE, eventModuleOf } from "@/lib/events/eventModules";
import type { EventMenuItem } from "@/lib/events/publicEventApi";

export function EventPageLink({
  item,
  eventSlug,
  className,
  activeProps,
  inactiveProps,
  children,
}: {
  item: EventMenuItem;
  /** Slug wydarzenia - parametr trasy dedykowanej. */
  eventSlug: string;
  className?: string;
  /** Nadpisania dla pozycji aktywnej (pasek zakładek); reszta spisów ich nie używa. */
  activeProps?: { className?: string };
  /**
   * Nadpisania dla pozycji NIEBIEŻĄCEJ - drugi bok `activeProps`.
   *
   * PO CO OSOBNY PROPS, A NIE KLASA BAZOWA. Router skleja `className`
   * z `activeProps.className` zwykłą spacją, bez `tailwind-merge`, więc kolor
   * wyciszony wpisany do klasy bazowej współistniałby na bieżącym odnośniku
   * z kolorem aktywnym i o wyniku decydowałaby kolejność w arkuszu. Ten props
   * jest jedyną drogą, żeby na węźle stała DOKŁADNIE JEDNA klasa koloru
   * (pełne uzasadnienie: `EventTabsBar`).
   */
  inactiveProps?: { className?: string };
  children: ReactNode;
}) {
  const module = eventModuleOf(item.module);

  if (module === null) {
    return (
      <Link
        to="/$"
        params={{ _splat: item.path }}
        className={className}
        activeProps={activeProps}
        inactiveProps={inactiveProps}
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      to={EVENT_MODULE_ROUTE[module]}
      params={{ slug: eventSlug }}
      className={className}
      activeProps={activeProps}
      inactiveProps={inactiveProps}
    >
      {children}
    </Link>
  );
}
