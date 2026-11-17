// Osiągalność pliku dla GOŚCIA (bez logowania) - miara poza bramką CI.
//
// Leży w `scripts/lib`, nie w `src/`: liczba plików `src/**` stoi w nagłówku
// pgTAP kontraktu TS <-> SQL, a miara nie może zmieniać bramki ani o bajt.
//
// PO CO. Miara kontraktu TS <-> SQL (`tsSqlContract.ts`, `--measure`) sprawdza
// fakty klienta przeglądarki także jako `anon` (gość, SSR, handler serwera).
// Odmowa uprawnień dla `anon` jest defektem widocznym dla czytelnika TYLKO
// wtedy, gdy gość dociera do tego kodu - a większość klienta przeglądarki to
// ekrany po zalogowaniu (panel, profil, wiadomości). Ten moduł mówi, skąd
// plik wywołania jest osiągalny, z dowodem: najkrótszą ścieżką importów od
// pliku trasy.
//
// KRYTERIA (statyczne, z dowodem):
//   * wejście PUBLICZNE: powłoka `routes/__root.tsx` (każda strona), wejścia
//     serwera (`router.tsx`, `start.ts`, `server.ts`) i każda trasa spoza
//     gałęzi `/admin` bez bramki sesji (także trasa serwerowa bez komponentu
//     i trasa z `ssr: false` - gość otwiera ją tak samo);
//   * wejście ZA BRAMKĄ SESJI: trasa z `<AuthGate>` albo nawigacją na `/login`
//     (`hasSessionGate`), sama albo przez przodka w drzewie tras;
//   * wejście PANELU: gałąź `/admin` (przekierowanie bez `isStaff`);
//   * krawędzie: importy wartości, STATYCZNE i `import()` (moduł leniwy też
//     wykonuje się u gościa, tylko później); bez wchodzenia w inne pliki tras
//     i w `routeTree.gen.ts` (on importuje wszystkie trasy).
// Klasa pliku to najlepsze osiągalne wejście: `public` > `session-gate` >
// `admin` > `none`.
//
// CZEGO TO NIE WIE - kierunek błędu jest znany i dlatego wynik to KANDYDACI:
//   * `public` jest GÓRNYM oszacowaniem: komponent osiągalny z trasy publicznej
//     może renderować się tylko z sesją (`{user && <X/>}`), a zapytanie mieć
//     `enabled: !!user` - takie miejsce trzeba przeczytać;
//   * `session-gate` nie jest dowodem logowania dla kodu PLIKU TRASY poza
//     `<AuthGate>` (hook wołany przed bramką wykonuje się u gościa) - plik
//     trasy z bramką i hooki wołane przed nią trzeba przeczytać;
//   * `none` - plik bez ścieżki z żadnej trasy (martwy kod, wejście spoza
//     drzewa) - niepewne.
//
// Moduł jest CZYSTY (bez I/O): źródła wchodzą parametrem.
import { buildImportGraph } from "../../src/lib/ci/moduleImportGraph";
import { routeTreeEntries } from "../../src/lib/ci/publicRouteLoaders";

export type GuestReachClass = "public" | "session-gate" | "admin" | "none";

export interface GuestReach {
  readonly cls: GuestReachClass;
  /**
   * Najkrótsza ścieżka importów od wejścia do pliku (pierwszy element - plik
   * wejścia, ostatni - sam plik); `[]` przy `none`.
   */
  readonly path: readonly string[];
  /** Ścieżka URL wejścia (`/podcast/$slug`, `(powłoka)`, `(serwer)`); `null` przy `none`. */
  readonly entry: string | null;
}

export const ROUTE_TREE_FILE = "src/routeTree.gen.ts";
export const SHELL_FILE = "src/routes/__root.tsx";
/** Wejścia serwera i routera spoza drzewa tras - działają dla każdego żądania. */
export const SERVER_ENTRY_FILES: readonly string[] = [
  "src/router.tsx",
  "src/start.ts",
  "src/server.ts",
];

const RANK: Readonly<Record<GuestReachClass, number>> = {
  public: 0,
  "session-gate": 1,
  admin: 2,
  none: 3,
};

/** Osiągalność każdego pliku źródeł (klucz - ścieżka repo). */
export function guestReach(
  sources: readonly { readonly file: string; readonly code: string }[],
): Map<string, GuestReach> {
  const byFile = new Map(sources.map((s) => [s.file, s.code]));
  const routeTree = byFile.get(ROUTE_TREE_FILE) ?? "";
  const routes = routeTreeEntries({ routeTree, sources: byFile });
  const routeFiles = new Set([...routes.map((r) => r.file), SHELL_FILE]);

  const edges = buildImportGraph(
    sources.map((s) => s.file),
    (file) => byFile.get(file) ?? "",
  );
  const next = new Map<string, string[]>();
  for (const e of edges) {
    if (e.to === ROUTE_TREE_FILE || routeFiles.has(e.to)) continue;
    const list = next.get(e.from) ?? [];
    list.push(e.to);
    next.set(e.from, list);
  }
  for (const list of next.values()) list.sort();

  const entries: { file: string; cls: GuestReachClass; label: string }[] = [
    { file: SHELL_FILE, cls: "public", label: "(powłoka)" },
    ...SERVER_ENTRY_FILES.filter((f) => byFile.has(f)).map((file) => ({
      file,
      cls: "public" as const,
      label: "(serwer)",
    })),
    ...routes.map((r) => ({
      file: r.file,
      cls: (r.admin
        ? "admin"
        : r.sessionGateFrom !== null
          ? "session-gate"
          : "public") as GuestReachClass,
      label: r.fullPath,
    })),
  ];

  const out = new Map<string, GuestReach>();
  // BFS wielu źródeł - osobno dla każdej klasy, od najlepszej: plik dostaje
  // klasę pierwszego przebiegu, który go osiąga, i najkrótszą ścieżkę w nim.
  for (const cls of ["public", "session-gate", "admin"] as const) {
    const parent = new Map<string, string | null>();
    const label = new Map<string, string>();
    let frontier: string[] = [];
    for (const e of entries
      .filter((x) => x.cls === cls)
      .sort((a, b) => a.file.localeCompare(b.file))) {
      if (parent.has(e.file)) continue;
      parent.set(e.file, null);
      label.set(e.file, e.label);
      frontier.push(e.file);
    }
    while (frontier.length > 0) {
      const after: string[] = [];
      for (const file of frontier) {
        for (const to of next.get(file) ?? []) {
          if (parent.has(to)) continue;
          parent.set(to, file);
          label.set(to, label.get(file) ?? "");
          after.push(to);
        }
      }
      frontier = after;
    }
    for (const file of parent.keys()) {
      const known = out.get(file);
      if (known !== undefined && RANK[known.cls] <= RANK[cls]) continue;
      const path: string[] = [];
      for (let at: string | null | undefined = file; at != null; at = parent.get(at)) path.push(at);
      out.set(file, { cls, path: path.reverse(), entry: label.get(file) ?? null });
    }
  }
  for (const { file } of sources) {
    if (!out.has(file)) out.set(file, { cls: "none", path: [], entry: null });
  }
  return out;
}
