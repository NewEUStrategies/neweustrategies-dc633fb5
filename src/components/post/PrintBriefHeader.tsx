// Markowa rama POLICY BRIEF widoczna wyłącznie w druku / "Zapisz jako PDF"
// (A2). Ekran jej nie renderuje (klasa print-only, patrz src/styles.css);
// przycisk Drukuj/PDF w pasku udostępniania (window.print) produkuje dzięki
// temu dokument z tożsamością NES: pasek marki + typ dokumentu nad tytułem
// wpisu, linia źródła oraz stopka marki powtarzana na każdej stronie.
//
// Tytuł, autorzy i data NIE są tu duplikowane - drukuje je istniejący
// nagłówek wpisu (PostLayoutRenderer) zaraz pod ramą. Deploy na workerze
// (Cloudflare) wyklucza serwerowy Chromium, więc "silnikiem PDF" jest
// przeglądarka czytelnika - warstwa markowa to czysty CSS/HTML.
import { SITE_NAME } from "@/lib/seo/meta";

const LABELS = {
  pl: { docType: "Analiza", source: "Źródło" },
  en: { docType: "Analysis", source: "Source" },
} as const;

export interface PrintBriefHeaderProps {
  lang: "pl" | "en";
  /** Kanoniczny absolutny URL (linia źródła + stopka). */
  url: string;
}

export function PrintBriefHeader({ lang, url }: PrintBriefHeaderProps) {
  const t = LABELS[lang];
  return (
    <>
      <header className="print-only print-brief-header" aria-hidden="true">
        <div className="print-brief-brand">
          <span className="print-brief-logo">{SITE_NAME}</span>
          <span className="print-brief-doctype">{t.docType}</span>
        </div>
        <p className="print-brief-source">
          {t.source}: {url}
        </p>
      </header>
      {/* Stopka marki powtarzana na każdej stronie wydruku (position:fixed
          w @media print drukuje się na każdym arkuszu w Chromium/WebKit). */}
      <div className="print-only print-brief-footer" aria-hidden="true">
        <span>{SITE_NAME}</span>
        <span>{url.replace(/^https?:\/\//, "")}</span>
      </div>
    </>
  );
}
