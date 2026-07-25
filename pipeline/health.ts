import type { Health, HealthState } from "./types.js";

const SLOWING_AFTER_DAYS = 90;
const STALE_AFTER_DAYS = 365;
const DEAD_AFTER_DAYS = 730;

export function computeHealth(pushedAt: string, archived: boolean, now = new Date()): Health {
  const pushed = new Date(pushedAt);
  const staleDays = Math.max(0, Math.floor((now.getTime() - pushed.getTime()) / 86_400_000));

  let state: HealthState;
  if (archived) {
    state = "archived";
  } else if (staleDays >= DEAD_AFTER_DAYS) {
    state = "dead";
  } else if (staleDays >= STALE_AFTER_DAYS) {
    state = "stale";
  } else if (staleDays >= SLOWING_AFTER_DAYS) {
    state = "slowing";
  } else {
    state = "active";
  }

  return { stale_days: staleDays, state };
}
