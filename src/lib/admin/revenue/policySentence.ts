// Polityka dostępu w jednym zdaniu (SPEC §2.2 `access`, §6.1 `PolicySentence`).
//
// PO CO ZDANIE, A NIE TABELA. Inwentarz dostępu (S3) to kilkadziesiąt
// komórek: rodzaj treści × tryb × próg × licznik. Admin, który wchodzi na
// zakładkę Dostęp, ma najpierw zrozumieć CAŁOŚĆ - ile treści stoi za którą
// bramką, czy licznik darmowych artykułów działa i czy czytelnik ma co kupić.
// Tabela jest niżej, dla tego, kto chce szczegółów.
//
// CZĘŚCI ZDANIA, NIE GOTOWY NAPIS. Funkcja zwraca listę kluczy z parametrami,
// a komponent tłumaczy je `t()` - liczebniki odmienia i18next (PL
// `_one/_few/_many/_other`, EN `_one/_other`), więc „1 treść", „2 treści",
// „5 treści" bez ręcznej odmiany w kodzie (zakaz `lang === "pl" ?`).
//
// NIEZNANE ≠ ZERO. Brak odczytu ustawień licznika (`undefined`) to osobna
// część zdania („nie udało się odczytać"), a nie „licznik wyłączony" - to
// drugie znaczy decyzję admina, pierwsze awarię odczytu. Brak wiersza
// ustawień (`null`) to trzeci stan: serwer bez wiersza nie liczy wcale
// (def. 14), więc mówimy to wprost.
//
// MODUŁ CZYSTY (wyłącznie `import type`) - czyta go karta i test.
import type { MeteringSettings } from "@/lib/access/metering";
import type { AccessInventoryDto, AccessInventoryMode } from "@/lib/revenue/access/dto";

/** Stan licznika darmowych artykułów widziany przez zdanie polityki. */
export type AccessPolicyMetering =
  | { state: "unknown" }
  | { state: "missing" }
  | { state: "off" }
  | { state: "on"; memberLimit: number; anonLimit: number };

/** Fakty polityki - to, co zdanie mówi, wyciągnięte z inwentarza i ustawień. */
export interface AccessPolicyFacts {
  total: number;
  byMode: Readonly<Record<AccessInventoryMode, number>>;
  /** Treści z progiem warstwy (ranga > 0) - drabinka Plus/Pro, nie sam tryb. */
  rankGated: number;
  metering: AccessPolicyMetering;
  tiersTotal: number;
  tiersOfferable: number;
  /** Suma ślepych zaułków inwentarza (bramka bez oferty, plan spoza sprzedaży…). */
  deadEnds: number;
}

/** Jedna część zdania: klucz słownika zakładek i parametry (z `count` dla liczebników). */
export interface PolicySentencePart {
  key: string;
  params: Readonly<Record<string, string | number>>;
}

/**
 * Fakty polityki z inwentarza (S3) i ustawień licznika (S1).
 *
 * @param metering wiersz ustawień; `null` = brak wiersza w bazie,
 *                 `undefined` = odczyt się nie udał albo trwa
 */
export function accessPolicyFacts(
  inventory: AccessInventoryDto,
  metering: MeteringSettings | null | undefined,
): AccessPolicyFacts {
  const rankGated = inventory.rows
    .filter((row) => row.minTierRank > 0)
    .reduce((sum, row) => sum + row.count, 0);
  const { tierWithoutOffer, paidWithoutOffer, danglingPlans, meteredTierGated } =
    inventory.deadEnds;
  let meteringState: AccessPolicyMetering;
  if (metering === undefined) meteringState = { state: "unknown" };
  else if (metering === null) meteringState = { state: "missing" };
  else if (!metering.enabled) meteringState = { state: "off" };
  else {
    meteringState = {
      state: "on",
      memberLimit: metering.member_monthly_limit,
      anonLimit: metering.anon_monthly_limit,
    };
  }
  return {
    total: inventory.total,
    byMode: inventory.byMode,
    rankGated,
    metering: meteringState,
    tiersTotal: inventory.tiers.length,
    tiersOfferable: inventory.tiers.filter((tier) => tier.offerable).length,
    deadEnds: tierWithoutOffer + paidWithoutOffer + danglingPlans + meteredTierGated,
  };
}

/** Zdanie polityki jako lista części - kolejność: treści, licznik, oferta, zaułki. */
export function describeAccessPolicy(facts: AccessPolicyFacts): PolicySentencePart[] {
  const parts: PolicySentencePart[] = [];

  if (facts.total === 0) {
    parts.push({ key: "adminRevenue.accessTab.policy.noRules", params: {} });
  } else {
    parts.push({ key: "adminRevenue.accessTab.policy.rules", params: { count: facts.total } });
    parts.push({
      key: "adminRevenue.accessTab.policy.modes",
      params: {
        public: facts.byMode.public,
        members: facts.byMode.members,
        paid: facts.byMode.paid,
        password: facts.byMode.password,
      },
    });
    if (facts.rankGated > 0) {
      parts.push({
        key: "adminRevenue.accessTab.policy.rankGated",
        params: { count: facts.rankGated },
      });
    }
  }

  switch (facts.metering.state) {
    case "unknown":
      parts.push({ key: "adminRevenue.accessTab.policy.meteringUnknown", params: {} });
      break;
    case "missing":
      parts.push({ key: "adminRevenue.accessTab.policy.meteringMissing", params: {} });
      break;
    case "off":
      parts.push({ key: "adminRevenue.accessTab.policy.meteringOff", params: {} });
      break;
    case "on":
      parts.push({
        key: "adminRevenue.accessTab.policy.meteringMembers",
        params: { count: facts.metering.memberLimit },
      });
      parts.push(
        facts.metering.anonLimit > 0
          ? {
              key: "adminRevenue.accessTab.policy.meteringGuests",
              params: { count: facts.metering.anonLimit },
            }
          : { key: "adminRevenue.accessTab.policy.meteringGuestsNone", params: {} },
      );
      break;
  }

  parts.push(
    facts.tiersTotal === 0
      ? { key: "adminRevenue.accessTab.policy.tiersNone", params: {} }
      : {
          key: "adminRevenue.accessTab.policy.tiersOfferable",
          params: { count: facts.tiersOfferable, total: facts.tiersTotal },
        },
  );

  parts.push(
    facts.deadEnds > 0
      ? { key: "adminRevenue.accessTab.policy.deadEnds", params: { count: facts.deadEnds } }
      : { key: "adminRevenue.accessTab.policy.deadEndsNone", params: {} },
  );

  return parts;
}
