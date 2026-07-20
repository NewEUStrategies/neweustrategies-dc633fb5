// Izolowana ramka dla kreacji html/script. Treść slotu pochodzi z bazy
// (redakcja), ale od strony przeglądarki traktujemy ją jak niezaufaną -
// przejęte konto edytora nie może przez slot reklamowy dosięgnąć sesji
// czytelnika (stored XSS). sandbox BEZ allow-same-origin = opaque origin:
// skrypt kreacji nie widzi cookies, localStorage ani DOM strony.
// allow-popups-to-escape-sandbox + <base target="_blank"> pozwalają linkom
// kreacji otwierać się normalnie w nowej karcie.
//
// CSP: dokument srcdoc dziedziczy politykę strony (script-src 'self'
// 'unsafe-inline'), więc kreacje inline działają jak dotąd, a zewnętrzne
// skrypty pozostają zablokowane - identycznie jak przy wcześniejszym montażu
// bezpośrednio w DOM. Zmiana jest czysto izolacyjna, bez regresji emisji.
import { memo, useEffect, useMemo, useRef } from "react";

interface Props {
  /** Surowy HTML/JS kreacji (wykona się wyłącznie wewnątrz sandboxu). */
  markup: string;
  /** Dostępna etykieta ramki (nazwa slotu). */
  title: string;
  /** Jednorazowy sygnał interakcji z kreacją (heurystyka kliknięcia). */
  onEngage?: () => void;
}

export const SandboxedAdFrame = memo(function SandboxedAdFrame({ markup, title, onEngage }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const engagedRef = useRef(false);

  const srcDoc = useMemo(
    () =>
      '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
      "<style>html,body{margin:0;padding:0;height:100%}" +
      "body{display:flex;align-items:center;justify-content:center;overflow:hidden}</style>" +
      `</head><body>${markup}</body></html>`,
    [markup],
  );

  // Kliknięcia wewnątrz sandboxowanej ramki nie bąbelkują do strony, więc
  // klasyczny listener na kontenerze ich nie widzi. Standardowa heurystyka
  // pomiarowa (styl SafeFrame): utrata fokusu okna, gdy activeElement to nasza
  // ramka = czytelnik wszedł w kreację. Zliczamy najwyżej raz na montaż.
  useEffect(() => {
    const onBlur = () => {
      if (engagedRef.current) return;
      if (document.activeElement === frameRef.current) {
        engagedRef.current = true;
        onEngage?.();
      }
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [onEngage]);

  return (
    <iframe
      ref={frameRef}
      title={title}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      loading="lazy"
      className="block h-full w-full border-0"
    />
  );
});
