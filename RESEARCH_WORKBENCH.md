# BecsBot source and research workspace

## Delivered scope

`/research` is part of the existing BecsBot service, linked from the terminal.
The user can name a research engine, choose Exa, Parallel Search, or both,
save up to ten browser-local recipes, and run a public-web query on demand.
Recipes are not trading strategies. No research request calls DecisionEngine,
PaperExecutor, a signer, or the market-price cache. Existing trading rules are
unchanged. No background research timer or autonomous engine is introduced.

## Eight selected tools, distinct jobs

| Tool | Role | Actual boundary |
| --- | --- | --- |
| Exa | Public-web research | Runtime keyless MCP reader, limited free access |
| Parallel Search | Public-web research | Runtime keyless MCP reader, limited free access |
| Google Drive | Project documents | Assistant-side connector, not an automatic document import |
| GSC Wizard | Owned-site search analytics | Requires a verified property; not global crypto sentiment |
| GitHub | Code, reviews, tests | Development tooling, not a market signal |
| Railway | Existing hosting | Current service; no new hosting subscription created |
| MagicPath | Interface design | Assistant-side design tool; quota applies |
| Supabase | Optional database tooling | Not provisioned; existing PostgreSQL remains authoritative |

A plugin connected in ChatGPT does not transfer its OAuth credentials or
paid entitlements to the Railway application. Only the two documented public
keyless research endpoints are called by this feature. No API key, signed-in
browser state, private Drive content, wallet credential or account identifier
is sent to either reader. The owner is responsible for entering a public query;
the UI warns against including secrets or personal information.

## Runtime transport and safeguards

- Fixed HTTPS endpoints: `https://mcp.exa.ai/mcp` and
  `https://search.parallel.ai/mcp`. Requests cannot select an endpoint or tool.
- Initialize MCP, discover the expected search tool, then call only that tool.
  Redirects are rejected. JSON and SSE replies are bounded to 1 MiB with a
  25-second total timeout per provider. No credentials or paid fallback.
- Owner-authenticated, same-origin POST using the existing server-paper
  session. Authentication alone does not create trades or change paper state.
- A maximum of twelve uncached research runs per rolling day per process,
  a one-minute cooldown, and one in-flight run. These are local protections,
  not a guarantee of provider quota or availability. Provider limits still apply.
- Successful results are cached in RAM for ten minutes, at most twelve batches.
  Cache hits retain their original retrieval time. Restart clears this cache
  and local rate history; the provider's own limits remain authoritative.
- Each reader contributes at most six bounded documents. Canonical HTTPS URLs
  drop tracking parameters; the same URL is one document even when both readers
  retrieve it. Host counts do not establish independent ownership or reliability.
- Provider errors and partial failures remain visible. Unrecognized replies
  fail closed instead of fabricating empty successful searches.
- All source content renders as text. Returned web content cannot execute code,
  alter settings, add tools, send private data, change prices or place orders.

## HTTP contract

The strict machine-readable contract is `src/api/research-schemas.json`.
It supplements `src/api/schemas.json` without changing existing contracts.
`src/research/validation.js` compiles it in strict Ajv mode. Unit/integration
checks cover normal replies, errors, duplicate documents and auth boundaries.

| Route | Behavior |
| --- | --- |
| `GET /research` | Responsive source library and research-engine workspace |
| `GET /api/research/status` | Bounded capabilities; no queries, credentials or private results |
| `POST /api/research/query` | Owner-only `{query, providers}`; validated, bounded source evidence |

Input accepts 3–240 query characters and one or two unique reader IDs (`exa`,
`parallel`). Extra fields and control characters are rejected. Successful replies
carry original URLs, retrieval timestamps, reader provenance, explicit provider
states and `executionEnabled:false`. Retrieval time is not publication time,
market-data freshness, an executable quote or a measured strategy hit rate.

## Retention and unfinished scope

The `becsResearchEnginesV1` browser key contains only explicit saved recipes.
It is separate from `becsPaperV1`; no balances, positions or settings are changed.
There are no SQL writes, archive writes, new database projects, scheduled scans
or migration changes. The owner's paused research-archive setting stays paused.

The complete custom trading-engine builder, source-to-OrderIntent conversion,
forward outcome labels, engine-level profit/loss and win-rate gates are NOT
implemented by this workspace. A 50% hit rate alone would not establish profit
or reliability; sample size, net outcomes and forward testing require a separate
specified evaluator. No live execution is added or enabled.

## Verification

`npm run check`, `npm test`, and `npm run test:mobile` exercise syntax, strict
contracts, transport mocks, normalization, auth and browser behavior. Tests do
not require provider credentials and do not use the production database.

`node scripts/probe-research.js` is a separate explicit, read-only live probe:
one fixed public documentation query per provider, no credentials and no orders.
It prints only provider ID, status and validated document count. A rate limit,
timeout or incompatible response is a failed probe, not a fabricated success.
The dedicated workflow has no schedule and does not continuously consume quota.

Operational defaults live in `src/research/config.js`; the browser receives only
its public limits through a generated same-origin module. The Sources & tools
catalog identifies these two adapters and links this workspace.

Official provider documentation and its fixed endpoints/limited keyless access
were rechecked on 2026-10-04 during fundamentals integration:

- https://exa.ai/docs/get-started/exa-mcp
- https://docs.parallel.ai/integrations/mcp/search-mcp
- https://docs.parallel.ai/integrations/mcp/programmatic-use
- https://modelcontextprotocol.io/specification/2025-03-26/basic/transports

Both providers describe keyless access as limited/light use. Free availability
is not a production SLA or permission to evade rate limits. Upgrades require
a separate owner decision and are not enabled here.
