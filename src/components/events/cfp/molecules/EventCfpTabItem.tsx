// Molekuła: pozycja „Nabór prelegentów" w pasku zakładek wydarzenia.
//
// TYLKO WTEDY, GDY NABÓR JEST OTWARTY - i tylko po montażu. Pasek jest w HTML-u
// każdej strony wydarzenia, a ten bywa podawany z cache krawędzi. Pozycja
// wpisana w SSR przeżyłaby zamknięcie naboru; pozycja liczona w pierwszym
// renderze klienta rozjechałaby hydratację. Dlatego: `null` w SSR i pierwszym
// renderze, potem zapytanie o fazę (tę samą, co strona naboru - jeden wpis
// w cache) i pozycja wyłącznie przy `phase = open`.
//
// KLASY POZYCJI PRZYCHODZĄ OD RODZICA, żeby pozycja wyglądała dokładnie jak
// sąsiednie zakładki (ta sama reguła `activeProps`/`inactiveProps`).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useCfpPublic } from "@/lib/events/useCfpMe";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";
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
  ensureEventCfpI18n();
  const { t } = useTranslation();
  const mounted = useNowMs() !== null;
  const cfpQ = useCfpPublic(slug, mounted);
  if (!mounted || cfpQ.data?.phase !== "open") return null;
  return (
    <li>
      <Link
        to="/events/$slug/cfp"
        params={{ slug }}
        className={className}
        activeProps={{ className: activeClassName }}
        inactiveProps={{ className: inactiveClassName }}
      >
        {t("eventCfp.tab")}
      </Link>
    </li>
  );
}
