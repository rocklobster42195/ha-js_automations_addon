import { fixture, html, expect, aTimeout } from '@open-wc/testing';
import sinon from 'sinon';
import './mcp-activity-panel';
import type { McpActivityPanel } from './mcp-activity-panel';
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

const entry = (over: Record<string, unknown> = {}) => ({
  id: 1,
  ts: Date.now(),
  tool: 'list_scripts',
  target: null,
  ip: '192.168.1.5',
  ok: true,
  error: null,
  durationMs: 12,
  ...over,
});

describe('mcp-activity-panel', () => {
  let socket: ReturnType<typeof fakeSocket>;
  let api: sinon.SinonStub;

  const mount = async (enabled = true, activity: unknown[] = []) => {
    api = sinon.stub().callsFake(async (url: string) => ({
      ok: true,
      json: async () => (url === 'api/mcp' ? { enabled } : activity),
    }));
    window.apiFetch = api as never;
    const el = await fixture<McpActivityPanel>(html`<mcp-activity-panel></mcp-activity-panel>`);
    await aTimeout(0);
    await el.updateComplete;
    return el;
  };
  const rows = (el: McpActivityPanel) => Array.from(el.shadowRoot!.querySelectorAll('.row'));
  const text = (el: McpActivityPanel) => el.shadowRoot!.textContent!.replace(/\s+/g, ' ');

  beforeEach(() => {
    socket = fakeSocket();
    window.socket = socket;
  });

  afterEach(() => {
    delete window.socket;
    delete window.apiFetch;
  });

  it('lists the calls it is given with tool, target, source and duration', async () => {
    const el = await mount(true, [entry({ tool: 'read_script', target: 'demo.ts', durationMs: 33 })]);
    expect(rows(el).length).to.equal(1);
    expect(text(el)).to.contain('read_script');
    expect(text(el)).to.contain('demo.ts');
    expect(text(el)).to.contain('192.168.1.5 · 33 ms');
    expect(rows(el)[0].querySelector('.ok')).to.not.be.null;
  });

  it('prepends live calls from the socket and shows the error of failed ones', async () => {
    const el = await mount(true, [entry()]);
    socket.handlers['mcp_activity'](
      entry({ id: 2, tool: 'write_script', target: 'demo.ts', ok: false, error: 'Not written — syntax errors' })
    );
    await el.updateComplete;

    expect(rows(el).length).to.equal(2);
    expect(rows(el)[0].textContent).to.contain('write_script');
    expect(rows(el)[0].querySelector('.fail')).to.not.be.null;
    expect(rows(el)[0].querySelector('.error')!.textContent).to.contain('syntax errors');
    expect(rows(el)[1].querySelector('.error')).to.be.null;
  });

  it('keeps at most 200 entries', async () => {
    const el = await mount();
    for (let i = 0; i < 210; i++) socket.handlers['mcp_activity'](entry({ id: i }));
    await el.updateComplete;
    expect(rows(el).length).to.equal(200);
  });

  it('shows a hint while nothing was called yet', async () => {
    const el = await mount();
    expect(rows(el).length).to.equal(0);
    expect(text(el)).to.contain('No tool calls yet');
  });

  it('says the server is off, and reacts when it is switched on or off', async () => {
    const el = await mount(false);
    expect(text(el)).to.contain('switched off');

    socket.handlers['mcp_status_changed']({ enabled: true });
    await el.updateComplete;
    expect(text(el)).to.not.contain('switched off');

    socket.handlers['mcp_status_changed']({ enabled: false });
    await el.updateComplete;
    expect(text(el)).to.contain('switched off');
  });

  it('re-syncs after a socket reconnect', async () => {
    const el = await mount();
    api.resetHistory();
    await socket.handlers['connect']();
    await aTimeout(0);
    expect(api.getCalls().map((c) => c.args[0])).to.have.members(['api/mcp', 'api/mcp/activity']);
    expect(el).to.exist;
  });
});
