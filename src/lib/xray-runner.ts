import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@lib/logger';
import type { XrayVlessOutbound } from '@types';

/** A running xray-core instance exposing a local SOCKS proxy for one outbound */
export interface XrayInstance {
  port: number;
  stop: () => void;
}

const XRAY_BIN = Bun.env.XRAY_BIN ?? 'xray';

/** Minimal xray config: local SOCKS inbound -> single vless outbound under test */
function buildTestConfig(
  outbound: XrayVlessOutbound,
  socksPort: number
): Record<string, unknown> {
  return {
    log: { loglevel: 'none' },
    inbounds: [
      {
        tag: 'socks',
        listen: '127.0.0.1',
        port: socksPort,
        protocol: 'socks',
        settings: { udp: false },
      },
    ],
    outbounds: [{ ...outbound, tag: 'proxy' }],
  };
}

/** Poll a TCP port until it accepts a connection or the timeout elapses */
function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const attempt = (): void => {
      const sock = connect({ host: '127.0.0.1', port });
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

/**
 * Start an xray-core process proxying through the given outbound.
 * Returns a handle once the SOCKS port is ready, or null if it never came up.
 */
export async function startXray(
  outbound: XrayVlessOutbound,
  socksPort: number,
  readyTimeoutMs = 5000
): Promise<XrayInstance | null> {
  const dir = mkdtempSync(join(tmpdir(), 'wlx-'));
  const cfgPath = join(dir, 'config.json');
  writeFileSync(cfgPath, JSON.stringify(buildTestConfig(outbound, socksPort)));

  const proc = Bun.spawn([XRAY_BIN, 'run', '-c', cfgPath], {
    stdout: 'ignore',
    stderr: 'ignore',
  });

  const cleanup = (): void => {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
    rmSync(dir, { recursive: true, force: true });
  };

  const ready = await waitForPort(socksPort, readyTimeoutMs);
  if (!ready) {
    logger.debug('xray SOCKS port not ready', { tag: outbound.tag, socksPort });
    cleanup();
    return null;
  }

  return { port: socksPort, stop: cleanup };
}
