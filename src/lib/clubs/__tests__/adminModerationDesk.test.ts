// Pulpit moderacji - REGUŁY wyprowadzone z organizmu `ClubModerationTab`.
//
// CO TO DOWODZI. Cztery powierzchnie, które przed wyprowadzeniem żyły wyłącznie
// w JSX-ie zakładki liczącej tysiąc linii:
//
//   1. DZIENNIK. Okno czasu stosuje się PRZED filtrami, więc liczniki przy
//      akcjach mówią o tym, co widać w oknie - nie o całej historii. Wpis
//      z niepoprawną datą NIE WYPADA z okna (dziennik jest zapisem audytowym,
//      ukrycie wpisu przez literówkę w danych jest gorsze niż pokazanie go).
//      Filtr jest KONIUNKCJĄ akcji, celu i frazy, a fraza szuka też po tym, CO
//      MODERATOR WIDZI - dlatego etykiety wchodzą rezolwerem, nie napisem.
//   2. BLOKADY. Pusty powód jedzie jako `null`, nie `""`: puste uzasadnienie
//      blokady zapisuje się poprawnie i nie mówi nikomu nic. Brak wybranej
//      osoby nie daje ładunku wcale.
//   3. REDAKCJA MODERATORSKA. Który RPC dostanie ładunek zależy od typu celu,
//      a bramka wymaga powodu (min. 3 znaki) ORAZ niepustej treści. Formularz
//      startuje TREŚCIĄ WPISU - moderator zaczernia fragment, nie pisze wpisu
//      od nowa - ale powód startuje pusty ZAWSZE.
//   4. UJAWNIENIE AUTORA. Ładunek powstaje z PRZYCIĘTYM powodem i tylko wtedy,
//      gdy próg został przyjęty; odnośnik do profilu istnieje wyłącznie, gdy
//      RPC oddał sluga.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Progu powodu ujawnienia, rozbicia wsadu na typy
// celu, listy akcji wymagających potwierdzenia i przełączania zaznaczenia - to
// `moderationRules.test.ts`. Nie sprawdza autorytetu RPC (`club_ban_member`,
// `admin_club_thread_edit`, `club_reveal_author` mają pgTAP) ani renderu
// zakładki (`ClubModerationTab.test.tsx`).
//
// DETERMINIZM. Wszystkie funkcje czasu przyjmują `nowMs` z wywołania, więc
// żaden przypadek nie zależy od zegara maszyny - „teraz” to `CLUB_BASE_ISO`.
import { describe, expect, it } from "vitest";
import {
  MODERATION_LOG_FILTERS_CLEARED,
  MODERATION_LOG_PERIODS,
  MODERATION_LOG_PERIOD_ALL,
  MODERATOR_EDIT_MIN_REASON,
  banMemberVars,
  bannedMemberSubtitle,
  filterModerationLog,
  isModerationLogFiltered,
  isModeratorEditBlocked,
  isRevealLogAction,
  moderationLogCountView,
  moderationLogCounts,
  moderationLogHaystack,
  moderationLogInWindow,
  moderationLogOptions,
  moderationLogPeriodDays,
  moderationLogReason,
  moderationTargetType,
  moderatorEditInitial,
  moderatorEditVars,
  revealAuthorVars,
  revealProfileHref,
  unbanMemberVars,
  type ModerationLogEntry,
  type ModerationLogFilterState,
  type ModerationLogLabels,
} from "@/lib/clubs/adminModerationDesk";
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset, clubMemberRow } from "@/test/clubs/fixtures";
import { moderationLogRow } from "@/test/clubs/adminThreadFixtures";

const NOW_MS = Date.parse(CLUB_BASE_ISO);

/** Etykiety dziennika w testach: prefiks plus wartość, bez i18n. */
const LABELS: ModerationLogLabels = {
  action: (value) => `akcja:${value}`,
  target: (value) => `cel:${value}`,
};

function filters(overrides: Partial<ModerationLogFilterState> = {}): ModerationLogFilterState {
  return { ...MODERATION_LOG_FILTERS_CLEARED, ...overrides };
}

describe("okno czasu dziennika", () => {
  it("słownik okien ma cztery pozycje, ostatnia bez ograniczenia", () => {
    expect(MODERATION_LOG_PERIODS.map((p) => p.key)).toEqual(["7", "30", "90", "all"]);
    expect(moderationLogPeriodDays("30")).toBe(30);
    expect(moderationLogPeriodDays(MODERATION_LOG_PERIOD_ALL)).toBeNull();
  });

  it("klucz spoza słownika znaczy CAŁĄ historię, nie zero dni", () => {
    // Zero dni schowałoby cały dziennik przy literówce w wartości dropListy.
    expect(moderationLogPeriodDays("kwartał")).toBeNull();
  });

  it("„cała historia” oddaje wszystkie wiersze", () => {
    const rows = [moderationLogRow({ created_at: clubIsoOffset(-60 * 24 * 400) })];
    expect(moderationLogInWindow(rows, MODERATION_LOG_PERIOD_ALL, NOW_MS)).toHaveLength(1);
  });

  it("okno siedmiu dni odcina wpis starszy, zostawia świeższy", () => {
    const fresh = moderationLogRow({ id: "log-fresh", created_at: clubIsoOffset(-60 * 24 * 3) });
    const old = moderationLogRow({ id: "log-old", created_at: clubIsoOffset(-60 * 24 * 30) });

    const kept = moderationLogInWindow([fresh, old], "7", NOW_MS);

    expect(kept.map((r) => r.id)).toEqual(["log-fresh"]);
  });

  it("wpis DOKŁADNIE na granicy okna zostaje w oknie", () => {
    const edge = moderationLogRow({ created_at: clubIsoOffset(-60 * 24 * 7) });
    expect(moderationLogInWindow([edge], "7", NOW_MS)).toHaveLength(1);
  });

  it("wpis z datą nieparsowalną NIE wypada z okna", () => {
    const broken = moderationLogRow({ id: "log-broken", created_at: "nie-data" });
    expect(moderationLogInWindow([broken], "7", NOW_MS).map((r) => r.id)).toEqual(["log-broken"]);
  });
});

describe("liczniki i opcje filtrów dziennika", () => {
  const rows = [
    moderationLogRow({ id: "a", action: "approve", target_type: "thread" }),
    moderationLogRow({ id: "b", action: "approve", target_type: "reply" }),
    moderationLogRow({ id: "c", action: "ban", target_type: "member" }),
  ];

  it("liczniki idą per akcja i per typ celu", () => {
    const counts = moderationLogCounts(rows);

    expect(counts.byAction.get("approve")).toBe(2);
    expect(counts.byAction.get("ban")).toBe(1);
    expect(counts.byTarget.get("thread")).toBe(1);
    expect(counts.byTarget.get("reply")).toBe(1);
  });

  it("pusty dziennik daje puste liczniki, a nie zera dla wszystkiego", () => {
    const counts = moderationLogCounts([]);
    expect(counts.byAction.size).toBe(0);
    expect(counts.byTarget.size).toBe(0);
  });

  it("droplista pokazuje WYŁĄCZNIE akcje, które w oknie wystąpiły", () => {
    const counts = moderationLogCounts(rows);
    const options = moderationLogOptions(["approve", "ban", "move", "edit"], counts.byAction);

    expect(options).toEqual([
      { value: "approve", count: 2 },
      { value: "ban", count: 1 },
    ]);
  });
});

describe("filtr dziennika", () => {
  const rows = [
    moderationLogRow({
      id: "a",
      action: "approve",
      target_type: "thread",
      moderator_name: "Jan Kowalski",
      reason: "zgodne z zasadami",
    }),
    moderationLogRow({
      id: "b",
      action: "reveal_author",
      target_type: "reply",
      moderator_name: "Ewa Zielińska",
      reason: "",
    }),
  ];

  it("bez filtrów przechodzi wszystko", () => {
    expect(filterModerationLog(rows, filters(), LABELS)).toHaveLength(2);
  });

  it("filtr akcji odsiewa inne akcje", () => {
    expect(
      filterModerationLog(rows, filters({ action: "approve" }), LABELS).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("filtr celu odsiewa inne typy celu", () => {
    expect(
      filterModerationLog(rows, filters({ target: "reply" }), LABELS).map((r) => r.id),
    ).toEqual(["b"]);
  });

  it("fraza szuka po nazwisku moderatora bez względu na wielkość liter", () => {
    expect(
      filterModerationLog(rows, filters({ query: "  EWA  " }), LABELS).map((r) => r.id),
    ).toEqual(["b"]);
  });

  it("fraza szuka po POWODZIE wpisu", () => {
    expect(filterModerationLog(rows, filters({ query: "zasadami" }), LABELS)).toHaveLength(1);
  });

  it("fraza szuka po ETYKIECIE akcji, a nie po surowej wartości kolumny", () => {
    // Moderator szuka tego, co widzi na ekranie - dlatego siano zawiera
    // etykietę z rezolwera, a nie tylko `r.action`.
    expect(
      filterModerationLog(rows, filters({ query: "akcja:reveal" }), LABELS).map((r) => r.id),
    ).toEqual(["b"]);
  });

  it("fraza bez trafienia daje pustkę, a nie całą listę", () => {
    expect(filterModerationLog(rows, filters({ query: "nie ma takiego" }), LABELS)).toEqual([]);
  });

  it("filtry działają razem: akcja ORAZ fraza", () => {
    expect(filterModerationLog(rows, filters({ action: "approve", query: "ewa" }), LABELS)).toEqual(
      [],
    );
  });

  it("siano niesie pięć pól wiersza", () => {
    const hay = moderationLogHaystack(
      moderationLogRow({ moderator_name: "Jan", reason: "spam", target_id: "thread-77" }),
      LABELS,
    );

    expect(hay).toContain("jan");
    expect(hay).toContain("spam");
    expect(hay).toContain("akcja:approve");
    expect(hay).toContain("cel:thread");
    expect(hay).toContain("thread-77");
  });

  it("siano znosi brak powodu i brak identyfikatora celu", () => {
    // Wiersz z NULL-ami budujemy literałem, a nie atrapą wiersza RPC:
    // `RETURNS TABLE` typuje te kolumny jako non-null, choć baza oddaje tam
    // NULL - i to jest dokładnie ta rozbieżność, którą funkcja ma znosić.
    const raw: ModerationLogEntry = {
      action: "approve",
      target_type: "thread",
      target_id: null,
      moderator_name: "Jan",
      reason: null,
      created_at: CLUB_BASE_ISO,
    };

    expect(moderationLogHaystack(raw, LABELS)).not.toContain("null");
  });
});

describe("stan filtrów i licznik dziennika", () => {
  it("każda z czterech kontrolek osobno znaczy „zawężone”", () => {
    expect(isModerationLogFiltered(filters())).toBe(false);
    expect(isModerationLogFiltered(filters({ action: "ban" }))).toBe(true);
    expect(isModerationLogFiltered(filters({ target: "member" }))).toBe(true);
    expect(isModerationLogFiltered(filters({ query: "  x  " }))).toBe(true);
    expect(isModerationLogFiltered(filters({ period: "30" }))).toBe(true);
  });

  it("fraza z samych odstępów NIE jest zawężeniem", () => {
    expect(isModerationLogFiltered(filters({ query: "    " }))).toBe(false);
  });

  it("plakietka mówi „ile z ilu” dopiero wtedy, gdy filtr coś odjął", () => {
    expect(moderationLogCountView(12, 12)).toEqual({ kind: "all", total: 12 });
    expect(moderationLogCountView(3, 12)).toEqual({ kind: "partial", shown: 3, total: 12 });
  });

  it("powód pusty i powód z samych odstępów znaczą BRAK powodu", () => {
    expect(moderationLogReason(null)).toBeNull();
    expect(moderationLogReason("")).toBeNull();
    expect(moderationLogReason("   ")).toBeNull();
    expect(moderationLogReason("spam")).toBe("spam");
  });

  it("wyróżnienie w dzienniku dotyczy WYŁĄCZNIE ujawnienia autora", () => {
    expect(isRevealLogAction("reveal_author")).toBe(true);
    expect(isRevealLogAction("delete")).toBe(false);
  });
});

describe("blokady członków", () => {
  it("powód jedzie przycięty, a pusty powód jako null", () => {
    expect(banMemberVars(CLUB_IDS.member, "  wielokrotny spam  ")).toEqual({
      userId: CLUB_IDS.member,
      banned: true,
      reason: "wielokrotny spam",
    });
    expect(banMemberVars(CLUB_IDS.member, "   ")).toEqual({
      userId: CLUB_IDS.member,
      banned: true,
      reason: null,
    });
  });

  it("brak wybranej osoby nie daje ładunku - blokada nie wychodzi", () => {
    expect(banMemberVars("", "powód")).toBeNull();
    expect(banMemberVars("   ", "powód")).toBeNull();
  });

  it("zdjęcie blokady jest osobnym ładunkiem, BEZ powodu", () => {
    expect(unbanMemberVars(CLUB_IDS.member)).toEqual({
      userId: CLUB_IDS.member,
      banned: false,
    });
  });

  it("podpis zablokowanej osoby to stanowisko, a bez niego KLUCZ roli", () => {
    expect(bannedMemberSubtitle(clubMemberRow({ job_title: "Analityk" }))).toEqual({
      kind: "jobTitle",
      text: "Analityk",
    });
    expect(bannedMemberSubtitle(clubMemberRow({ job_title: "", role: "lead" }))).toEqual({
      kind: "roleKey",
      key: "club.role.lead",
    });
    expect(bannedMemberSubtitle({ job_title: null, role: "member" })).toEqual({
      kind: "roleKey",
      key: "club.role.member",
    });
  });
});

describe("redakcja moderatorska", () => {
  const item = {
    target_type: "thread",
    target_id: CLUB_IDS.thread,
    title: "Zgłoszony temat",
    body: "Treść ze zdaniem do zaczernienia",
  };

  it("formularz startuje treścią wpisu, ale powód ZAWSZE pusty", () => {
    expect(moderatorEditInitial(item)).toEqual({
      title: "Zgłoszony temat",
      body: "Treść ze zdaniem do zaczernienia",
      reason: "",
    });
  });

  it("brak wpisu daje trzy puste pola, a nie rzucony wyjątek", () => {
    expect(moderatorEditInitial(null)).toEqual({ title: "", body: "", reason: "" });
  });

  it("bramka: powód krótszy od progu blokuje, próg przechodzi", () => {
    const short = "a".repeat(MODERATOR_EDIT_MIN_REASON - 1);
    expect(isModeratorEditBlocked({ title: "T", body: "treść", reason: short })).toBe(true);
    expect(
      isModeratorEditBlocked({
        title: "T",
        body: "treść",
        reason: "a".repeat(MODERATOR_EDIT_MIN_REASON),
      }),
    ).toBe(false);
  });

  it("bramka: pusta treść blokuje nawet z powodem", () => {
    expect(isModeratorEditBlocked({ title: "T", body: "   ", reason: "literówka" })).toBe(true);
  });

  it("cel typu „temat” jedzie do RPC tematu, z tytułem", () => {
    const vars = moderatorEditVars(item, {
      title: "  Nowy tytuł  ",
      body: "  Nowa treść  ",
      reason: "  zaczernienie danych  ",
    });

    expect(vars).toEqual({
      kind: "thread",
      vars: {
        threadId: CLUB_IDS.thread,
        title: "Nowy tytuł",
        body: "Nowa treść",
        reason: "zaczernienie danych",
      },
    });
  });

  it("cel typu „odpowiedź” jedzie do RPC odpowiedzi, BEZ tytułu", () => {
    const vars = moderatorEditVars(
      { ...item, target_type: "reply", target_id: CLUB_IDS.reply },
      { title: "ignorowany", body: "poprawiona treść", reason: "dane osobowe" },
    );

    expect(vars).toEqual({
      kind: "reply",
      vars: { replyId: CLUB_IDS.reply, body: "poprawiona treść", reason: "dane osobowe" },
    });
  });

  it("cel historyczny spoza dwóch typów idzie ścieżką odpowiedzi", () => {
    // `post` z wpisu historycznego nie ma własnego RPC redakcji.
    const vars = moderatorEditVars(
      { ...item, target_type: "post" },
      { title: "x", body: "treść", reason: "powód" },
    );
    expect(vars?.kind).toBe("reply");
  });

  it("brak wpisu albo zablokowana bramka nie dają ładunku", () => {
    expect(moderatorEditVars(null, { title: "x", body: "treść", reason: "powód" })).toBeNull();
    expect(moderatorEditVars(item, { title: "x", body: "treść", reason: "a" })).toBeNull();
  });
});

describe("ujawnienie autora - ładunek i wynik", () => {
  const target = { targetType: "reply", targetId: CLUB_IDS.reply, title: "Wpis" } as const;

  it("typ celu z kolejki degraduje do dwóch wartości przyjmowanych przez RPC", () => {
    expect(moderationTargetType("reply")).toBe("reply");
    expect(moderationTargetType("thread")).toBe("thread");
    expect(moderationTargetType("post")).toBe("thread");
  });

  it("ładunek niesie PRZYCIĘTY powód", () => {
    expect(revealAuthorVars(target, "   podejrzenie podszycia   ", true)).toEqual({
      targetType: "reply",
      targetId: CLUB_IDS.reply,
      reason: "podejrzenie podszycia",
    });
  });

  it("nieprzyjęty próg powodu nie daje ładunku", () => {
    expect(revealAuthorVars(target, "krótko", false)).toBeNull();
  });

  it("brak celu nie daje ładunku", () => {
    expect(revealAuthorVars(null, "wystarczająco długi powód", true)).toBeNull();
  });

  it("odnośnik do profilu istnieje tylko wtedy, gdy RPC oddał sluga", () => {
    expect(revealProfileHref("anna-nowak")).toBe("/profile/anna-nowak");
    expect(revealProfileHref("")).toBeNull();
    expect(revealProfileHref("   ")).toBeNull();
    expect(revealProfileHref(null)).toBeNull();
  });
});
