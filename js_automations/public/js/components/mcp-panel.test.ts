import { fixture, html, expect, aTimeout } from '@open-wc/testing';
import sinon from 'sinon';
import './mcp-panel';
import type { McpPanel } from './mcp-panel';
import type { JsaSocket } from './global';

type Handler = (...args: unknown[]) => unknown;

function fakeSocket(): JsaSocket & { handlers: Record<string, Handler> } {
  const handlers: Record<string, Handler> = {};
  return {
    connected: true,
    on: (event: string, cb: Handler) => {
      handlers[event] = cb;
    },
    emit: sinon.stub(),
    handlers,
  };
}

const STATUS = {
  enabled: true,
  running: true,
  port: 3002,
  path: '/mcp',
  externalUrl: '',
  allowlist: [],
  created: '2026-01-01T00:00:00Z',
  rotated: null,
};
const ENTRY = {
  id: 1,
  ts: Date.now(),
  tool: 'list_scripts',
  target: null,
  ip: '192.168.1.5',
  ok: true,
  error: null,
  durationMs: 12,
};

describe('mcp-panel', () => {
  let socket: ReturnType<typeof fakeSocket>;
  let api: sinon.SinonStub;
  let clipboard: sinon.SinonStub;

  const mount = async (status: Partial<typeof STATUS> = {}, activity: unknown[] = []) => {
    api = sinon.stub().callsFake(async (url: string) => {
      const body: Record<string, unknown> = {
        'api/mcp': { ...STATUS, ...status },
        'api/mcp/activity': activity,
        'api/mcp/token': { token: 'jsamcp_secret123' },
        'api/mcp/rotate': { token: 'jsamcp_rotated456' },
      };
      return { ok: true, json: async () => body[url] };
    });
    window.apiFetch = api as never;
    const el = await fixture<McpPanel>(html`<mcp-panel></mcp-panel>`);
    await aTimeout(0);
    await el.updateComplete;
    return el;
  };
  const text = (el: McpPanel) => el.shadowRoot!.textContent!.replace(/\s+/g, ' ');
  const click = async (el: McpPanel, selector: string, index = 0) => {
    (el.shadowRoot!.querySelectorAll(selector)[index] as HTMLElement).click();
    await aTimeout(0);
    await el.updateComplete;
  };

  beforeEach(() => {
    socket = fakeSocket();
    window.socket = socket;
    clipboard = sinon.stub(navigator.clipboard, 'writeText').resolves();
  });

  afterEach(() => {
    clipboard.restore();
    delete window.socket;
    delete window.apiFetch;
    delete window.confirmDialog;
  });

  it('shows the running state, the derived endpoint and a masked token', async () => {
    const el = await mount();
    expect(text(el)).to.contain('running on port 3002');
    expect(text(el)).to.contain(`http://${window.location.hostname}:3002/mcp`);
    expect(text(el)).to.contain('••••');
    expect(text(el)).to.not.contain('jsamcp_secret123');
  });

  it('explains when the server is enabled but not listening', async () => {
    const el = await mount({ running: false });
    expect(text(el)).to.contain('not running yet');
  });

  it('prefers the configured external URL and trims trailing slashes', async () => {
    const el = await mount({ externalUrl: 'https://mcp.example.com/' });
    expect(text(el)).to.contain('https://mcp.example.com/mcp');
  });

  it('reveals the token on demand and hides it again', async () => {
    const el = await mount();
    await click(el, '.icon-btn[title="Show / hide"]');
    expect(text(el)).to.contain('jsamcp_secret123');
    await click(el, '.icon-btn[title="Show / hide"]');
    expect(text(el)).to.not.contain('jsamcp_secret123');
  });

  it('copies a Claude Desktop config with the token passed via env, --allow-http only for http', async () => {
    const el = await mount();
    await click(el, '.snippet-btn');
    const config = JSON.parse(clipboard.firstCall.args[0]);
    const server = config.mcpServers['js-automations'];
    expect(server.command).to.equal('npx');
    expect(server.args).to.deep.equal([
      '-y',
      'mcp-remote',
      `http://${window.location.hostname}:3002/mcp`,
      '--header',
      'Authorization:${AUTH_HEADER}',
      '--allow-http',
    ]);
    expect(server.env).to.deep.equal({ AUTH_HEADER: 'Bearer jsamcp_secret123' });
    expect(clipboard.firstCall.args[0]).to.not.contain('--allow-http"\n    ,');

    const secure = await mount({ externalUrl: 'https://mcp.example.com' });
    await click(secure, '.snippet-btn');
    const secureArgs = JSON.parse(clipboard.lastCall.args[0]).mcpServers['js-automations'].args;
    expect(secureArgs).to.not.include('--allow-http');
    expect(secureArgs).to.include('https://mcp.example.com/mcp');
  });

  describe('rotating the token', () => {
    const rotateCalls = () => api.getCalls().filter((c) => c.args[0] === 'api/mcp/rotate');

    it('does nothing when the user declines', async () => {
      window.confirmDialog = { confirm: sinon.stub().resolves(false) } as never;
      const el = await mount();
      await click(el, '.icon-btn[title="Create new token"]');
      expect(rotateCalls().length).to.equal(0);
    });

    it('creates a new token after confirmation and shows it', async () => {
      window.confirmDialog = { confirm: sinon.stub().resolves(true) } as never;
      const el = await mount();
      await click(el, '.icon-btn[title="Create new token"]');
      expect(rotateCalls().length).to.equal(1);
      expect(rotateCalls()[0].args[1]).to.deep.equal({ method: 'POST' });
      expect(text(el)).to.contain('jsamcp_rotated456');
    });
  });

  describe('live updates', () => {
    it('lists existing calls and prepends new ones from the socket', async () => {
      const el = await mount({}, [ENTRY]);
      expect(el.shadowRoot!.querySelectorAll('.log-row').length).to.equal(1);
      expect(text(el)).to.contain('list_scripts');

      socket.handlers['mcp_activity']({
        ...ENTRY,
        id: 2,
        tool: 'write_script',
        target: 'demo.ts',
        ok: false,
        error: 'boom',
      });
      await el.updateComplete;
      const rows = el.shadowRoot!.querySelectorAll('.log-row');
      expect(rows.length).to.equal(2);
      expect(rows[0].textContent).to.contain('write_script');
      expect(rows[0].textContent).to.contain('demo.ts');
      expect(rows[0].querySelector('.log-fail')).to.not.be.null;
      expect((rows[0] as HTMLElement).title).to.equal('boom');
    });

    it('shows an empty-state hint without calls', async () => {
      const el = await mount();
      expect(text(el)).to.contain('No calls yet.');
    });

    it('follows status changes pushed by the server', async () => {
      const el = await mount({ running: false });
      socket.handlers['mcp_status_changed']({ ...STATUS, running: true });
      await el.updateComplete;
      expect(text(el)).to.contain('running on port 3002');
    });
  });
});
