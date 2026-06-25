/**
 * @name API Watchdog
 * @icon mdi:dog-side
 * @description Demonstrates a self-healing retry pattern using ha.persistent() and ha.restart().
 *              Fetches data from an API and retries up to MAX_RETRIES times before giving up.
 *              Retry count and last error survive restarts via persistent state.
 * @label Example
 * @permission network
 */

const API_URL   = 'https://api.example.com/data';
const MAX_RETRIES = 3;

// Retry state persists across ha.restart() calls
const state = ha.persistent('watchdog_state', {
    retries: 0,
    lastError: null,
});

async function fetchData() {
    try {
        const data = await ha.http.get(API_URL);

        // Success — reset retry counter and process the result
        state.retries = 0;
        state.lastError = null;
        ha.log(`Data received: ${JSON.stringify(data)}`);

        ha.stop('Done.');

    } catch (err) {
        state.lastError = err.message;

        if (state.retries < MAX_RETRIES) {
            state.retries++;
            ha.warn(`Attempt ${state.retries}/${MAX_RETRIES} failed: ${err.message} — restarting in 10s`);
            setTimeout(() => ha.restart('Retry after error'), 10_000);
        } else {
            state.retries = 0;
            ha.error(`All ${MAX_RETRIES} attempts failed. Last error: ${err.message}`);
            ha.notify(`Watchdog gave up after ${MAX_RETRIES} retries. Check the logs.`, {
                title: 'API Watchdog',
                persistent: true,
            });
            ha.stop('Max retries reached.');
        }
    }
}

ha.log(`Watchdog starting (attempt ${state.retries + 1}/${MAX_RETRIES})…`);
fetchData();
