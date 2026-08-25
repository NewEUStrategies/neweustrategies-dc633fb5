# 21st.dev MCP server (Claude Code)

The `21st` MCP server is registered for this project in `.mcp.json` at the repo
root. `.mcp.json` is **project scope**: it is committed and therefore shared with
everyone who opens the repo in Claude Code.

## The API key is not in the repo

`.mcp.json` carries a reference, not the secret:

```json
"headers": { "x-api-key": "${API_KEY_21ST}" }
```

This is the same shape the vendor's own installer writes
(`npx @21st-dev/cli init --client claude --write`), so re-running that installer
does not conflict with the committed file.

`.mcp.json` is **not** covered by the `.gitignore` secret rules (`.env`,
`.env.*`), so an inline key here would land in git history. Keep the
indirection.

## Setting the key

Claude Code expands `${API_KEY_21ST}` from **its own process environment** at
connection time. Two things that do _not_ work, both verified:

- Putting the value in `.env` — Claude Code does not read `.env` for `.mcp.json`
  expansion. It warns `Missing environment variables: API_KEY_21ST` and sends
  the literal `${API_KEY_21ST}` as the header.
- Putting it in `.claude/settings.local.json` under `env` — not applied on the
  `claude mcp` health-check path.

So export it in the shell that launches Claude Code, e.g. in `~/.zshrc`:

```bash
export API_KEY_21ST="21st_sk_..."
```

Then restart Claude Code. Keys are issued at https://21st.dev.

## First run needs approval

A server from a shared `.mcp.json` starts as `⏸ Pending approval`. Launch
`claude` once interactively and accept the prompt; `claude mcp list` alone cannot
approve it. After approval:

```bash
claude mcp list      # expect: 21st: https://21st.dev/api/mcp (HTTP) - ✓ Connected
```

## Network requirement

`21st.dev:443` must be reachable. In Claude Code _web/remote_ sessions this
project's egress policy currently denies it — the proxy rejects `CONNECT` with
403 and the health check reports the misleading `! Needs authentication`, because
no handshake ever happens and the key is never evaluated. Confirm the real cause
with:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status"   # look at recentRelayFailures
```

Allowlisting `21st.dev` for the environment is an administrator change. Local
Claude Code on a normal network is unaffected.
