/**
 * Minimal typings for the legacy window globals these components still talk
 * to. Not-yet-migrated files (socket-client.js, app.js, settings.js, ...)
 * remain the source of truth for these; widen as more of them move to LIT.
 */

export interface JsaSocket {
  connected: boolean;
  on(event: string, cb: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

export interface JsaI18next {
  t(key: string, options?: Record<string, unknown>): string;
  language: string;
}

export interface JsaScript {
  expose?: string | null;
}

export interface JsaIntegrationStatus {
  installed?: boolean;
  is_connected?: boolean;
  is_running?: boolean;
  mqtt?: { enabled: boolean; connected: boolean };
}

declare global {
  interface Window {
    socket?: JsaSocket;
    i18next?: JsaI18next;
    apiFetch?: (url: string, options?: RequestInit) => Promise<Response>;
    openSettingsTab?: (target?: string) => void;
    allScripts?: JsaScript[];
    currentIntegrationStatus?: JsaIntegrationStatus;
    handleIntegrationStatus?: (status: JsaIntegrationStatus | null) => void;
    hideIntegrationBanner?: () => void;
    initLogs?: () => Promise<void>;
    appendLog?: (entry: any, autoScroll?: boolean) => void;
  }
}

export {};
