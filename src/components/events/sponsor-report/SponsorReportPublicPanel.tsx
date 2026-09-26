// Organizm strony raportu dla sponsora: odczyt tokenu z adresu, wczytanie
// raportu przez funkcję serwerową i jeden z pięciu stanów (wczytywanie, brak
// tokenu, link nieznany, link wygasły/odwołany, błąd) albo gotowy raport.
//
// TOKEN ZNIKA Z PASKA ADRESU. Czytamy go z FRAGMENTU (`#t=`, nie trafia na
// serwer ani do `Referer`) w efekcie - trasa ma `ssr: false`, więc render
// serwera i tak nie widzi fragmentu - i od razu podmieniamy wpis historii na
// czysty adres (`history.replaceState`), żeby poświadczenie nie zostało
// w historii, na zrzucie ekranu ani w zakładce. Token żyje wyłącznie w stanie
// komponentu (ponowienie po błędzie), NIE w cache zapytań.
//
// PONOWIENIE MA SENS TYLKO PRZY BŁĘDZIE I LIMICIE. „Nie znaleziono"
// i „wygasł" to odpowiedzi ostateczne - przycisk „spróbuj ponownie" przy nich
// obiecywałby coś, czego nie ma.
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { SponsorReportPublicView } from "@/components/events/sponsor-report/SponsorReportPublicView";
import { getSponsorReportByToken } from "@/lib/events/sponsorReport.functions";
import { readSponsorReportFragment } from "@/lib/events/sponsorReportLink";
import {
  parseSponsorReportJson,
  type PublicSponsorReportResult,
  type SponsorReportFailure,
} from "@/lib/events/sponsorReportPayload";
import { ensureEventSponsorReportI18n } from "@/lib/i18n-event-sponsor-report";

type PanelState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "done"; result: PublicSponsorReportResult; token: string };

const FAILURE_KEYS: Record<SponsorReportFailure, string> = {
  not_found: "eventSponsorReport.notFound",
  expired: "eventSponsorReport.expired",
  rate_limited: "eventSponsorReport.rateLimited",
  error: "eventSponsorReport.error",
};

const RETRYABLE: ReadonlySet<SponsorReportFailure> = new Set(["rate_limited", "error"]);

export function SponsorReportPublicPanel() {
  ensureEventSponsorReportI18n();
  const { t } = useTranslation();
  const fetchReport = useServerFn(getSponsorReportByToken);
  const token = useRef<string | null>(null);
  const [state, setState] = useState<PanelState>({ status: "loading" });

  const load = useCallback(
    async (value: string) => {
      setState({ status: "loading" });
      try {
        const response = await fetchReport({ data: { token: value } });
        setState({ status: "done", result: parseSponsorReportJson(response.json), token: value });
      } catch {
        setState({ status: "done", result: { ok: false, reason: "error" }, token: value });
      }
    },
    [fetchReport],
  );

  useEffect(() => {
    // StrictMode odpala efekt dwa razy, a za pierwszym razem fragment już
    // znika z adresu - token zapamiętany w referencji wystarcza obu.
    if (token.current === null) {
      token.current = readSponsorReportFragment(window.location.hash);
      if (token.current !== null) {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
    }
    if (token.current === null) {
      setState({ status: "missing" });
      return;
    }
    void load(token.current);
  }, [load]);

  if (state.status === "loading") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("eventSponsorReport.loading")}
      </p>
    );
  }

  if (state.status === "missing") {
    return <p className="text-sm text-muted-foreground">{t("eventSponsorReport.missingToken")}</p>;
  }

  if (!state.result.ok) {
    const reason = state.result.reason;
    return (
      <div className="space-y-3" role="alert">
        <p className="text-sm text-foreground">{t(FAILURE_KEYS[reason])}</p>
        {RETRYABLE.has(reason) ? (
          <Button type="button" variant="outline" onClick={() => void load(state.token)}>
            {t("eventSponsorReport.retry")}
          </Button>
        ) : null}
      </div>
    );
  }

  return <SponsorReportPublicView report={state.result} />;
}
