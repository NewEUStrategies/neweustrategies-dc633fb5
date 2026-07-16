// Dependency-free HTML fallback. MUST NOT import app code - if a route
// module or provider crashes at init, this page still has to render.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Chwilowa awaria - NEW EU Strategies</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: "Red Hat Display", system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0b0d10; color: #f5f6f8;
    display: grid; place-items: center; padding: 24px;
  }
  .card {
    max-width: 520px; text-align: center;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px; padding: 32px;
  }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { margin: 0 0 20px; color: #c7ccd3; line-height: 1.5; }
  .row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  a, button {
    appearance: none; border: 1px solid rgba(255,255,255,0.15);
    background: #f5f6f8; color: #0b0d10;
    padding: 10px 18px; border-radius: 10px; font-weight: 600;
    text-decoration: none; cursor: pointer; font: inherit;
  }
  a.secondary, button.secondary { background: transparent; color: #f5f6f8; }
</style>
</head>
<body>
  <main class="card">
    <h1>Chwilowa awaria</h1>
    <p>Nie udalo sie zaladowac strony. Sprobuj odswiezyc lub wroc na strone glowna.</p>
    <div class="row">
      <button onclick="location.reload()">Odswiez</button>
      <a class="secondary" href="/">Strona glowna</a>
    </div>
  </main>
</body>
</html>`;
}
