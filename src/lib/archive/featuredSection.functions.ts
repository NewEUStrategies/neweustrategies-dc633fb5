// Sekcja wyróżniona archiwum kategorii / tagu - odczyt także dla GOŚCIA.
//
// DEFEKT (17.11.2026, odtworzony na lokalnym PG16 jako anon). Archiwum
// czytało szablon sekcji `builder_templates(data)` klientem przeglądarki.
// `anon` nie ma na tej tabeli żadnego grantu (szablony to biblioteka
// redakcji: polityka `templates_read_tenant` wpuszcza wyłącznie
// zalogowanych z najemcy), więc odczyt kończył się 42501, `Promise.all`
// odrzucał całe archiwum, a `/category/$slug` i `/tag/$slug` z ustawionym
// `featured_template_id` pokazywały gościom stronę „brak danych" zamiast
// listy wpisów.
//
// DLACZEGO FUNKCJA SERWEROWA, A NIE GRANT ANI WIDOK. Publicznej drogi do
// szablonów w repo nie ma (żaden widok ani RPC ich nie wystawia), a grant
// albo polityka dla `anon` otworzyłyby CAŁĄ bibliotekę szablonów najemcy -
// także szkice, których nikt nie podpiął pod publiczną stronę. Ta funkcja
// oddaje WYŁĄCZNIE szablon wskazany przez publiczny wiersz kategorii albo
// tagu: ładunek niesie rodzaj i identyfikator terminu, nigdy identyfikator
// szablonu, więc nie da się nią przeczytać szablonu, którego żadna publiczna
// taksonomia nie pokazuje.
//
// GRANICA NAJEMCY. Najemca z hosta żądania (`resolveTenantIdForHost` na
// zaufanym hoście - ta sama płaszczyzna treściowa co `public_tenant_id()`
// po stronie bazy), nigdy z ładunku. Oba odczyty spod service-role niosą
// jawne `.eq("tenant_id", tenantId)`: termin innego najemcy i szablon innego
// najemcy (klucz `featured_template_id` wskazuje samo `builder_templates(id)`,
// bez pary z `tenant_id`) nie wracają.
//
// Wynik to tekst JSON dokumentu sekcji (albo `null`): dokument kreatora jest
// drzewem dowolnej głębokości, a tekst przechodzi przez serializację funkcji
// serwerowej bez zgadywania typów. Rodzaj dokumentu sprawdza tu serwer
// i jeszcze raz czytelnik (`lib/queries/archives.ts`).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const FeaturedSectionInput = z.object({
  kind: z.enum(["category", "tag"]),
  termId: z.string().uuid(),
});

/** Dokument sekcji kreatora - obiekt z `kind: "section"`; nic innego nie wychodzi. */
function sectionJson(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if ((value as { kind?: unknown }).kind !== "section") return null;
  return JSON.stringify(value);
}

export const getArchiveFeaturedSection = createServerFn({ method: "GET" })
  .validator((data: unknown) => FeaturedSectionInput.parse(data))
  .handler(async ({ data }): Promise<{ json: string | null }> => {
    const [{ supabaseAdmin }, { resolveTenantIdForHost }, { currentTenantHost }] =
      await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("@/lib/server/tenant.server"),
        import("@/lib/http/requestHost"),
      ]);
    const tenantId = await resolveTenantIdForHost(await currentTenantHost());
    // Bez najemcy nie ma granicy dla odczytu spod service-role - odmowa, nie
    // zgadywanie. Czytelnik zamienia ją w archiwum bez sekcji wyróżnionej.
    if (!tenantId) throw new Error("archive featured section: tenant unresolved");

    const term =
      data.kind === "category"
        ? await supabaseAdmin
            .from("categories")
            .select("featured_template_id")
            .eq("id", data.termId)
            .eq("tenant_id", tenantId)
            .maybeSingle()
        : await supabaseAdmin
            .from("tags")
            .select("featured_template_id")
            .eq("id", data.termId)
            .eq("tenant_id", tenantId)
            .maybeSingle();
    if (term.error) throw new Error(term.error.message);
    const templateId = term.data?.featured_template_id ?? null;
    if (!templateId) return { json: null };

    const { data: template, error: templateError } = await supabaseAdmin
      .from("builder_templates")
      .select("data")
      .eq("id", templateId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (templateError) throw new Error(templateError.message);
    return { json: sectionJson(template?.data) };
  });
