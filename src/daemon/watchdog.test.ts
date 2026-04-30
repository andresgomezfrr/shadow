import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Watchdog, type WatchdogAlert, type WatchdogOptions } from './watchdog.js';

function makeAlertsRef(): WatchdogAlert[] {
  return [];
}

function baseOptions(overrides: Partial<WatchdogOptions> = {}): WatchdogOptions {
  return {
    enabled: true,
    eventLoopThresholdMs: 50,
    softTimeoutMs: 60_000,
    tickIntervalMs: 10_000,
    ...overrides,
  };
}

describe('Watchdog', () => {
  it('does nothing when disabled', () => {
    const alerts = makeAlertsRef();
    const wd = new Watchdog(alerts, Date.now(), baseOptions({ enabled: false }));
    wd.start();
    wd.tick();
    assert.equal(alerts.length, 0);
    wd.stop();
  });

  it('raises a soft-timeout alert when session exceeds limit', () => {
    const alerts = makeAlertsRef();
    const startedLongAgo = Date.now() - 7 * 60 * 60 * 1000; // 7h ago
    const wd = new Watchdog(alerts, startedLongAgo, baseOptions({ softTimeoutMs: 6 * 60 * 60 * 1000 }));
    wd.start();
    wd.tick();
    const timeoutAlert = alerts.find((a) => a.id === 'watchdog_session_soft_timeout');
    assert.ok(timeoutAlert, 'expected soft-timeout alert to be present');
    assert.equal(timeoutAlert!.severity, 'warning');
    assert.match(timeoutAlert!.message, /exceeds soft-timeout/);
    wd.stop();
  });

  it('does not raise soft-timeout while within limit', () => {
    const alerts = makeAlertsRef();
    const wd = new Watchdog(alerts, Date.now(), baseOptions({ softTimeoutMs: 60 * 60 * 1000 }));
    wd.start();
    wd.tick();
    const timeoutAlert = alerts.find((a) => a.id === 'watchdog_session_soft_timeout');
    assert.equal(timeoutAlert, undefined);
    wd.stop();
  });

  it('is idempotent on upsert — same id refreshed, not duplicated', () => {
    const alerts = makeAlertsRef();
    const startedLongAgo = Date.now() - 7 * 60 * 60 * 1000;
    const wd = new Watchdog(alerts, startedLongAgo, baseOptions({ softTimeoutMs: 6 * 60 * 60 * 1000 }));
    wd.start();
    wd.tick();
    wd.tick();
    wd.tick();
    const matching = alerts.filter((a) => a.id === 'watchdog_session_soft_timeout');
    assert.equal(matching.length, 1, 'should have exactly one soft-timeout alert after 3 ticks');
    wd.stop();
  });

  it('detects synthetic event-loop lag via blocking work', async () => {
    const alerts = makeAlertsRef();
    const wd = new Watchdog(alerts, Date.now(), baseOptions({ eventLoopThresholdMs: 50, softTimeoutMs: 24 * 60 * 60 * 1000 }));
    wd.start();
    await new Promise((r) => setTimeout(r, 50));

    // Spin >> threshold para garantizar varios samples en el histograma.
    const spinUntil = Date.now() + 250;
    while (Date.now() < spinUntil) { /* busy-loop CPU-bound */ }
    await new Promise((r) => setTimeout(r, 100));

    wd.tick();
    const lagAlert = alerts.find((a) => a.id === 'watchdog_event_loop_unresponsive');
    assert.ok(lagAlert, 'expected event-loop-lag alert after synthetic block');
    assert.match(lagAlert!.message, /Event loop unresponsive/);
    wd.stop();
  });

  it('clears event-loop alert when lag returns below threshold', async () => {
    const alerts = makeAlertsRef();
    const wd = new Watchdog(alerts, Date.now(), baseOptions({ eventLoopThresholdMs: 50, softTimeoutMs: 24 * 60 * 60 * 1000 }));
    wd.start();
    await new Promise((r) => setTimeout(r, 50));

    const spinUntil = Date.now() + 250;
    while (Date.now() < spinUntil) { /* busy */ }
    await new Promise((r) => setTimeout(r, 100));
    wd.tick();
    assert.ok(alerts.find((a) => a.id === 'watchdog_event_loop_unresponsive'));

    // Quiet period — el tick resetea el histograma, el siguiente sample debe estar limpio.
    await new Promise((r) => setTimeout(r, 200));
    wd.tick();
    const lagAlert = alerts.find((a) => a.id === 'watchdog_event_loop_unresponsive');
    assert.equal(lagAlert, undefined, 'alert should be cleared when lag normalizes');
    wd.stop();
  });

  it('stop is idempotent and re-startable', () => {
    const alerts = makeAlertsRef();
    const wd = new Watchdog(alerts, Date.now(), baseOptions());
    wd.start();
    wd.stop();
    wd.stop(); // second stop must not throw
    wd.start(); // re-start ok
    wd.stop();
  });
});
