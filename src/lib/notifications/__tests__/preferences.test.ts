import { describe, it, expect } from "vitest";
import {
  ALLOW_MESSAGES_FROM_LEVELS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_GROUPS,
  NOTIFICATION_PREFERENCE_COLUMNS,
  NOTIFICATION_PREFERENCE_SELECT,
  TOGGLEABLE_NOTIFICATION_KINDS,
  isNotificationKindEnabled,
  type NotificationKind,
  type NotificationPreferences,
} from "../preferences";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";
import { chatPl, chatEn } from "@/lib/i18n-chat";

const prefs: NotificationPreferences = {
  ...DEFAULT_NOTIFICATION_PREFERENCES,
  enabled_comment: false,
  enabled_subscription: false,
  enabled_crm_task: false,
};

// Sekcje ustawień: podział jest DANYMI (katalog grup), więc ma własny kontrakt.
// Rozjazd grup <-> przełączników nie jest tu „możliwy do przetestowania" -
// TOGGLEABLE_NOTIFICATION_KINDS jest z grup wyprowadzone. Testujemy to, co
// wyprowadzenie NADAL może zepsuć: duplikat rodzaju w dwóch grupach, rodzaj
// always-on wśród przełączników i grupę bez etykiety w którymś z języków.
describe("NOTIFICATION_KIND_GROUPS", () => {
  it("przypisuje każdy rodzaj do DOKŁADNIE jednej grupy", () => {
    const flat = NOTIFICATION_KIND_GROUPS.flatMap((group) => [...group.kinds]);
    expect(flat).toHaveLength(new Set(flat).size);
  });

  it("nie wciąga rodzaju always-on (security) do przełączników", () => {
    for (const group of NOTIFICATION_KIND_GROUPS) {
      expect(group.kinds).not.toContain("security");
    }
  });

  it("każda grupa ma ikonę nagłówka i co najmniej jeden rodzaj", () => {
    for (const group of NOTIFICATION_KIND_GROUPS) {
      expect(group.icon).not.toBe("");
      expect(group.kinds.length).toBeGreaterThan(0);
    }
  });
});

describe("TOGGLEABLE_NOTIFICATION_KINDS", () => {
  it("lists the user-toggleable kinds and excludes security", () => {
    expect([...TOGGLEABLE_NOTIFICATION_KINDS]).toEqual([
      "message",
      "expert_request",
      "club",
      "connection",
      "introduction",
      "recommendation",
      "endorsement",
      "profile_view",
      "meeting_booking",
      "follow",
      "comment",
      "content",
      "saved_search",
      "tracker",
      "crm_task",
      "subscription",
      "system",
    ]);
    expect(TOGGLEABLE_NOTIFICATION_KINDS).not.toContain("security");
  });

  // Lista przełączników jest SPŁASZCZENIEM grup, nie drugą listą - inaczej
  // rodzaj dopisany do jednej z nich cicho ginął w drugiej.
  it("jest spłaszczeniem katalogu grup (jedno źródło kolejności)", () => {
    expect([...TOGGLEABLE_NOTIFICATION_KINDS]).toEqual(
      NOTIFICATION_KIND_GROUPS.flatMap((group) => [...group.kinds]),
    );
  });
});

describe("NOTIFICATION_KINDS", () => {
  it("is the toggleable catalogue plus the always-on security kind", () => {
    expect([...NOTIFICATION_KINDS]).toEqual([...TOGGLEABLE_NOTIFICATION_KINDS, "security"]);
  });

  // Katalog UI musi pokrywać się z CHECK-iem `notifications_kind_check`
  // (patrz supabase/tests/notification_preferences_gating_test.sql, asercja
  // parytetu). Rodzaj, którego nie ma tutaj, przychodzi z bazy jako
  // nieprzefiltrowany, nieopisany wpis w skrzynce.
  it("covers every kind allowed by the database catalogue", () => {
    const dbKinds: NotificationKind[] = [
      "system",
      "comment",
      "follow",
      "subscription",
      "content",
      "security",
      "message",
      "tracker",
      "connection",
      "saved_search",
      "crm_task",
      "expert_request",
      // 20260807073000: pięć zdarzeń sieciowych, które do 08.2026 nie miały
      // ANI JEDNEGO producenta powiadomień.
      "introduction",
      "recommendation",
      "endorsement",
      "profile_view",
      "meeting_booking",
      // 20260808094000 (etap A4 Klubu dyskusyjnego): rodzaj 'club'.
      "club",
    ];
    expect([...NOTIFICATION_KINDS].sort()).toEqual([...dbKinds].sort());
  });

  // Każdy przełączalny rodzaj potrzebuje flagi `enabled_<kind>` - inaczej
  // przełącznik w ustawieniach nie ma czego zapisać (martwy przełącznik).
  it("has an enabled_<kind> flag for every toggleable kind", () => {
    for (const kind of TOGGLEABLE_NOTIFICATION_KINDS) {
      expect(DEFAULT_NOTIFICATION_PREFERENCES).toHaveProperty(`enabled_${kind}`);
    }
  });
});

describe("NOTIFICATION_PREFERENCE_COLUMNS", () => {
  // Regresja: ręczna lista kolumn w `useNotificationPreferences` gubiła
  // `enabled_saved_search` i `enabled_crm_task`, więc zapis "wyłączone" nigdy
  // nie wracał z bazy - przełącznik po odświeżeniu wskakiwał z powrotem na
  // "włączone" (merge z wartościami domyślnymi), mimo że producent w bazie
  // powiadomienia poprawnie tłumił.
  it("covers every field of the preferences row", () => {
    expect([...NOTIFICATION_PREFERENCE_COLUMNS].sort()).toEqual(
      Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).sort(),
    );
  });

  it("fetches the flag of every toggleable kind", () => {
    for (const kind of TOGGLEABLE_NOTIFICATION_KINDS) {
      expect(NOTIFICATION_PREFERENCE_COLUMNS).toContain(`enabled_${kind}`);
    }
  });

  it("renders a PostgREST select list (never a wildcard)", () => {
    expect(NOTIFICATION_PREFERENCE_SELECT).not.toContain("*");
    expect(NOTIFICATION_PREFERENCE_SELECT.split(", ")).toEqual([
      ...NOTIFICATION_PREFERENCE_COLUMNS,
    ]);
  });
});

describe("isNotificationKindEnabled", () => {
  it("gates each kind on its enabled_<kind> flag", () => {
    expect(isNotificationKindEnabled(prefs, "message")).toBe(true);
    expect(isNotificationKindEnabled(prefs, "comment")).toBe(false);
    expect(isNotificationKindEnabled(prefs, "subscription")).toBe(false);
    expect(isNotificationKindEnabled(prefs, "content")).toBe(true);
    expect(isNotificationKindEnabled(prefs, "crm_task")).toBe(false);
  });

  it("reads the flag of every toggleable kind (no kind falls through)", () => {
    for (const kind of TOGGLEABLE_NOTIFICATION_KINDS) {
      const off: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
      Object.assign(off, { [`enabled_${kind}`]: false });
      expect(isNotificationKindEnabled(off, kind)).toBe(false);
      expect(isNotificationKindEnabled(DEFAULT_NOTIFICATION_PREFERENCES, kind)).toBe(true);
    }
  });

  it("always reports security as enabled, regardless of the stored flag", () => {
    expect(isNotificationKindEnabled(prefs, "security")).toBe(true);
    const off = { ...prefs, enabled_security: false };
    expect(isNotificationKindEnabled(off, "security")).toBe(true);
  });
});

// i18n: każdy rodzaj z katalogu ma etykietę PL i EN. Bez tego przełącznik (albo
// pozycja filtra) renderuje surowy klucz w rodzaju "saved_search".
describe("notification kind labels (PL/EN)", () => {
  function kindLabels(bundle: unknown): Record<string, unknown> {
    const tree = bundle as {
      notifications?: { settings?: { kinds?: Record<string, unknown> } };
    };
    return tree.notifications?.settings?.kinds ?? {};
  }

  it.each([...NOTIFICATION_KINDS])("has a PL and EN label for %s", (kind) => {
    const plLabel = kindLabels(pl)[kind];
    const enLabel = kindLabels(en)[kind];
    expect(typeof plLabel).toBe("string");
    expect(typeof enLabel).toBe("string");
    expect(plLabel).not.toBe("");
    expect(enLabel).not.toBe("");
  });
});

// Nagłówki sekcji ustawień: brak któregokolwiek renderuje surowy identyfikator
// grupy („workspace") jako tytuł sekcji.
describe("notification kind group labels (PL/EN)", () => {
  function groupLabels(bundle: unknown): Record<string, unknown> {
    const tree = bundle as {
      notifications?: { settings?: { kindGroups?: Record<string, unknown> } };
    };
    return tree.notifications?.settings?.kindGroups ?? {};
  }

  it.each(NOTIFICATION_KIND_GROUPS.map((group) => group.id))(
    "ma tytuł i podpis PL oraz EN dla grupy %s",
    (id) => {
      for (const key of [id, `${id}Hint`]) {
        const plLabel = groupLabels(pl)[key];
        const enLabel = groupLabels(en)[key];
        expect(typeof plLabel).toBe("string");
        expect(typeof enLabel).toBe("string");
        expect(plLabel).not.toBe("");
        expect(enLabel).not.toBe("");
        expect(plLabel).not.toBe(enLabel);
      }
    },
  );
});

// §9 audytu: `contacts` przestał być fantomem w bramce czatu i stał się realnym
// poziomem prywatności. Trzy rzeczy muszą trzymać się razem, bo rozjazd
// któregokolwiek daje albo martwą opcję w UI, albo naruszenie CHECK-a w bazie:
//   1. unia typu = CHECK `notification_preferences_allow_messages_from_check`,
//   2. kolejność listy = malejąca otwartość (kolejność opcji w selectcie),
//   3. wartość domyślna zostaje `everyone` - migracja nikomu nic nie zacieśnia.
describe("ALLOW_MESSAGES_FROM_LEVELS", () => {
  it("zawiera dokładnie cztery poziomy w kolejności malejącej otwartości", () => {
    expect([...ALLOW_MESSAGES_FROM_LEVELS]).toEqual(["everyone", "contacts", "existing", "nobody"]);
  });

  it("nie zmienia wartości domyślnej", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.allow_messages_from).toBe("everyone");
  });

  it("każdy poziom jest przypisywalny do preferencji (unia pokrywa listę)", () => {
    for (const level of ALLOW_MESSAGES_FROM_LEVELS) {
      const next: NotificationPreferences = {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        allow_messages_from: level,
      };
      expect(next.allow_messages_from).toBe(level);
    }
  });
});

// Etykiety opcji: brak którejkolwiek daje select z surowym kluczem i18n.
describe("allow_messages_from labels (PL/EN)", () => {
  function optionLabels(bundle: unknown): Record<string, unknown> {
    const tree = bundle as { profilePrivacy?: Record<string, unknown> };
    return tree.profilePrivacy ?? {};
  }

  const KEY_BY_LEVEL: Readonly<Record<string, string>> = {
    everyone: "allowMessagesEveryone",
    contacts: "allowMessagesContacts",
    existing: "allowMessagesExisting",
    nobody: "allowMessagesNobody",
  };

  it.each([...ALLOW_MESSAGES_FROM_LEVELS])("ma etykietę PL i EN dla %s", (level) => {
    const key = KEY_BY_LEVEL[level] ?? "";
    const plLabel = optionLabels(chatPl)[key];
    const enLabel = optionLabels(chatEn)[key];
    expect(typeof plLabel).toBe("string");
    expect(typeof enLabel).toBe("string");
    expect(plLabel).not.toBe("");
    expect(enLabel).not.toBe("");
    expect(plLabel).not.toBe(enLabel);
  });
});
