// Ustalanie imienia odbiorcy maila - i odmiana w wołaczu.
//
// Powierzchnia mała, konsekwencja duża: to jest pierwsza linijka KAŻDEJ
// wiadomości. Pomyłka nie wywala wysyłki, tylko wysyła 40 tysiącom osób
// „Cześć null" albo wita imieniem z cudzego wiersza. Testy pilnują kolejności
// źródeł (metadane auth -> formularz newslettera), progu sensowności tokenu
// i tego, że słownik imion z panelu admina ma pierwszeństwo przed automatem.
//
// Reguł samej odmiany (`polishVocative`) tu nie powtarzamy - mają własny
// moduł; tutaj sprawdzamy, KTÓRE imię i KTÓRA płeć do niej trafiają.
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { resolveRecipientName } from "@/lib/email/recipient-name.server";

const db = supabaseFromStub();
const client = () => ({ from: db.from }) as unknown as SupabaseClient;

/** Brak wiersza w tabeli - PostgREST oddaje `null`, nie błąd. */
const NO_ROW = ok(null);

beforeEach(() => {
  db.reset();
  db.setResponse("newsletter_subscribers", NO_ROW);
  db.setResponse("name_dictionary", NO_ROW);
});

describe("źródło imienia", () => {
  it("metadane auth mają pierwszeństwo - baza subskrybentów nie jest ruszana", async () => {
    const res = await resolveRecipientName(client(), "kto@example.test", "Anna");

    expect(res.firstName).toBe("Anna");
    expect(db.chainsFor("newsletter_subscribers")).toHaveLength(0);
  });

  it("bez metadanych sięga po imię z formularza newslettera", async () => {
    db.setResponse("newsletter_subscribers", ok({ first_name: "Marek", display_name: null }));

    const res = await resolveRecipientName(client(), "kto@example.test");

    expect(res.firstName).toBe("Marek");
    const chain = db.lastChain("newsletter_subscribers");
    expect(chain?.argsOf("ilike")).toEqual(["email", "kto@example.test"]);
  });

  it("bierze NAJNOWSZY wiersz subskrybenta, nie dowolny", async () => {
    db.setResponse("newsletter_subscribers", ok({ first_name: "Marek", display_name: null }));

    await resolveRecipientName(client(), "kto@example.test");

    const chain = db.lastChain("newsletter_subscribers");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([1]);
  });

  it("gdy nie ma imienia, schodzi na pełną nazwę z formularza", async () => {
    db.setResponse("newsletter_subscribers", ok({ first_name: null, display_name: "Zofia Nowak" }));

    const res = await resolveRecipientName(client(), "kto@example.test");

    expect(res.firstName).toBe("Zofia");
    expect(res.vocativePl).toBeTruthy();
  });

  it("brak jakiegokolwiek imienia daje pusty wynik i NIE pyta o słownik", async () => {
    const res = await resolveRecipientName(client(), "kto@example.test");

    expect(res).toEqual({ firstName: null, gender: "unknown", vocativePl: null });
    expect(db.chainsFor("name_dictionary")).toHaveLength(0);
  });

  it("pusty adres nie wywołuje zapytania o subskrybenta", async () => {
    const res = await resolveRecipientName(client(), "");

    expect(res.firstName).toBeNull();
    expect(db.chainsFor("newsletter_subscribers")).toHaveLength(0);
  });
});

describe("wybór tokenu imienia", () => {
  it("z wieloczłonowej nazwy bierze pierwszy człon", async () => {
    const res = await resolveRecipientName(client(), "kto@example.test", "Anna Maria Kowalska");

    expect(res.firstName).toBe("Anna");
    expect(res.firstName).not.toContain(" ");
  });

  it("token jednoznakowy to nie imię (inicjał) - odrzucany", async () => {
    const res = await resolveRecipientName(client(), "kto@example.test", "A Kowalski");

    expect(res.firstName).toBeNull();
    expect(res.vocativePl).toBeNull();
  });

  it("same białe znaki to brak imienia", async () => {
    const res = await resolveRecipientName(client(), "kto@example.test", "   ");

    expect(res.firstName).toBeNull();
    expect(res.gender).toBe("unknown");
  });
});

describe("słownik imion z panelu admina", () => {
  it("płeć ze słownika nadpisuje tę z metadanych", async () => {
    db.setResponse("name_dictionary", ok({ gender: "female", vocative_pl: null }));

    const res = await resolveRecipientName(client(), "kto@example.test", "Ola", "male");

    expect(res.gender).toBe("female");
    expect(res.firstName).toBe("Ola");
  });

  it("odmiana ze słownika wygrywa z automatem", async () => {
    db.setResponse("name_dictionary", ok({ gender: "male", vocative_pl: "Jacusiu" }));

    const res = await resolveRecipientName(client(), "kto@example.test", "Jacek");

    expect(res.vocativePl).toBe("Jacusiu");
    expect(res.gender).toBe("male");
  });

  it("pusta odmiana w słowniku schodzi na automat, zamiast wysłać pustkę", async () => {
    db.setResponse("name_dictionary", ok({ gender: "female", vocative_pl: "   " }));

    const res = await resolveRecipientName(client(), "kto@example.test", "Anna");

    expect(res.vocativePl).toBe("Anno");
    expect(res.gender).toBe("female");
  });

  it("płeć spoza słownika wartości nie psuje płci z metadanych", async () => {
    db.setResponse("name_dictionary", ok({ gender: "other", vocative_pl: null }));

    const res = await resolveRecipientName(client(), "kto@example.test", "Jan", "male");

    expect(res.gender).toBe("male");
    expect(res.vocativePl).toBe("Janie");
  });

  it("brak wpisu w słowniku - odmiana z automatu, płeć bez zmian", async () => {
    const res = await resolveRecipientName(client(), "kto@example.test", "Piotr");

    expect(res.gender).toBe("unknown");
    expect(res.vocativePl).toBeTruthy();
  });

  it("szuka po znormalizowanej (małymi literami) formie imienia", async () => {
    db.setResponse("name_dictionary", ok({ gender: "female", vocative_pl: "Aniu" }));

    await resolveRecipientName(client(), "kto@example.test", "ANNA");

    const filter = String(db.lastChain("name_dictionary")?.argsOf("or")?.[0] ?? "");
    expect(filter).toContain("anna");
    expect(filter).not.toContain("ANNA");
  });
});
