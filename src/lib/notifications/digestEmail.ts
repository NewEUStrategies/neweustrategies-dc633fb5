// Czysty builder HTML digestu e-mail (unit-testowalny, bez Supabase/env).
// Wysyłka: dispatch.server.ts przez ten sam gateway Resend co newsletter.

export interface DigestItem {
  kind: string;
  title_pl: string | null;
  title_en: string | null;
  body_pl: string | null;
  body_en: string | null;
  href: string | null;
  created_at: string;
}

export type DigestLang = "pl" | "en";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function pickDigestText(
  item: Pick<DigestItem, "title_pl" | "title_en">,
  lang: DigestLang,
): string {
  const primary = lang === "en" ? item.title_en : item.title_pl;
  const fallback = lang === "en" ? item.title_pl : item.title_en;
  return (primary ?? "").trim() || (fallback ?? "").trim();
}

/**
 * Nagłówki sekcji digestu per rodzaj powiadomienia. Alerty trackera dostają
 * własną sekcję na górze, żeby digest czytał się jak brief legislacyjny, a nie
 * płaska lista - to krok w stronę produktu danych (Politico PRO). Kolejność w
 * tej tablicy wyznacza kolejność sekcji; rodzaje spoza listy trafiają do
 * sekcji "pozostałe" (kind === null).
 */
const DIGEST_SECTIONS: { kind: string | null; pl: string; en: string }[] = [
  { kind: "tracker", pl: "Tracker legislacyjny UE", en: "EU legislative tracker" },
  { kind: "content", pl: "Nowe treści", en: "New content" },
  { kind: "comment", pl: "Komentarze", en: "Comments" },
  { kind: "message", pl: "Wiadomości", en: "Messages" },
  { kind: "follow", pl: "Obserwujący", en: "Followers" },
  { kind: "subscription", pl: "Subskrypcja", en: "Subscription" },
  { kind: null, pl: "Pozostałe", en: "Other" },
];

export function digestSubject(
  count: number,
  lang: DigestLang,
  frequency: "daily" | "weekly",
): string {
  if (lang === "en") {
    const period = frequency === "daily" ? "today" : "this week";
    return count === 1
      ? `1 update ${period} - New European Strategies`
      : `${count} updates ${period} - New European Strategies`;
  }
  const period = frequency === "daily" ? "z ostatniego dnia" : "z ostatniego tygodnia";
  return `Masz ${count} ${count === 1 ? "powiadomienie" : count < 5 ? "powiadomienia" : "powiadomień"} ${period} - New European Strategies`;
}

/**
 * Prosty, klient-poczty-odporny HTML (inline style, jedna kolumna).
 * Linki są absolutyzowane względem siteUrl; element bez href pomijamy w liście
 * linkowanej, ale pokazujemy jako tekst.
 */
export function buildDigestHtml(opts: {
  displayName: string;
  items: DigestItem[];
  lang: DigestLang;
  siteUrl: string;
  frequency: "daily" | "weekly";
}): string {
  const { displayName, items, lang, siteUrl, frequency } = opts;
  const heading =
    lang === "en"
      ? `Hi ${esc(displayName)}, here is what you missed`
      : `Cześć ${esc(displayName)}, oto co Cię ominęło`;
  const intro =
    lang === "en"
      ? frequency === "daily"
        ? "Your daily summary of unread notifications:"
        : "Your weekly summary of unread notifications:"
      : frequency === "daily"
        ? "Twoje dzienne podsumowanie nieprzeczytanych powiadomień:"
        : "Twoje tygodniowe podsumowanie nieprzeczytanych powiadomień:";
  const manage =
    lang === "en" ? "Manage notification settings" : "Zarządzaj ustawieniami powiadomień";

  const renderItem = (item: DigestItem): string => {
    const title = pickDigestText(item, lang);
    if (!title) return "";
    const bodyRaw = lang === "en" ? (item.body_en ?? item.body_pl) : (item.body_pl ?? item.body_en);
    const body = (bodyRaw ?? "").trim();
    const href = item.href ? new URL(item.href, siteUrl).toString() : null;
    const titleHtml = href
      ? `<a href="${esc(href)}" style="color:#1a3c8b;text-decoration:none;font-weight:600">${esc(title)}</a>`
      : `<span style="font-weight:600">${esc(title)}</span>`;
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #e8e8ef">
        ${titleHtml}
        ${body ? `<div style="color:#555;font-size:13px;margin-top:2px">${esc(body)}</div>` : ""}
      </td></tr>`;
  };

  // Grupowanie per rodzaj z nagłówkiem sekcji. Sekcja renderuje się tylko gdy
  // ma pozycje; nagłówek pomijamy, jeśli wszystkie pozycje są jednego rodzaju
  // (płaska lista czyta się lepiej niż jedna sekcja z nagłówkiem).
  const distinctKinds = new Set(items.map((i) => i.kind));
  const rows = DIGEST_SECTIONS.map((section) => {
    const inSection = items.filter((i) =>
      section.kind === null
        ? !DIGEST_SECTIONS.some((s) => s.kind === i.kind)
        : i.kind === section.kind,
    );
    if (inSection.length === 0) return "";
    const body = inSection.map(renderItem).filter(Boolean).join("");
    if (!body) return "";
    if (distinctKinds.size <= 1) return body;
    const heading = lang === "en" ? section.en : section.pl;
    return `<tr><td style="padding:16px 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#1a3c8b">${esc(heading)}</td></tr>${body}`;
  })
    .filter(Boolean)
    .join("");

  const settingsUrl = new URL("/profile/account", siteUrl).toString();

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:28px 32px;font-family:Arial,Helvetica,sans-serif">
        <tr><td style="font-size:18px;font-weight:700;color:#111">${heading}</td></tr>
        <tr><td style="font-size:14px;color:#444;padding-top:6px">${intro}</td></tr>
        <tr><td style="padding-top:10px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td></tr>
        <tr><td style="padding-top:18px;font-size:12px;color:#888">
          <a href="${esc(settingsUrl)}" style="color:#888">${manage}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
