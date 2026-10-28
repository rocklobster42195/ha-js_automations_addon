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

  let notes: unknown[] = [];

  const mount = async (enabled = true, activity: unknown[] = [], initialNotes: unknown[] = []) => {
    notes = initialNotes;
    api = sinon.stub().callsFake(async (url: string) => {
      const body: unknown = url === 'api/mcp' ? { enabled } : url === 'api/mcp/feedback' ? { notes } : activity;
      return { ok: true, json: async () => body };
    });
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
    expect(api.getCalls().map((c) => c.args[0])).to.have.members(['api/mcp', 'api/mcp/activity', 'api/mcp/feedback']);
    expect(el).to.exist;
  });

  describe('feedback notes from the assistant', () => {
    const note = (over: Record<string, unknown> = {}) => ({
      id: 'fb_1',
      kind: 'api',
      severity: 'normal',
      title: 'ha.register options are hard to discover',
      detail: 'Suggest grouping the options in the d.ts',
      count: 2,
      ...over,
    });
    const notesEls = (el: McpActivityPanel) => Array.from(el.shadowRoot!.querySelectorAll('.fb'));

    it('shows nothing extra without notes', async () => {
      const el = await mount();
      expect(notesEls(el).length).to.equal(0);
      expect(text(el)).to.not.contain('JSA feedback');
    });

    it('lists notes with kind, title, repeat count and detail', async () => {
      const el = await mount(true, [], [note()]);
      expect(text(el)).to.contain('JSA feedback from the assistant (1)');
      expect(notesEls(el).length).to.equal(1);
      expect(notesEls(el)[0].querySelector('.fb-badge')!.textContent).to.equal('API');
      expect(text(el)).to.contain('ha.register options are hard to discover');
      expect(text(el)).to.contain('2×');
      expect(text(el)).to.contain('Suggest grouping the options');
    });

    it('separates the notes from the call log with a titled divider', async () => {
      const el = await mount(true, [entry(), entry({ id: 2 })], [note()]);
      const titles = Array.from(el.shadowRoot!.querySelectorAll('.section-title')).map((t) =>
        t.textContent!.replace(/\s+/g, ' ').trim()
      );
      expect(titles).to.deep.equal(['JSA feedback from the assistant (1)', 'Tool calls (2)']);
      expect(el.shadowRoot!.querySelector('.section-title.divider')).to.not.be.null;

      const without = await mount(true, [entry()]);
      expect(without.shadowRoot!.querySelectorAll('.section-title').length).to.equal(0);
    });

    it('marks hard errors', async () => {
      const el = await mount(true, [], [note({ severity: 'hard_error', kind: 'bug' })]);
      const badge = notesEls(el)[0].querySelector('.fb-badge')!;
      expect(badge.classList.contains('hard')).to.equal(true);
      expect(badge.textContent).to.equal('hard error');
    });

    it('deletes a note on the server and in the list', async () => {
      const el = await mount(true, [], [note(), note({ id: 'fb_2', title: 'another one' })]);
      (notesEls(el)[0].querySelector('.fb-del') as HTMLElement).click();
      await aTimeout(0);
      await el.updateComplete;

      const del = api.getCalls().find((c) => c.args[1]?.method === 'DELETE');
      expect(del!.args[0]).to.equal('api/mcp/feedback/fb_1');
      expect(notesEls(el).length).to.equal(1);
      expect(text(el)).to.contain('another one');
    });

    it('reloads when the server reports changed notes', async () => {
      const el = await mount();
      notes = [note({ id: 'fb_9', title: 'fresh note' })];
      await socket.handlers['mcp_feedback_changed']();
      await aTimeout(0);
      await el.updateComplete;
      expect(text(el)).to.contain('fresh note');
    });
  });
});
