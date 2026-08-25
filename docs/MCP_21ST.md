# 21st.dev in Claude Code (plugin `21st@21st`)

21st.dev reaches this project as a **Claude Code plugin**, not as a loose MCP
entry. The plugin bundles the remote MCP server together with four skills, so
one install covers both:

| Component           | What it is                                       |
| ------------------- | ------------------------------------------------ |
| `21st` (MCP server) | remote HTTP server at `https://21st.dev/api/mcp` |
| `21st-cli-use`      | search / install components from the catalog     |
| `21st-ai`           | generate and iterate on UI from a prompt         |
| `21st-registry`     | publish and manage your own components           |
| `21st-design-sync`  | publish the project's design tokens as a theme   |

Always-on cost of the four skills is roughly 950 tokens per session
(`claude plugin details 21st` prints the current breakdown).

## How it is wired

`.claude/settings.json` is committed and carries the whole contract:

```json
{
  "extraKnownMarketplaces": {
    "21st": { "source": { "source": "github", "repo": "21st-dev/claude-code-plugin" } }
  },
  "enabledPlugins": { "21st@21st": true }
}
```

Both entries were written by Claude Code itself:

```bash
claude plugin marketplace add 21st-dev/claude-code-plugin --scope project
claude plugin install 21st@21st --scope project
```

## Why there is no `.mcp.json` any more

There used to be one, registering the same endpoint under the name `21st`. Once
the plugin is installed it registers that endpoint too, as
`plugin:21st:21st` — so `claude mcp list` showed **two identical servers**, and
every session paid for both tool sets:

```text
plugin:21st:21st: https://21st.dev/api/mcp (HTTP) - ! Needs authentication
21st:             https://21st.dev/api/mcp (HTTP) - ⏸ Pending approval
```

The plugin is now the single source: it is versioned, it updates with
`claude plugin update 21st`, and it carries the skills that a bare `.mcp.json`
cannot.

> **Careful:** `npx @21st-dev/cli init --client claude --write` re-creates
> `.mcp.json` and with it the duplicate. If you ever run the vendor installer,
> delete `.mcp.json` afterwards.

## The API key is never in the repo

The plugin's own `.mcp.json` (inside the plugin, not in this repo) carries a
reference, not the secret:

```json
"headers": { "x-api-key": "${API_KEY_21ST}" }
```

Claude Code expands `${API_KEY_21ST}` from **its own process environment** at
connection time. Export it in the shell that launches Claude Code, e.g. in
`~/.zshrc`:

```bash
export API_KEY_21ST="21st_sk_..."
```

Then restart Claude Code. Keys are issued at https://21st.dev.

Two placements do **not** work, both verified against `claude mcp list`:

- **`.env`** — Claude Code does not read `.env` for MCP header expansion. It
  warns `Missing environment variables: API_KEY_21ST` and sends the literal
  `${API_KEY_21ST}` as the header.
- **`.claude/settings.local.json` under `env`** — same warning; the block is not
  applied on the MCP connection path.

With the variable exported the warning disappears, which is how you can tell the
expansion resolved. `.claude/settings.local.json` is git-ignored, so it stays the
right place for other personal overrides — just not for this one.

## First run on a fresh checkout

A marketplace declared by a project needs your trust before Claude Code will
install from it. Open the repo in an interactive `claude` session once and accept
the prompt. Headless runs (`claude -p`) do **not** provision it — they skip the
prompt silently. If the plugin does not appear, run the two `--scope project`
commands above by hand; they are idempotent.

Verify:

```bash
claude plugin list   # expect: 21st@21st  Version: 0.4.0  Scope: project  ✓ enabled
claude mcp list      # expect: plugin:21st:21st ... - ✓ Connected
```

## Network requirement

`21st.dev:443` must be reachable. In Claude Code **web/remote** sessions this
project's egress policy currently denies it — the proxy rejects `CONNECT` with
403, and the health check then reports the misleading `! Needs authentication`,
because no handshake ever happens and the key is never evaluated. Confirm the
real cause with:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status"   # look at recentRelayFailures
```

Expect entries like
`{"kind": "connect_rejected", "host": "21st.dev:443", "detail": "gateway answered 403 to CONNECT"}`.

Allowlisting `21st.dev` for the environment is an administrator change. Local
Claude Code on a normal network is unaffected.

## Fallback without the plugin

If you only want the MCP server and none of the skills, register it at user
scope instead — user scope is personal and never touches the repo:

```bash
claude mcp add --transport http 21st https://21st.dev/api/mcp \
  --header "x-api-key: $API_KEY_21ST"
```

Do not commit that variant into a project-scope `.mcp.json` with the key inlined:
`.mcp.json` is not covered by the `.gitignore` secret rules (`.env`, `.env.*`),
so an inline key would land in git history.
