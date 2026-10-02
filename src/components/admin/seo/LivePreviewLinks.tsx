// Molekuła: rzeczywisty adres strony + cztery wyjścia „na żywo".
//
// Podgląd w panelu rysuje to, co WYŚLEMY. Ten pasek pokazuje to, co świat
// FAKTYCZNIE widzi pod tym adresem: samą stronę, wynik Google (`site:`),
// kartę czytaną przez Facebooka i kartę czytaną przez LinkedIna. Wszystko
// w nowym oknie, żeby niezapisany formularz nie zniknął pod nawigacją.
//
// ADRES JEST PER-TENANT: origin liczy `useTenantPublicOrigin()` (domena
// tenanta z bazy, inaczej reguła `crawlerPublishOrigin` dla hosta karty), więc
// admin tenanta z własną domeną nie wysyła walidatorów na stronę marki.
// Molekuła liczy origin SAMA, a nie bierze go propem - jest osadzona także
// w panelu SEO edytora treści, i każdy rodzic musiałby inaczej pamiętać o tym
// samym argumencie.
//
// TENANT BEZ PUBLICZNEJ DOMENY (`origin === null`) nie dostaje linków na
// markę: zamiast adresu i walidatorów molekuła mówi, że adresu jeszcze nie ma.
import { useTranslation } from "react-i18next";
import { ExternalLink } from "@/lib/lucide-shim";
import { useTenantPublicOrigin } from "@/lib/seo/useTenantPublicOrigin";
import {
  facebookDebuggerUrl,
  googleResultUrl,
  linkedinInspectorUrl,
  livePageUrl,
} from "@/lib/seo/liveValidatorLinks";
// Komunikat o braku domeny mieszka w nakładce kokpitu - molekuła jest osadzona
// także w edytorze treści, gdzie nakładka nie musi być już wczytana.
import "@/lib/i18n-admin-seo-hub";

interface LivePreviewLinksProps {
  /** Ścieżka bez originu, np. "" (strona główna), "en", "blog/moj-wpis". */
  path: string;
  className?: string;
}

const LINK_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 " +
  "text-xs font-medium text-foreground/90 transition-colors hover:border-brand hover:text-brand";

export function LivePreviewLinks({ path, className }: LivePreviewLinksProps) {
  const { t } = useTranslation();
  const origin = useTenantPublicOrigin();
  if (origin === null) {
    return (
      <p className={`text-xs text-muted-foreground ${className ?? ""}`} data-live-no-domain>
        {t("adminSeoHub.noPublicDomain")}
      </p>
    );
  }
  const url = livePageUrl(path, origin);
  const targets: readonly {
    readonly key: string;
    readonly href: string;
    readonly label: string;
  }[] = [
    { key: "page", href: url, label: t("admin.seo.live.openPage") },
    { key: "google", href: googleResultUrl(url), label: t("admin.seo.live.google") },
    { key: "facebook", href: facebookDebuggerUrl(url), label: t("admin.seo.live.facebook") },
    { key: "linkedin", href: linkedinInspectorUrl(url), label: t("admin.seo.live.linkedin") },
  ];
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("admin.seo.live.address")}:</span>{" "}
        <span className="break-all">{url}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {targets.map((target) => (
          <a
            key={target.key}
            href={target.href}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {target.label}
          </a>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">{t("admin.seo.live.hint")}</p>
    </div>
  );
}
