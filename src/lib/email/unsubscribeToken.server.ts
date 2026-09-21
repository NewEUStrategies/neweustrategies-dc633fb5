// Token wypisu dla poczty aplikacji.
//
// Dostawca platformy ODRZUCA (400 `missing_unsubscribe`) każdą wiadomość
// transakcyjną bez `unsubscribe_token` - stopka wypisu jest doklejana po jego
// stronie i nie da się jej wyłączyć. Kolejkowanie w `transactional.server`
// pomijało to pole, więc cała poczta aplikacji kończyła w DLQ.
//
// Jeden token na adres: tabela `email_unsubscribe_tokens` ma unikat po `email`.
// Token zużyty (odbiorca kiedyś się wypisał) rotujemy, żeby link w mailu
// realnie działał - o tym, czy wysyłka w ogóle ma prawo wyjść, decyduje bramka
// listy wykluczeń, nie ten moduł.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ensureUnsubscribeToken(
  supabase: SupabaseClient<Database>,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const { data: existing } = await supabase
    .from("email_unsubscribe_tokens")
    .select("token, used_at")
    .eq("email", normalized)
    .maybeSingle();

  if (existing && !existing.used_at) return existing.token;

  const token = generateToken();

  if (existing) {
    const { error } = await supabase
      .from("email_unsubscribe_tokens")
      .update({ token, used_at: null })
      .eq("email", normalized);
    return error ? null : token;
  }

  const { error } = await supabase
    .from("email_unsubscribe_tokens")
    .upsert({ token, email: normalized }, { onConflict: "email", ignoreDuplicates: true });
  if (error) return null;

  // Równoległe żądanie mogło wygrać wyścig - czytamy faktycznie zapisany token.
  const { data: stored } = await supabase
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", normalized)
    .maybeSingle();
  return stored?.token ?? null;
}
