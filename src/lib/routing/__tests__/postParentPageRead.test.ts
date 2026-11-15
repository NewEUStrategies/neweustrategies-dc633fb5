// Odczyt z osadzoną stroną-rodzicem i zapasem bez osadzenia
// (`readWithPostParentPage`) - co dowodzi ten plik.
//
// Osadzenie `parent_page` jest nową zależnością każdego zapytania o wpisy.
// Gdy zawiedzie (rozjazd schematu, uprawnienia gościa do `pages`), widget NIE
// może zostać pusty: ten sam odczyt leci bez osadzenia i strona wygląda jak
// przed zmianą (adresy `/post/<slug>`). Test pilnuje też kosztu tej reguły:
// porażka wyłącza osadzenie na okno, więc dodatkowy odczyt nie powtarza się
// przy każdym zapytaniu, a wpis w logu jest jeden.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POST_PARENT_PAGE_RETRY_MS,
  readPostsWithParentPage,
  readWithPostParentPage,
  resetPostParentPageRead,
} from "../postParentPageRead";

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

const WITH_PARENT = [{ slug: "atom", parent_page: { slug: "blog", parent_id: null } }];
const PLAIN = [{ slug: "atom" }];

function reads(embedded: Result<unknown>, plain: Result<unknown> = { data: PLAIN, error: null }) {
  return {
    withParentPage: vi.fn(() => Promise.resolve(embedded)),
    plain: vi.fn(() => Promise.resolve(plain)),
  };
}

const RELATIONSHIP_MISSING = {
  data: null,
  error: {
    code: "PGRST200",
    message: "Could not find a relationship between 'posts' and 'pages' in the schema cache",
  },
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetPostParentPageRead();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readWithPostParentPage", () => {
  it("osadzenie działa: jeden odczyt, wiersze z rodzicem, bez logu", async () => {
    const r = reads({ data: WITH_PARENT, error: null });

    await expect(readWithPostParentPage(r.withParentPage, r.plain)).resolves.toEqual({
      data: WITH_PARENT,
      error: null,
    });
    expect(r.withParentPage).toHaveBeenCalledTimes(1);
    expect(r.plain).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("błąd osadzenia: ten sam odczyt bez osadzenia - widget dostaje wiersze, nie błąd", async () => {
    const r = reads(RELATIONSHIP_MISSING);

    await expect(readWithPostParentPage(r.withParentPage, r.plain)).resolves.toEqual({
      data: PLAIN,
      error: null,
    });
    expect(r.withParentPage).toHaveBeenCalledTimes(1);
    expect(r.plain).toHaveBeenCalledTimes(1);
  });

  it.each<[string, { message: string; code?: string }]>([
    ["brak relacji w cache schematu", RELATIONSHIP_MISSING.error],
    [
      "brak uprawnień gościa do pages",
      { code: "42501", message: "permission denied for table pages" },
    ],
    ["kolumna zniknęła", { code: "42703", message: "column pages_1.parent_id does not exist" }],
    [
      "limit czasu zapytania",
      { code: "57014", message: "canceling statement due to statement timeout" },
    ],
    ["błąd bez kodu (brama, sieć)", { message: "TypeError: fetch failed" }],
  ])("każdy błąd osadzenia kończy się odczytem zapasowym (%s)", async (_label, error) => {
    const r = reads({ data: null, error });

    const result = await readWithPostParentPage(r.withParentPage, r.plain);

    expect(result.error).toBeNull();
    expect(result.data).toEqual(PLAIN);
  });

  it("błąd odczytu zapasowego wraca do wołającego bez zmian (awaria `posts` jak dotąd)", async () => {
    const down = { data: null, error: { code: "57014", message: "statement timeout" } };
    const r = reads(RELATIONSHIP_MISSING, down);

    await expect(readWithPostParentPage(r.withParentPage, r.plain)).resolves.toEqual(down);
  });

  it("po porażce izolat czyta bez osadzenia do końca okna: jeden dodatkowy odczyt, nie co zapytanie", async () => {
    const now = vi.spyOn(Date, "now");
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    const r = reads(RELATIONSHIP_MISSING);
    await readWithPostParentPage(r.withParentPage, r.plain);

    now.mockReturnValue(t0 + POST_PARENT_PAGE_RETRY_MS - 1);
    await readWithPostParentPage(r.withParentPage, r.plain);
    await readWithPostParentPage(r.withParentPage, r.plain);

    expect(r.withParentPage).toHaveBeenCalledTimes(1);
    expect(r.plain).toHaveBeenCalledTimes(3);
  });

  it("po oknie osadzenie jest próbowane ponownie (naprawa schematu bez wymiany izolatu)", async () => {
    const now = vi.spyOn(Date, "now");
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    const broken = reads(RELATIONSHIP_MISSING);
    await readWithPostParentPage(broken.withParentPage, broken.plain);

    now.mockReturnValue(t0 + POST_PARENT_PAGE_RETRY_MS);
    const healed = reads({ data: WITH_PARENT, error: null });

    await expect(readWithPostParentPage(healed.withParentPage, healed.plain)).resolves.toEqual({
      data: WITH_PARENT,
      error: null,
    });
    expect(healed.plain).not.toHaveBeenCalled();
  });

  it("loguje RAZ na okno - także gdy zapytania jednej fali padają równocześnie", async () => {
    const r = reads(RELATIONSHIP_MISSING);

    await Promise.all([
      readWithPostParentPage(r.withParentPage, r.plain),
      readWithPostParentPage(r.withParentPage, r.plain),
      readWithPostParentPage(r.withParentPage, r.plain),
    ]);
    await readWithPostParentPage(r.withParentPage, r.plain);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("[postHref]");
    expect(warn.mock.calls[0]).toContain("PGRST200");
  });

  it("wpis w logu niesie kod i treść błędu bazy (tekst krótki, diagnoza pełna)", async () => {
    const r = reads(RELATIONSHIP_MISSING);

    await readWithPostParentPage(r.withParentPage, r.plain);

    expect(warn.mock.calls[0]).toEqual([
      "[postHref] parent_page:",
      "PGRST200",
      RELATIONSHIP_MISSING.error.message,
    ]);
  });
});

describe("readPostsWithParentPage", () => {
  const PLAIN_COLUMNS = "id, slug, title_pl";
  /** Dosłowny `select` z osadzeniem - to, co pomocnik MA wysłać do bazy. */
  const EMBEDDED_COLUMNS =
    "id, slug, title_pl, parent_page:pages!posts_parent_page_id_fkey(slug, parent_id)";

  function columnRead(embedded: Result<unknown>, plain: Result<unknown>) {
    return vi.fn((columns: string) =>
      Promise.resolve(columns.includes("parent_page:") ? embedded : plain),
    );
  }

  it("osadzenie działa: JEDEN odczyt, kolumny wołającego z doklejonym osadzeniem rodzica", async () => {
    const read = columnRead({ data: WITH_PARENT, error: null }, { data: PLAIN, error: null });

    await expect(readPostsWithParentPage(read, PLAIN_COLUMNS)).resolves.toEqual({
      data: WITH_PARENT,
      error: null,
    });
    expect(read.mock.calls).toEqual([[EMBEDDED_COLUMNS]]);
  });

  it("błąd osadzenia: drugi odczyt DOKŁADNIE kolumnami wołającego, wiersze zamiast błędu", async () => {
    const read = columnRead(RELATIONSHIP_MISSING, { data: PLAIN, error: null });

    await expect(readPostsWithParentPage(read, PLAIN_COLUMNS)).resolves.toEqual({
      data: PLAIN,
      error: null,
    });
    expect(read.mock.calls).toEqual([[EMBEDDED_COLUMNS], [PLAIN_COLUMNS]]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("błąd odczytu zapasowego wraca do wołającego bez zmian", async () => {
    const down = { data: null, error: { code: "57014", message: "statement timeout" } };
    const read = columnRead(RELATIONSHIP_MISSING, down);

    await expect(readPostsWithParentPage(read, PLAIN_COLUMNS)).resolves.toEqual(down);
  });

  it("dzieli okno wyłączenia z `readWithPostParentPage`: po porażce czyta od razu bez osadzenia", async () => {
    const broken = reads(RELATIONSHIP_MISSING);
    await readWithPostParentPage(broken.withParentPage, broken.plain);
    const read = columnRead({ data: WITH_PARENT, error: null }, { data: PLAIN, error: null });

    await expect(readPostsWithParentPage(read, PLAIN_COLUMNS)).resolves.toEqual({
      data: PLAIN,
      error: null,
    });
    expect(read.mock.calls).toEqual([[PLAIN_COLUMNS]]);
  });
});
