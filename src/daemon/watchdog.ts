import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

import { log } from '../log.js';

type Severity = 'info' | 'warning' | 'critical';

export type WatchdogAlert = {
  id: string;
  message: string;
  severity: Severity;
  since: string;
  acked: boolean;
};

export type WatchdogOptions = {
  enabled: boolean;
  eventLoopThresholdMs: number;
  softTimeoutMs: number;
  tickIntervalMs: number;
};

const ALERT_EVENT_LOOP = 'watchdog_event_loop_unresponsive';
const ALERT_SOFT_TIMEOUT = 'watchdog_session_soft_timeout';

// Watchdog mide event-loop lag con perf_hooks.monitorEventLoopDelay
// (built-in Node, sin dep externa) y emite alertas al estado del daemon
// cuando el loop queda bloqueado más allá del umbral o cuando la sesión
// supera el soft-timeout configurable. Diseñado para sesiones marathon 7h+
// (memoria de tensión #12). No mata el proceso: deja que el operador
// decida tras ver la alerta.
export class Watchdog {
  private histogram: IntervalHistogram | null = null;
  private interval: NodeJS.Timeout | null = null;
  private alerts: WatchdogAlert[];
  private startedAtMs: number;
  private options: WatchdogOptions;
  // Sampling fino (10ms) — overhead despreciable y necesario para que un spike de
  // ~50ms entre dos ticks del tick principal sea visible. Si fuera 1000ms el
  // histograma sólo registraría 60 muestras por minuto, perdiendo lag corto pero
  // doloroso (GC pauses, jobs sync mal escritos).
  private readonly resolutionMs = 10;

  constructor(alertsRef: WatchdogAlert[], startedAtMs: number, options: WatchdogOptions) {
    this.alerts = alertsRef;
    this.startedAtMs = startedAtMs;
    this.options = options;
  }

  start(): void {
    if (!this.options.enabled) {
      log.info('[watchdog] disabled via config — skipping');
      return;
    }
    if (this.histogram) return; // idempotent

    this.histogram = monitorEventLoopDelay({ resolution: this.resolutionMs });
    this.histogram.enable();

    this.interval = setInterval(() => this.tick(), this.options.tickIntervalMs);
    if (typeof this.interval.unref === 'function') this.interval.unref();

    log.info(
      `[watchdog] started — eventLoopThreshold=${this.options.eventLoopThresholdMs}ms softTimeout=${this.options.softTimeoutMs}ms tick=${this.options.tickIntervalMs}ms`,
    );
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.histogram) {
      this.histogram.disable();
      this.histogram = null;
    }
  }

  // Exposed for tests: run one tick synchronously.
  tick(): void {
    this.checkEventLoopLag();
    this.checkSoftTimeout();
  }

  private checkEventLoopLag(): void {
    if (!this.histogram) return;

    // histogram.max está en nanosegundos
    const maxMs = this.histogram.max / 1e6;
    const threshold = this.options.eventLoopThresholdMs;

    if (maxMs >= threshold) {
      const severity: Severity = maxMs >= threshold * 2 ? 'critical' : 'warning';
      const message = `Event loop unresponsive: max delay ${maxMs.toFixed(0)}ms (threshold ${threshold}ms)`;
      this.upsertAlert(ALERT_EVENT_LOOP, message, severity);
      log.error(`[watchdog] ${message}`);
    } else {
      this.clearAlert(ALERT_EVENT_LOOP);
    }

    // Reset para tener ventana móvil; sin reset el max queda pegado al peor histórico.
    this.histogram.reset();
  }

  private checkSoftTimeout(): void {
    const elapsedMs = Date.now() - this.startedAtMs;
    if (elapsedMs >= this.options.softTimeoutMs) {
      const elapsedH = (elapsedMs / 3_600_000).toFixed(1);
      const limitH = (this.options.softTimeoutMs / 3_600_000).toFixed(1);
      const message = `Daemon session running ${elapsedH}h — exceeds soft-timeout ${limitH}h. Considera reiniciar para liberar recursos.`;
      this.upsertAlert(ALERT_SOFT_TIMEOUT, message, 'warning');
    }
  }

  private upsertAlert(id: string, message: string, severity: Severity): void {
    const existing = this.alerts.findIndex((a) => a.id === id);
    if (existing !== -1) {
      // Refresh message + severity sin tocar `since` ni `acked` (UX: la alerta sigue viva).
      this.alerts[existing].message = message;
      this.alerts[existing].severity = severity;
      return;
    }
    this.alerts.push({
      id,
      message,
      severity,
      since: new Date().toISOString(),
      acked: false,
    });
  }

  private clearAlert(id: string): void {
    const idx = this.alerts.findIndex((a) => a.id === id);
    if (idx !== -1) this.alerts.splice(idx, 1);
  }
}
