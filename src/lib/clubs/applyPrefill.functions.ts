// Prefill formularza zgłoszenia klubowego z profilu zalogowanego użytkownika.
//
// DLACZEGO OSOBNY SERVER FN, A NIE ODCZYT Z KLIENTA: `location` i `phone` to
// PII bez grantu kolumnowego dla roli `authenticated` - identycznie jak
// w `joinUsSync.functions.ts`, więc czytamy je przez RPC `get_own_profile`
// (SECURITY DEFINER, zakres `auth.uid()`).
//
// DLACZEGO TU PREFILL JEST, A W WIDGECIE NEWSLETTERA GO NIE MA: tam publiczny
// widget marketingowy z kilkoma polami i placeholderami i18n, tutaj formularz za
// dwiema bramkami (konto + PRO), z czternastoma polami obowiązkowymi, z czego
// osiem platforma już zna. Przepisywanie ich ręcznie to jedyny efekt braku
// prefillu.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ClubApplyPrefill = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  jobPosition: string;
  country: string;
  linkedinUrl: string;
};

const EMPTY: ClubApplyPrefill = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  jobPosition: "",
  country: "",
  linkedinUrl: "",
};

// GET (auth): user czyta wyłącznie własny profil. Błąd odczytu zwraca puste
// stringi i NIGDY nie rzuca - prefill jest udogodnieniem, a nie warunkiem
// wypełnienia formularza; wyjątek zablokowałby całą stronę zgłoszenia.
export const getClubApplyPrefill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClubApplyPrefill> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("get_own_profile");
    const data = rows?.[0];
    if (error || !data) return EMPTY;
    return {
      firstName: data.first_name ?? "",
      lastName: data.last_name ?? "",
      // Adres kontaktowy wygrywa nad loginowym: to on jest deklarowanym
      // kanałem korespondencji, a komisja odpisuje na zgłoszenie. `||`, nie
      // `??`, bo puste `contact_email` w bazie nie może zjeść adresu konta -
      // e-mail jest polem obowiązkowym zgłoszenia.
      email: data.contact_email || data.email || "",
      phone: data.phone ?? "",
      company: data.current_company ?? "",
      jobPosition: data.job_title ?? "",
      country: data.location ?? "",
      linkedinUrl: data.linkedin_url ?? "",
    };
  });
