import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

// Real-browser tests for the LIT components (RFC §9.3) — jsdom can't exercise
// Shadow DOM/custom-element upgrade behavior faithfully, so this runs in an
// actual Chromium via the same Playwright install already used by
// .claude/skills/run-jsa-web/driver.mjs (no second browser download locally;
// CI installs its own via `npx playwright install --with-deps chromium`).
export default {
  nodeResolve: true,
  files: 'js_automations/public/js/components/**/*.test.ts',
  plugins: [
    esbuildPlugin({
      ts: true,
      // Reuses the frontend's own tsconfig so decorator/target behavior is
      // identical to the real `npm run build` output, not a second,
      // potentially-drifting copy of the same settings.
      tsconfig: 'js_automations/public/tsconfig.json',
    }),
  ],
  browsers: [playwrightLauncher({ product: 'chromium' })],
};
