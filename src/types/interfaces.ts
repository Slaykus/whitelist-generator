/** Parsed representation of a vless:// URL */
export interface VlessEntry {
  uuid: string;
  address: string;
  port: number;
  /** Transport type: tcp | ws | grpc | xhttp | ... */
  type: string;
  /** Security layer: reality | tls | none */
  security: string;
  flow?: string;
  sni?: string;
  /** Public key (REALITY) */
  pbk?: string;
  /** Short ID (REALITY) */
  sid?: string;
  /** TLS fingerprint */
  fp?: string;
  path?: string;
  host?: string;
  /** gRPC service name */
  serviceName?: string;
  /** gRPC/xhttp mode */
  mode?: string;
  /** gRPC authority */
  authority?: string;
  name: string;
  /** Original raw URL */
  raw: string;
}

/** A named group of CIDR subnets belonging to one hoster */
export interface SubnetGroup {
  /** Tag used for load-balancer routing (e.g. "YD", "SEL") */
  balancerTag: string;
  name: string;
  subnets: string[];
}

/** Result of matching a VlessEntry against subnet groups */
export interface MatchResult {
  entry: VlessEntry;
  /** Matched hoster name, or null if no match */
  hoster: string | null;
  /** Load-balancer tag of the matched hoster, or null if no match */
  balancerTag: string | null;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Result of speed/latency testing one candidate outbound through xray-core */
export interface SpeedTestResult {
  /** Outbound tag (e.g. "YD", "SEL-3") */
  tag: string;
  address: string;
  port: number;
  /** Whether the server responded successfully through the proxy */
  available: boolean;
  /** Reaches sites blocked in RU (Telegram/YouTube) through the proxy — real bypass */
  bypassOk: boolean;
  /** Time-to-first-byte in ms through the proxy; -1 if not measured */
  latencyMs: number;
  /** Download throughput in bytes/sec; 0 if not measured */
  speedBytesPerSec: number;
  /** Bytes actually downloaded during the speed test */
  downloadedBytes: number;
}

/** A selected server: its outbound plus the metrics from its last full test */
export interface SelectedServer {
  result: SpeedTestResult;
  outbound: import('./xray').XrayVlessOutbound;
}
