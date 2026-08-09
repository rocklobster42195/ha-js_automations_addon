import type { JsaHaState } from './global';

/**
 * Fetches all HA entity states via window.getHAStates(), deduped across
 * concurrent callers (both <status-bar> and <status-bar-header-actions> can
 * request this on initial load) via a shared in-flight promise on window.
 *
 * kernel.haConnector.getStates() resolves successfully with [] (not an
 * error) if the backend's own HA connection hasn't finished its initial
 * state sync yet — retries on an empty result too, not just on rejection,
 * or an entity requested during that window gets stuck showing an error
 * until it happens to receive a live update.
 */
export async function fetchAllStatesDeduped(): Promise<JsaHaState[]> {
  if (!window._jsaEntityFetchPromise) {
    window._jsaEntityFetchPromise = (async () => {
      let lastResult: JsaHaState[] = [];
      let lastErr: unknown;
      for (let i = 0; i < 6; i++) {
        try {
          const data = await window.getHAStates!();
          if (data && data.length > 0) {
            window.cachedEntities = data;
            return data;
          }
          lastResult = data ?? [];
        } catch (e) {
          lastErr = e;
        }
        if (i < 5) await new Promise((r) => setTimeout(r, 1500));
      }
      if (lastErr && lastResult.length === 0) throw lastErr;
      window.cachedEntities = lastResult;
      return lastResult;
    })().finally(() => {
      window._jsaEntityFetchPromise = null;
    });
  }
  return window._jsaEntityFetchPromise;
}
