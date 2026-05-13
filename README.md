# Whitelist XRay Json Config Generator

Fetches public VLESS links, filters them by transport type and IP subnet, generates a ready-to-use **Xray JSON config** with grouped outbounds and a load-balancer setup, and optionally syncs it to a [Remnawave](https://docs.rw) panel on a schedule.

## How it works

Source: [`zieng2/wl — vless_lite.txt`](https://github.com/zieng2/wl/blob/main/vless_lite.txt)

```
fetch vless_lite.txt
  → parse vless:// URLs
  → filter out disallowed transports (e.g. xhttp)
  → match IPs against hoster subnet groups
  → discard entries with unknown hosters
  → generate Xray outbounds grouped by hoster (YD, SEL, TW, VK, RR…)
  → inject into base Xray config
  → save xray-client.json
  → sync to Remnawave config profile (if enabled)
  → repeat every hour at :00 (if sync enabled)
```

## Project structure

```
src/
  main.ts               entry point — orchestrates the pipeline + cron scheduler
  types/
    interfaces.ts       VlessEntry, SubnetGroup, MatchResult, LogLevel
    xray.ts             Xray outbound/config interfaces
  lib/
    logger.ts           slog-style key=value logger
    fetcher.ts          fetch remote vless list via ky
    vless-parser.ts     parse vless:// URLs → VlessEntry
    vless-filter.ts     filter by transport type and known subnet
    ip-matcher.ts       CIDR subnet matching with ip-num
    xray-generator.ts   build Xray vless outbounds from MatchResult[]
    remnawave.ts        RemnawaveSDK client + syncConfig()
  config/
    constants.ts        VLESS_LIST_URL, DISALLOWED_TYPES
    env.ts              Zod-validated environment config
    subnets.ts          hoster subnet groups (Yandex, Selectel, Timeweb, …)
    xray-base.ts        base Xray config (DNS, routing, balancers, inbounds)
```

## Requirements

- [Bun](https://bun.sh) >= 1.3

## Setup

```bash
git clone https://github.com/mishkatik/whitelist-generator
cd whitelist-generator
bun install
cp .env.sample .env
# edit .env as needed
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | no | `INFO` | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` |
| `SYNC_ENABLED` | no | `false` | Push config to Remnawave after each run |
| `REMNAWAVE_URL` | if sync | — | Remnawave panel URL |
| `REMNAWAVE_API_KEY` | if sync | — | Remnawave API key |
| `REMNAWAVE_TEMPLATE_UUID` | if sync | — | UUID of the subscription template to update |

## Usage

```bash
# one-shot run
bun start

# development (watch mode)
bun dev

# compile to binary
bun run build
```

## Outputs

- **stdout** — final Xray JSON config
- **`xray-client.json`** — same config saved to disk (tab-indented)
- **Remnawave** — config profile updated via SDK (when sync is enabled)

## Adding subnet groups

Edit [`src/config/subnets.ts`](src/config/subnets.ts):

```ts
{ balancerTag: 'MY', name: 'MyHoster', subnets: ['1.2.3.0/24'] }
```

Then add a matching balancer entry in [`src/config/xray-base.ts`](src/config/xray-base.ts).

## Filtering transports

Edit `DISALLOWED_TYPES` in [`src/config/constants.ts`](src/config/constants.ts):

```ts
export const DISALLOWED_TYPES = ['xhttp', 'ws']
```
