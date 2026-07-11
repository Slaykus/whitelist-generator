import type { XrayConfig } from '@types';

/** Base Xray config. Generated vless outbounds are injected after the system outbounds at runtime. */
export const XRAY_BASE_CONFIG: XrayConfig = {
  dns: {
    servers: [
      '1.1.1.1',
      '8.8.8.8',
      {
        port: 53,
        address: '77.88.8.8',
        domains: [
          'geosite:private',
          'geosite:category-ru',
          'domain:gstatic.com',
        ],
      },
    ],
    queryStrategy: 'UseIPv4',
  },
  routing: {
    rules: [
      { port: '443', network: 'udp', outboundTag: 'BLOCK' },
      { inboundTag: ['TW-REROUTE'], balancerTag: 'TW-BALANCER' },
      { inboundTag: ['VK-REROUTE'], balancerTag: 'VK-BALANCER' },
      { inboundTag: ['RR-REROUTE'], balancerTag: 'RR-BALANCER' },
      { inboundTag: ['YD-REROUTE'], balancerTag: 'YD-BALANCER' },
      { ip: ['1.1.1.1', '8.8.8.8'], balancerTag: 'SEL-BALANCER' },
      { ip: ['77.88.8.8'], outboundTag: 'DIRECT' },
      { domain: ['geosite:private'], outboundTag: 'DIRECT' },
      { ip: ['geoip:private'], outboundTag: 'DIRECT' },
      { network: 'tcp,udp', balancerTag: 'SEL-BALANCER' },
    ],
    balancers: [
      {
        tag: 'SEL-BALANCER',
        selector: ['SEL'],
        strategy: { type: 'leastLoad', settings: { expected: 1 } },
        fallbackTag: 'LOOP-TW',
      },
      {
        tag: 'TW-BALANCER',
        selector: ['TW'],
        strategy: { type: 'leastLoad', settings: { expected: 1 } },
        fallbackTag: 'LOOP-VK',
      },
      {
        tag: 'VK-BALANCER',
        selector: ['VK'],
        strategy: { type: 'leastLoad', settings: { expected: 1 } },
        fallbackTag: 'LOOP-RR',
      },
      {
        tag: 'RR-BALANCER',
        selector: ['RR'],
        strategy: { type: 'leastLoad', settings: { expected: 1 } },
        fallbackTag: 'LOOP-YD',
      },
      {
        tag: 'YD-BALANCER',
        selector: ['YD'],
        strategy: { type: 'leastLoad', settings: { expected: 1 } },
        fallbackTag: 'DIRECT',
      },
    ],
    domainMatcher: 'hybrid',
    domainStrategy: 'IPIfNonMatch',
  },
  inbounds: [
    {
      tag: 'socks',
      port: 10808,
      listen: '127.0.0.1',
      protocol: 'socks',
      settings: { udp: true, auth: 'noauth' },
      sniffing: {
        enabled: true,
        routeOnly: false,
        destOverride: ['http', 'quic'],
      },
    },
    {
      tag: 'http',
      port: 10809,
      protocol: 'http',
      settings: {},
    },
  ],
  outbounds: [
    { tag: 'DIRECT', protocol: 'freedom' },
    { tag: 'BLOCK', protocol: 'blackhole' },
    {
      tag: 'LOOP-TW',
      protocol: 'loopback',
      settings: { inboundTag: 'TW-REROUTE' },
    },
    {
      tag: 'LOOP-VK',
      protocol: 'loopback',
      settings: { inboundTag: 'VK-REROUTE' },
    },
    {
      tag: 'LOOP-RR',
      protocol: 'loopback',
      settings: { inboundTag: 'RR-REROUTE' },
    },
    {
      tag: 'LOOP-YD',
      protocol: 'loopback',
      settings: { inboundTag: 'YD-REROUTE' },
    },
  ],
  // leave empty to exclude default outbound from host
  remnawave: { injectHosts: [] },
  burstObservatory: {
    pingConfig: {
      timeout: '5s',
      interval: '2m',
      sampling: 1,
      httpMethod: 'GET',
      destination: 'https://www.gstatic.com/generate_204',
      connectivity: '',
    },
    subjectSelector: ['SEL', 'TW', 'VK', 'RR', 'YD'],
  },
};
