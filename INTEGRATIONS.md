# Sources and selected tools

## Implemented in this change

The terminal links to `/assets/sources.html`, a read-only source center. It uses the existing `/health`, `/health/archive` and `/api/wallet-intel` contracts. The combined implementation also links the separate research workspace, owner memory-evidence screen and gated BecsSuperAgent report; scanner, strategy, OrderIntent, executor, credentials and production storage settings retain their behavior.

Nineteen configured market feeds are grouped into Jupiter and DexScreener provider families. Multiple intervals from one provider are not independent votes. DexScreener supplies discovery membership and relies on Jupiter enrichment for the market metrics used by this application. Paid advertisements and boosts remain labeled as paid promotion.

The source center distinguishes Reporting, Delayed, Pending, Invalid timestamp and Disconnected states. The five-minute freshness display cutoff matches existing terminal/smoke behavior; it is not a new execution threshold. Errors preserve previously observed counts with a cached label. A failed archive/wallet request says unavailable instead of assuming capture or ingestion is disabled. Requests time out, do not overlap between refresh cycles, and are stopped on page departure. No persistent history is created by the screen.

## Owner-selected tool catalog

| Tool | Intended role | Boundary |
| --- | --- | --- |
| Google Drive | Approved documents/research artifacts | No automatic publication or ingestion of private files |
| GSC Wizard | Authorized website search-performance analysis | Not a market-wide trends source |
| Parallel Search | Public-source discovery and extraction | Original-source attribution required; not price execution data |
| Railway | Deployment and hosting operations | Not a trading signal |
| GitHub | Source, review and test operations | Not a trading signal |
| MagicPath | Interface and workflow design | Prototypes do not establish runtime behavior |
| Exa | Source discovery and research | Deduplicate reports found by different search tools |
| Supabase | Optional storage integration | Do not migrate existing PostgreSQL or resume capture implicitly |

These are selected tools, not eight connected market feeds. Exa and Parallel have separate on-demand keyless research adapters; their current availability is reported in `/research`, and neither supplies execution prices or a paid fallback. The other tools remain supporting integrations. The catalog does not probe ChatGPT installations, attach ChatGPT credentials to Railway, infer provider billing or publish synthetic hit rates. Existing PostgreSQL, Railway configuration and archive pause are unchanged.

## Remaining implementation gates

1. Verify each useful reader's bot-side access contract, authorization, limits, cost and data rights. Chat tool selection alone is not a server integration.
2. Add an authenticated, bounded research ingestion boundary with source URL, original publisher/source ID, observed/published/received times, canonical mint where established, retrieval tool and schema version. Keep research separate from executable prices and treat retrieved instructions as untrusted data.
3. Preserve private document boundaries. Never use a public status endpoint to expose raw Drive content, wallet identifiers, secrets or account evidence.
4. Honor the archive pause until a defined collection scope/capacity decision is approved. Do not delete retained history.
5. Implement a versioned engine builder and independent outcome evaluation before claiming performance. Win rate alone does not establish positive net returns; fees, slippage, sample size and forward testing matter.
6. Live signing and real-money activation are not part of this change. Existing public trading blocks remain.

## Verification

`test/unit/source-catalog.test.js` covers selection, attribution, paid labels, freshness, malformed/missing data and unavailable states. `test/e2e/sources.spec.js` covers the source-center page, filtering, mobile width, failed/recovered reads and the terminal navigation link. Run the normal `npm run check`, `npm test` and `npm run test:mobile` suite before release. This document does not claim that any unrun check passed.
