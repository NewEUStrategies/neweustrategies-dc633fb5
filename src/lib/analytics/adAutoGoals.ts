// Cele zbierane z zachowania na stronie, wspólne dla kanałów reklamowych
// (LinkedIn Insight, piksel X), bez wiązania z konkretnym ekranem:
// - "Wyświetlenie wideo": pierwsze uruchomienie `<video>` na danej podstronie
//   (zdarzenie `play` w fazie przechwytywania - nie bąbelkuje);
// - "Pobierz": kliknięcie odnośnika z atrybutem `download` albo do pliku
//   (także programowe kliknięcie przy pobieraniu MP3 artykułu).
// Każdy cel raz na plik / film w sesji karty i kanał. Zgody pilnuje `onGoal`.

export type AdAutoGoal = "video_view" | "download";

/** Pliki, których pobranie liczy się jako konwersja "Pobierz". */
export const DOWNLOAD_FILE_RE = /\.(pdf|mp3|m4a|wav|epub|docx?|xlsx?|pptx?|csv|zip)(?:$|[?#])/i;

function normalizePath(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? "";
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean || "/";
}

/** Zakłada nasłuch; zwraca funkcję sprzątającą. */
export function installAdAutoGoals(onGoal: (goal: AdAutoGoal) => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const seenVideos = new Set<string>();
  const seenDownloads = new Set<string>();
  const onPlay = (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLVideoElement)) return;
    const key = `${normalizePath(window.location.pathname)}|${el.currentSrc || el.src || "inline"}`;
    if (seenVideos.has(key)) return;
    seenVideos.add(key);
    onGoal("video_view");
  };
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a");
    if (!link) return;
    const href = link.getAttribute("href") ?? "";
    if (!link.hasAttribute("download") && !DOWNLOAD_FILE_RE.test(href)) return;
    const key = link.getAttribute("download") || href;
    if (!key || seenDownloads.has(key)) return;
    seenDownloads.add(key);
    onGoal("download");
  };
  document.addEventListener("play", onPlay, true);
  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("play", onPlay, true);
    document.removeEventListener("click", onClick, true);
  };
}
