export interface XrayVlessUser {
  id: string;
  encryption: 'none';
  flow?: string;
}

export interface XrayVlessSettings {
  vnext: [
    {
      address: string;
      port: number;
      users: [XrayVlessUser];
    },
  ];
}

export interface XrayWsSettings {
  path?: string;
  headers?: { Host?: string };
}

export interface XrayGrpcSettings {
  serviceName?: string;
  authority?: string;
  /** true = multi mode */
  mode: boolean;
}

export interface XrayRealitySettings {
  serverName?: string;
  publicKey?: string;
  shortId?: string;
  spiderX?: string;
  fingerprint?: string;
}

export interface XrayTlsSettings {
  serverName?: string;
  fingerprint?: string;
}

export interface XrayXhttpSettings {
  path?: string;
  host?: string;
  mode?: string;
}

export interface XrayStreamSettings {
  network: 'ws' | 'tcp' | 'grpc' | 'xhttp';
  security: 'reality' | 'tls' | 'none';
  wsSettings?: XrayWsSettings;
  /** Empty object for plain TCP (no HTTP header obfuscation) */
  tcpSettings?: Record<string, never>;
  grpcSettings?: XrayGrpcSettings;
  xhttpSettings?: XrayXhttpSettings;
  realitySettings?: XrayRealitySettings;
  tlsSettings?: XrayTlsSettings;
}

export interface XrayVlessOutbound {
  tag: string;
  protocol: 'vless';
  settings: XrayVlessSettings;
  streamSettings: XrayStreamSettings;
}

/** Top-level Xray config shape — outbounds are heterogeneous (freedom, blackhole, loopback, vless) */
export interface XrayConfig {
  dns: unknown;
  routing: unknown;
  inbounds: unknown[];
  outbounds: Record<string, unknown>[];
  burstObservatory?: unknown;
  remnawave?: unknown;
}
