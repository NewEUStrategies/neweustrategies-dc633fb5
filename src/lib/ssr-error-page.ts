/**
 * Emergency HTML fallback rendered when the SSR pipeline cannot deliver the
 * app itself. Dependency-free by design: this page must render even when the
 * app bundle failed to boot, so no imports (no i18n runtime, no CSS files,
 * no fonts loaded from disk) — everything is inlined.
 *
 * Bilingual (PL/EN) inline to match project convention. `robots: noindex`
 * so crawlers never index the fallback.
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Strona chwilowo niedostępna · Page temporarily unavailable</title>
    <style>
      :root {
        --bg: #f8fafc;
        --surface: #ffffff;
        --text: #0f172a;
        --muted: #475569;
        --border: #e2e8f0;
        --primary: #0f172a;
        --primary-fg: #ffffff;
        --radius: 12px;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0b1220;
          --surface: #111827;
          --text: #f8fafc;
          --muted: #94a3b8;
          --border: #1f2937;
          --primary: #f8fafc;
          --primary-fg: #0f172a;
        }
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: "Red Hat Display", system-ui, -apple-system, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      .card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 2.5rem 2rem;
        max-width: 30rem;
        width: 100%;
        text-align: center;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .icon {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--text) 8%, transparent);
        display: grid;
        place-items: center;
        margin: 0 auto 1.25rem;
      }
      .icon svg { width: 22px; height: 22px; stroke: var(--text); }
      h1 {
        font-size: 1.375rem;
        font-weight: 700;
        margin: 0 0 0.375rem;
        letter-spacing: -0.01em;
      }
      .sub { font-size: 0.875rem; color: var(--muted); margin: 0 0 0.25rem; }
      p.desc { color: var(--muted); margin: 1rem 0 1.75rem; font-size: 0.9375rem; }
      .actions { display: flex; gap: 0.625rem; justify-content: center; flex-wrap: wrap; }
      button, a.btn {
        appearance: none;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-weight: 500;
        padding: 0.625rem 1.125rem;
        border-radius: 8px;
        cursor: pointer;
        text-decoration: none;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      button:hover, a.btn:hover { border-color: color-mix(in srgb, var(--text) 30%, var(--border)); }
      button.primary {
        background: var(--primary);
        color: var(--primary-fg);
        border-color: var(--primary);
      }
      button.primary:hover { background: color-mix(in srgb, var(--primary) 88%, transparent); }
      .divider { color: var(--muted); opacity: 0.5; padding: 0 0.25rem; }
    </style>
  </head>
  <body>
    <main class="card" role="alert" aria-live="polite">
      <div class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <h1>Strona chwilowo niedostępna</h1>
      <p class="sub">Page temporarily unavailable</p>
      <p class="desc">
        Coś poszło nie tak po naszej stronie. Spróbuj odświeżyć lub wróć do strony głównej.
        <br />
        <span style="opacity:0.75">Something went wrong on our end. Try refreshing or head back home.</span>
      </p>
      <div class="actions">
        <button type="button" class="primary" onclick="location.reload()">Odśwież <span class="divider">·</span> Refresh</button>
        <a class="btn" href="/">Strona główna <span class="divider">·</span> Home</a>
      </div>
    </main>
  </body>
</html>`;
}
