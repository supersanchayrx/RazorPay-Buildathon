import { api, isFixtureMode } from './api.js';

let cached = null;
let inFlight = null;

export { isFixtureMode };

export function loadConfig() {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = api.getConfig().then((result) => {
      cached = result;
      return result;
    });
  }
  return inFlight;
}

export function getConfig() {
  return cached;
}
