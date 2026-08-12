// Ciało podglądu dokumentu - ładowane leniwie z popupu.
//
// TU MIESZKA CAŁA WAGA: mammoth, xlsx i jszip wchodzą do grafu dopiero po
// otwarciu podglądu, bo ten moduł jest jedynym miejscem, które ich dotyka.
//
// KAŻDY FORMAT MA WŁASNĄ ŚCIEŻKĘ, ale wspólny kontrakt: dostaje podpisany
// adres i metadane, a zwraca gotowy widok albo komunikat. Nie ma tu żadnego
// pobierania uprawnień - popup pokazuje to, do czego wywołujący już ma URL.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FileWarning, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { extensionOf, viewerKindFor, type ViewerKind } from "@/lib/files/fileKinds";
import {
  parseDocx,
  parsePptx,
  parseSpreadsheet,
  type SheetResult,
  type SlideResult,
} from "@/lib/files/officeParse";

export interface ViewerSource {
  url: string;
  name: string;
  mime: string;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <Centered>
      <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
      <span>{label}</span>
    </Centered>
  );
}

function Failure({ label, hint }: { label: string; hint?: string }) {
  return (
    <Centered>
      <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      <span className="font-medium text-foreground">{label}</span>
      {hint !== undefined ? <span className="max-w-sm text-xs">{hint}</span> : null}
    </Centered>
  );
}

/** Pobranie zawartości do pamięci - wspólne dla formatów parsowanych lokalnie. */
function useArrayBuffer(url: string, enabled: boolean) {
  const [state, setState] = useState<{
    buffer: ArrayBuffer | null;
    error: boolean;
    loading: boolean;
  }>({ buffer: null, error: false, loading: enabled });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const controller = new AbortController();
    setState({ buffer: null, error: false, loading: true });
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (alive) setState({ buffer, error: false, loading: false });
      })
      .catch(() => {
        if (alive) setState({ buffer: null, error: true, loading: false });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [url, enabled]);

  return state;
}

function DocxView({ source }: { source: ViewerSource }) {
  const { t } = useTranslation();
  const { buffer, error, loading } = useArrayBuffer(source.url, true);
  const [html, setHtml] = useState<string | null>(null);
  const [parseError, setParseError] = useState(false);

  useEffect(() => {
    if (buffer === null) return;
    let alive = true;
    parseDocx(buffer)
      .then((result) => {
        if (alive) setHtml(result.html);
      })
      .catch(() => {
        if (alive) setParseError(true);
      });
    return () => {
      alive = false;
    };
  }, [buffer]);

  if (extensionOf(source.name) === "doc") return <Failure label={t("fileViewer.legacyFormat")} />;
  if (error || parseError)
    return <Failure label={t("fileViewer.error")} hint={t("fileViewer.protectedHint")} />;
  if (loading || html === null) return <Busy label={t("fileViewer.parsing")} />;
  if (html.trim() === "") return <Centered>{t("fileViewer.emptyDocument")}</Centered>;

  return (
    <div className="flex justify-center bg-muted/40 p-4 sm:p-8">
      <article
        className="w-full max-w-3xl rounded-lg bg-background px-6 py-8 shadow-sm sm:px-10 sm:py-12"
        // Treść przeszła przez DOMPurify w warstwie parsowania - to jedyne
        // miejsce, w którym dokument użytkownika staje się DOM-em.
        dangerouslySetInnerHTML={{ __html: html }}
        data-testid="file-viewer-docx"
      />
    </div>
  );
}

function SheetView({ source }: { source: ViewerSource }) {
  const { t } = useTranslation();
  const { buffer, error, loading } = useArrayBuffer(source.url, true);
  const [sheets, setSheets] = useState<SheetResult[] | null>(null);
  const [active, setActive] = useState(0);
  const [parseError, setParseError] = useState(false);

  useEffect(() => {
    if (buffer === null) return;
    let alive = true;
    parseSpreadsheet(buffer)
      .then((result) => {
        if (alive) setSheets(result);
      })
      .catch(() => {
        if (alive) setParseError(true);
      });
    return () => {
      alive = false;
    };
  }, [buffer]);

  if (extensionOf(source.name) === "xls") return <Failure label={t("fileViewer.legacyFormat")} />;
  if (error || parseError) return <Failure label={t("fileViewer.error")} />;
  if (loading || sheets === null) return <Busy label={t("fileViewer.parsing")} />;
  if (sheets.length === 0) return <Centered>{t("fileViewer.emptyDocument")}</Centered>;

  const current = sheets[Math.min(active, sheets.length - 1)]!;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {sheets.length > 1 ? (
        <div
          role="tablist"
          aria-label={t("fileViewer.sheet")}
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/40 px-3 py-2"
        >
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              type="button"
              role="tab"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                index === active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        <div
          className="cms-sheet-preview text-sm"
          dangerouslySetInnerHTML={{ __html: current.html }}
          data-testid="file-viewer-sheet"
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {t("fileViewer.rows", { count: current.rows })}
        </p>
      </div>
    </div>
  );
}

function SlidesView({ source }: { source: ViewerSource }) {
  const { t } = useTranslation();
  const { buffer, error, loading } = useArrayBuffer(source.url, true);
  const [slides, setSlides] = useState<SlideResult[] | null>(null);
  const [parseError, setParseError] = useState(false);

  useEffect(() => {
    if (buffer === null) return;
    let alive = true;
    parsePptx(buffer)
      .then((result) => {
        if (alive) setSlides(result);
      })
      .catch(() => {
        if (alive) setParseError(true);
      });
    return () => {
      alive = false;
    };
  }, [buffer]);

  // Obrazy slajdów żyją jako obiekty URL - bez zwolnienia zostawiłyby
  // zablokowane bloby na czas życia karty.
  useEffect(
    () => () => {
      for (const slide of slides ?? []) for (const url of slide.images) URL.revokeObjectURL(url);
    },
    [slides],
  );

  if (extensionOf(source.name) === "ppt") return <Failure label={t("fileViewer.legacyFormat")} />;
  if (error || parseError) return <Failure label={t("fileViewer.error")} />;
  if (loading || slides === null) return <Busy label={t("fileViewer.parsing")} />;
  if (slides.length === 0) return <Centered>{t("fileViewer.emptyDocument")}</Centered>;

  return (
    <div className="space-y-5 bg-muted/40 p-4 sm:p-6" data-testid="file-viewer-slides">
      {slides.map((slide) => (
        <section
          key={slide.index}
          className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-background shadow-sm"
        >
          <header className="border-b border-border/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("fileViewer.slide", { index: slide.index })}
          </header>
          <div className="space-y-3 px-5 py-5">
            {slide.title !== null ? (
              <h3 className="text-lg font-semibold leading-snug">{slide.title}</h3>
            ) : null}
            {slide.paragraphs.length > 0 ? (
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
                {slide.paragraphs.map((line, index) => (
                  <li key={`${slide.index}-${index}`}>{line}</li>
                ))}
              </ul>
            ) : null}
            {slide.images.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {slide.images.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="w-full rounded-lg border border-border/60 object-contain"
                  />
                ))}
              </div>
            ) : null}
            {slide.notes !== null ? (
              <p className="rounded-lg bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium">{t("fileViewer.notes")}: </span>
                {slide.notes}
              </p>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

function TextView({ source, kind }: { source: ViewerSource; kind: ViewerKind }) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(source.url)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then((value) => {
        if (alive) setText(value.slice(0, 400_000));
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [source.url]);

  const rows = useMemo(
    () =>
      kind === "csv" && text !== null
        ? text
            .split(/\r?\n/)
            .slice(0, 2000)
            .map((line) => line.split(/[,;\t]/))
        : null,
    [kind, text],
  );

  if (error) return <Failure label={t("fileViewer.error")} />;
  if (text === null) return <Busy label={t("fileViewer.loading")} />;

  if (rows !== null) {
    return (
      <div className="overflow-auto p-3 sm:p-5">
        <table className="w-full border-collapse text-sm" data-testid="file-viewer-csv">
          <tbody>
            {rows.map((cells, rowIndex) => (
              <tr key={rowIndex} className={rowIndex === 0 ? "bg-muted/60 font-medium" : undefined}>
                {cells.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="whitespace-pre border border-border/60 px-2.5 py-1.5"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <pre
      className="overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-relaxed sm:p-6"
      data-testid="file-viewer-text"
    >
      {text}
    </pre>
  );
}

export function DocumentViewerBody({ source }: { source: ViewerSource }) {
  const { t } = useTranslation();
  const kind = viewerKindFor(source.mime, source.name);

  if (kind === "pdf") {
    return (
      <object
        data={source.url}
        type="application/pdf"
        className="h-full min-h-[70vh] w-full"
        aria-label={source.name}
        data-testid="file-viewer-pdf"
      >
        <Centered>
          <FileWarning className="h-6 w-6" aria-hidden="true" />
          {t("fileViewer.unsupported")}
        </Centered>
      </object>
    );
  }
  if (kind === "image") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-black/85 p-3">
        <img
          src={source.url}
          alt={source.name}
          className="max-h-[78vh] w-auto max-w-full object-contain"
          data-testid="file-viewer-image"
        />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="bg-black">
        {/* DŁUG DOSTĘPNOŚCI: materiał wgrany przez członka nie ma ścieżki napisów
            (`<track kind="captions">`) - przesyłający podaje sam plik. Dawny
            `eslint-disable` był tu MARTWY: reguła `jsx-a11y/media-has-caption`
            nie jest w tym repo skonfigurowana, więc niczego nie wyciszał, tylko
            wywracał lint odwołaniem do nieistniejącej reguły. */}
        <video src={source.url} controls preload="metadata" className="max-h-[78vh] w-full" />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="flex min-h-[30vh] items-center justify-center p-8">
        {/* DŁUG DOSTĘPNOŚCI: jak wyżej - nagranie audio bez transkrypcji. */}
        <audio src={source.url} controls className="w-full max-w-xl" />
      </div>
    );
  }
  if (kind === "docx") return <DocxView source={source} />;
  if (kind === "xlsx") return <SheetView source={source} />;
  if (kind === "pptx") return <SlidesView source={source} />;
  if (kind === "text" || kind === "markdown" || kind === "csv")
    return <TextView source={source} kind={kind} />;

  return (
    <Centered>
      <FileWarning className="h-6 w-6" aria-hidden="true" />
      {t("fileViewer.unsupported")}
    </Centered>
  );
}

export default DocumentViewerBody;
