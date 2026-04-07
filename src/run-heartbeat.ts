import { loadConfig } from './config/load-config.js';
import { createDatabase } from './storage/database.js';
import { runHeartbeat } from './analysis/state-machine.js';

const config = loadConfig();
const db = createDatabase(config);
const profile = db.ensureProfile();
const lastHb = db.getLastJob('heartbeat');

try {
  const result = await runHeartbeat({
    config, db, profile,
    lastHeartbeat: lastHb,
    pendingEventCount: db.listPendingEvents().length,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error('Heartbeat failed:', e);
} finally {
  db.close();
}
