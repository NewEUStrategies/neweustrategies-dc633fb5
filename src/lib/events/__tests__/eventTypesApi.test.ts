// Warstwa danych katalogu rodzajów - NAZWA RPC I NAZWY ARGUMENTÓW.
//
// DLACZEGO TO JEST TESTOWALNY KONTRAKT. Katalog jest RPC-only: tabela
// `event_types` ma dla klienta wyłącznie SELECT, a każdy zapis idzie przez
// funkcję SECURITY DEFINER z bramką `assert_admin_tenant()`. Serwer zakresuje po
// tym, co dostanie, więc zgubiony albo przemianowany argument jest równoważny
// utracie zawężenia - a taki błąd przechodzi przez `tsc` (obiekt argumentów jest
// luźny), przez przegląd (jedna literówka wśród dwudziestu podobnych wierszy)
// i przez interfejs (lista i tak coś pokazuje).
//
// CO TEN PLIK DOWODZI.
//   1. NAZWY FUNKCJI zgadzają się z migracją co do znaku.
//   2. PAYLOAD jsonb jedzie w snake_case, bo to kontrakt BAZY - a tłumaczenie
//      camelCase -> snake_case żyje w jednym miejscu.
//   3. `null` W LICZBACH JEDZIE JAKO `null`, nie jako pusty napis: RPC rozróżnia
//      „pole podano jako puste" od „pola nie podano" operatorem `?`.
//   4. ODMOWA BAZY JEST PRZEPUSZCZANA, nie tłumiona - mapowanie na zdanie dla
//      człowieka należy do warstwy reguł, nie do warstwy danych.
//   5. PUSTY ZBIÓR ODCZYTU to `[]`, nie `null` - lista, która dostaje `null`,
//      renderuje awarię tam, gdzie jest po prostu pusty katalog.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const {
  deleteEventType,
  fetchActiveEventTypes,
  fetchAdminEventTypes,
  reassignEventType,
  setEventTypeActive,
  upsertEventType,
} = await import("@/lib/events/eventTypesApi");

type Payload = Record<string, unknown>;

/** Wejście mutacji zapisu w kształcie, w jakim je składa formularz. */
function wejscie(patch: Partial<Parameters<typeof upsertEventType>[0]> = {}) {
  return {
    id: null,
    key: "panel_ekspertow",
    namePl: "Panel ekspertów",
    nameEn: "Expert panel",
    descriptionPl: "Opis PL",
    descriptionEn: "Opis EN",
    icon: "Users",
    accentColor: "#1d4ed8",
    defaultFormat: "onsite",
    defaultRegistrationMode: "form",
    defaultRegistrationFlow: "approval",
    defaultGuestMode: "teaser",
    defaultCapacity: 24,
    defaultDurationMinutes: 120,
    defaultMinTierRank: 2,
    defaultChathamHouse: true,
    requiresTicket: false,
    sortOrder: 30,
    isActive: true,
    ...patch,
  };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("odczyt katalogu", () => {
  it("publiczna lista woła `event_types_active` bez argumentów", async () => {
    h.rpc?.setData("event_types_active", [{ id: "a", key: "webinar" }]);
    await fetchActiveEventTypes();
    expect(h.rpc?.names()).toEqual(["event_types_active"]);
    expect(h.rpc?.lastCall("event_types_active")?.keys()).toEqual([]);
  });

  it("lista panelu woła `admin_event_types_list` bez argumentów", async () => {
    h.rpc?.setData("admin_event_types_list", []);
    await fetchAdminEventTypes();
    expect(h.rpc?.names()).toEqual(["admin_event_types_list"]);
  });

  it("pusty odczyt oddaje tablicę pustą, nie NULL", async () => {
    h.rpc?.setData("admin_event_types_list", null);
    await expect(fetchAdminEventTypes()).resolves.toEqual([]);
    h.rpc?.setData("event_types_active", null);
    await expect(fetchActiveEventTypes()).resolves.toEqual([]);
  });

  it("odmowa bazy leci dalej, a nie zamienia się w pustą listę", async () => {
    h.rpc?.setError("admin_event_types_list", "permission denied for function", "42501");
    await expect(fetchAdminEventTypes()).rejects.toThrow("permission denied for function");
  });
});

describe("zapis rodzaju", () => {
  it("woła `admin_event_type_upsert` z JEDNYM argumentem `p_payload`", async () => {
    h.rpc?.setData("admin_event_type_upsert", "22222222-2222-4222-8222-222222222222");
    await upsertEventType(wejscie());
    const call = h.rpc?.lastCall("admin_event_type_upsert");
    expect(call?.keys()).toEqual(["p_payload"]);
  });

  it("payload jedzie w snake_case, czyli w kontrakcie BAZY", async () => {
    h.rpc?.setData("admin_event_type_upsert", "id");
    await upsertEventType(wejscie());
    const payload = h.rpc?.lastCall("admin_event_type_upsert")?.arg("p_payload") as Payload;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "accent_color",
        "default_capacity",
        "default_chatham_house",
        "default_duration_minutes",
        "default_format",
        "default_guest_mode",
        "default_min_tier_rank",
        "default_registration_flow",
        "default_registration_mode",
        "description_en",
        "description_pl",
        "icon",
        "id",
        "is_active",
        "key",
        "name_en",
        "name_pl",
        "requires_ticket",
        "sort_order",
      ].sort(),
    );
    expect(payload.name_pl).toBe("Panel ekspertów");
    expect(payload.default_registration_flow).toBe("approval");
    expect(payload.default_chatham_house).toBe(true);
  });

  it("brak limitu jedzie jako `null`, nie jako pusty napis", async () => {
    // RPC czyta `p_payload ? 'default_capacity'`, więc jawny `null` CZYŚCI
    // wartość, a brak klucza ją zachowuje. Pusty napis jest w jsonb
    // nieodróżnialny od „pole pominięte" dla człowieka czytającego payload.
    h.rpc?.setData("admin_event_type_upsert", "id");
    await upsertEventType(wejscie({ defaultCapacity: null, accentColor: null }));
    const payload = h.rpc?.lastCall("admin_event_type_upsert")?.arg("p_payload") as Payload;
    expect(payload.default_capacity).toBeNull();
    expect(payload.accent_color).toBeNull();
  });

  it("edycja niesie `id`, tworzenie niesie `null`", async () => {
    h.rpc?.setData("admin_event_type_upsert", "id");
    await upsertEventType(wejscie({ id: "33333333-3333-4333-8333-333333333333" }));
    const edycja = h.rpc?.lastCall("admin_event_type_upsert")?.arg("p_payload") as Payload;
    expect(edycja.id).toBe("33333333-3333-4333-8333-333333333333");

    await upsertEventType(wejscie({ id: null }));
    const nowy = h.rpc?.lastCall("admin_event_type_upsert")?.arg("p_payload") as Payload;
    expect(nowy.id).toBeNull();
  });

  it("oddaje identyfikator zapisanego wiersza jako napis", async () => {
    h.rpc?.setData("admin_event_type_upsert", "44444444-4444-4444-8444-444444444444");
    await expect(upsertEventType(wejscie())).resolves.toBe("44444444-4444-4444-8444-444444444444");
  });

  it("odmowa zapisu leci dalej z treścią z bazy", async () => {
    h.rpc?.setError("admin_event_type_upsert", "duplicate key value violates unique constraint");
    await expect(upsertEventType(wejscie())).rejects.toThrow("duplicate key");
  });
});

describe("przełącznik i usunięcie", () => {
  it("przełącznik woła `_id` i `_is_active` - nazwy z sygnatury RPC", async () => {
    h.rpc?.setData("admin_event_type_set_active", true);
    await setEventTypeActive("abc", false);
    const call = h.rpc?.lastCall("admin_event_type_set_active");
    expect(call?.keys().sort()).toEqual(["_id", "_is_active"]);
    expect(call?.arg("_id")).toBe("abc");
    expect(call?.arg("_is_active")).toBe(false);
  });

  it("usunięcie woła `_id`", async () => {
    h.rpc?.setData("admin_event_type_delete", true);
    await deleteEventType("abc");
    expect(h.rpc?.lastCall("admin_event_type_delete")?.arg("_id")).toBe("abc");
  });

  it("odmowa usunięcia leci dalej z kodem przyczyny", async () => {
    h.rpc?.setError(
      "admin_event_type_delete",
      "event_type_in_use: 12 event(s) still use this type",
    );
    await expect(deleteEventType("abc")).rejects.toThrow("event_type_in_use");
  });
});

describe("przepięcie wydarzeń", () => {
  it("woła `_from_id` i `_to_id` i oddaje LICZBĘ przepiętych wierszy", async () => {
    // Liczba jest treścią potwierdzenia dla redaktora, nie dekoracją: bez niej
    // „przepięto" po operacji na czterdziestu wydarzeniach jest nieodróżnialne
    // od „przepięto" na zerze.
    h.rpc?.setData("admin_event_type_reassign", 40);
    await expect(reassignEventType("a", "b")).resolves.toBe(40);
    const call = h.rpc?.lastCall("admin_event_type_reassign");
    expect(call?.arg("_from_id")).toBe("a");
    expect(call?.arg("_to_id")).toBe("b");
  });

  it("brak zwrotki liczbowej znaczy zero, nie NaN", async () => {
    h.rpc?.setData("admin_event_type_reassign", null);
    await expect(reassignEventType("a", "b")).resolves.toBe(0);
  });

  it("odmowa przepięcia leci dalej", async () => {
    h.rpc?.setError("admin_event_type_reassign", "invalid_target: source and target are the same");
    await expect(reassignEventType("a", "a")).rejects.toThrow("invalid_target");
  });
});
