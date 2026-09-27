// Molekuła: pozycja „Nabór prelegentów" w pasku zakładek wydarzenia.
//
// TYLKO WTEDY, GDY NABÓR JEST OTWARTY - i tylko po montażu. Pasek jest w HTML-u
// każdej strony wydarzenia, a ten bywa podawany z cache krawędzi. Pozycja
// wpisana w SSR przeżyłaby zamknięcie naboru; pozycja liczona w pierwszym
// renderze klienta rozjechałaby hydratację. Dlatego: `null` w SSR i pierwszym
// renderze, potem zapytanie o fazę i pozycja wyłącznie przy `phase = open`.
//
// LEKKA Z ZAMIARU: jedzie w chunku powłoki, czyli na KAŻDEJ stronie wydarzenia.
// Napis jest w słowniku frontu (`eventFront.cfp.tab`), który powłoka ładuje
// i tak, a faza przychodzi z `useCfpShell` - bez słownika naboru (~10 KB gzip)
// i bez parserów jego strony. Te dociąga dopiero strona naboru po kliknięciu.
//
// KLASY POZYCJI PRZYCHODZĄ OD RODZICA, żeby pozycja wyglądała dokładnie jak
// sąsiednie zakładki (ta sama reguła `activeProps`/`inactiveProps`).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useCfpTabOpen } from "@/lib/events/useCfpShell";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import { useNowMs } from "@/lib/time/useNowMs";

export function EventCfpTabItem({
  slug,
  className,
  activeClassName,
  inactiveClassName,
}: {
  slug: string;
  className: string;
  activeClassName: string;
  inactiveClassName: string;
}) {
  ensureEventFrontI18n();
  const { t } = useTranslation();
  const mounted = useNowMs() !== null;
  const open = useCfpTabOpen(slug, mounted);
  if (!mounted || !open) return null;
  return (
    <li>
      <Link
        to="/events/$slug/cfp"
        params={{ slug }}
        className={className}
        activeProps={{ className: activeClassName }}
        inactiveProps={{ className: inactiveClassName }}
      >
        {t("eventFront.cfp.tab")}
      </Link>
    </li>
  );
}
