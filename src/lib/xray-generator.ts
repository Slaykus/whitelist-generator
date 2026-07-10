import { logger } from '@lib/logger';
import type {
  MatchResult,
  VlessEntry,
  XrayGrpcSettings,
  XrayRealitySettings,
  XrayStreamSettings,
  XrayTlsSettings,
  XrayVlessOutbound,
  XrayVlessSettings,
  XrayWsSettings,
  XrayXhttpSettings,
} from '@types';

const SUPPORTED_TRANSPORTS = new Set(['ws', 'tcp', 'grpc', 'xhttp']);

/** Build the vless protocol settings block */
function buildVlessSettings(entry: VlessEntry): XrayVlessSettings {
  return {
    vnext: [
      {
        address: entry.address,
        port: entry.port,
        users: [
          {
            id: entry.uuid,
            encryption: 'none',
            ...(entry.flow && { flow: entry.flow }),
          },
        ],
      },
    ],
  };
}

/** Build transport-specific settings */
function buildTransportSettings(
  entry: VlessEntry
): Partial<XrayStreamSettings> {
  switch (entry.type) {
    case 'ws': {
      const ws: XrayWsSettings = {};
      if (entry.path) ws.path = entry.path;
      if (entry.host) ws.headers = { Host: entry.host };
      return { wsSettings: ws };
    }
    case 'grpc': {
      const grpc: XrayGrpcSettings = {
        mode: entry.mode === 'multi',
      };
      if (entry.serviceName) grpc.serviceName = entry.serviceName;
      if (entry.authority) grpc.authority = entry.authority;
      return { grpcSettings: grpc };
    }
    case 'xhttp': {
      const xhttp: XrayXhttpSettings = {};
      if (entry.path) xhttp.path = entry.path;
      if (entry.host) xhttp.host = entry.host;
      if (entry.mode) xhttp.mode = entry.mode;
      return { xhttpSettings: xhttp };
    }
    default:
      return { tcpSettings: {} };
  }
}

/** Build security settings block */
function buildSecuritySettings(entry: VlessEntry): Partial<XrayStreamSettings> {
  switch (entry.security) {
    case 'reality': {
      const reality: XrayRealitySettings = {};
      if (entry.sni) reality.serverName = entry.sni;
      if (entry.pbk) reality.publicKey = entry.pbk;
      if (entry.sid) reality.shortId = entry.sid;
      if (entry.fp) reality.fingerprint = entry.fp;
      return { security: 'reality', realitySettings: reality };
    }
    case 'tls': {
      const tls: XrayTlsSettings = {};
      if (entry.sni) tls.serverName = entry.sni;
      if (entry.fp) tls.fingerprint = entry.fp;
      return { security: 'tls', tlsSettings: tls };
    }
    default:
      return { security: 'none' };
  }
}

/** Build the full streamSettings block */
function buildStreamSettings(entry: VlessEntry): XrayStreamSettings {
  return {
    network: entry.type as 'ws' | 'tcp' | 'grpc' | 'xhttp',
    ...buildTransportSettings(entry),
    ...buildSecuritySettings(entry),
  } as XrayStreamSettings;
}

/** Build a single Xray vless outbound */
function buildOutbound(entry: VlessEntry, tag: string): XrayVlessOutbound {
  return {
    tag,
    protocol: 'vless',
    settings: buildVlessSettings(entry),
    streamSettings: buildStreamSettings(entry),
  };
}

/** Group results by balancerTag, preserving the order from groupOrder */
function groupByBalancerTag(
  results: MatchResult[],
  groupOrder: string[]
): Map<string, MatchResult[]> {
  const grouped = new Map<string, MatchResult[]>(
    groupOrder.map(tag => [tag, []])
  );

  for (const result of results) {
    const tag = result.balancerTag ?? 'proxy';
    if (!grouped.has(tag)) grouped.set(tag, []);
    grouped.get(tag)!.push(result);
  }

  return grouped;
}

/** Single entry in the Xray JSON multi-config array format */
export interface XrayMultiConfigEntry {
  remarks: string;
  outbounds: [XrayVlessOutbound];
}

/**
 * Convert a flat outbounds list into the Xray JSON-array multi-config format.
 * Each entry wraps one outbound, using its tag as the remarks field.
 */
export function generateMultiConfig(
  outbounds: XrayVlessOutbound[]
): XrayMultiConfigEntry[] {
  return outbounds.map(ob => ({ remarks: ob.tag, outbounds: [ob] }));
}

/**
 * Generate Xray vless outbounds from matched results.
 * Results are grouped by balancerTag in the order defined by groupOrder,
 * so all YD outbounds come before SEL, etc.
 * Tags are scoped per group: YD-1, YD-2, SEL-1, ...
 * Entries with unsupported transports are skipped.
 */
export function generateOutbounds(
  results: MatchResult[],
  groupOrder: string[]
): XrayVlessOutbound[] {
  const grouped = groupByBalancerTag(results, groupOrder);
  const outbounds: XrayVlessOutbound[] = [];
  const tagCounters = new Map<string, number>();

  for (const [base, group] of grouped) {
    for (const { entry } of group) {
      if (!SUPPORTED_TRANSPORTS.has(entry.type)) {
        logger.debug('Skipping unsupported transport', {
          type: entry.type,
          address: entry.address,
        });
        continue;
      }

      const idx = (tagCounters.get(base) ?? 0) + 1;
      tagCounters.set(base, idx);
      const tag = idx === 1 ? base : `${base}-${idx}`;
      outbounds.push(buildOutbound(entry, tag));
    }
  }

  logger.info('Generated Xray outbounds', {
    total: outbounds.length,
    tags: [...tagCounters.entries()].map(([k, v]) => `${k}:${v}`).join(' '),
  });

  return outbounds;
}
