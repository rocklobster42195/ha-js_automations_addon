import { fixture, html, expect, aTimeout } from '@open-wc/testing';
import sinon from 'sinon';
import './editor-view';
import type { EditorViewElement } from './editor-view';
import type { JsaSocket, JsaTab } from './global';

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

/** Answers the content/card fetches an external change triggers; everything else is a quiet 404. */
function fakeApi(responses: Record<string, string>) {
  return sinon.stub().callsFake(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST' || init?.method === 'PUT') return { ok: true, json: async () => ({ ok: true }) };
    const content = responses[url];
    if (content === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return { ok: true, json: async () => ({ content }) };
  });
}

describe('editor-view: files changed on disk by an AI assistant', () => {
  let socket: ReturnType<typeof fakeSocket>;
  let setModelValue: sinon.SinonStub;
  let toast: sinon.SinonStub;
  let el: EditorViewElement;

  const tabs = (): JsaTab[] => (window as unknown as { openTabs: JsaTab[] }).openTabs;
  const demoTab = (over: Partial<JsaTab> = {}): JsaTab => ({
    filename: 'demo.ts',
    icon: '',
    model: { id: 'model' },
    isDirty: false,
    originalContent: 'old',
    ...over,
  });
  const emitChange = async (filename = 'demo.ts') => {
    await socket.handlers['script_content_changed']({ filename });
    await aTimeout(0);
  };

  beforeEach(async () => {
    socket = fakeSocket();
    window.socket = socket;
    window.apiFetch = fakeApi({
      'api/scripts/demo.ts/content': 'new from AI',
      'api/scripts/demo.ts/card': 'card from AI',
      'api/git/status': '',
    }) as never;
    toast = sinon.stub();
    window.alertToast = { show: toast } as never;
    el = await fixture<EditorViewElement>(html`<editor-view></editor-view>`);
    // The embedded <monaco-editor> installs its own bridge on connect; replace it afterwards.
    setModelValue = sinon.stub();
    window.monacoEditor = { setModelValue, isReady: () => true, getModelValue: () => '' } as never;
  });

  afterEach(() => {
    tabs().splice(0, tabs().length);
    delete window.socket;
    delete window.apiFetch;
    delete window.alertToast;
    delete window.confirmDialog;
    delete window.monacoEditor;
    delete window.loadScripts;
  });

  it('subscribes to the script_content_changed socket event', () => {
    expect(socket.handlers['script_content_changed']).to.be.a('function');
  });

  it('reloads a clean tab silently, keeping it clean', async () => {
    const tab = demoTab();
    tabs().push(tab);
    await emitChange();

    expect(setModelValue.calledOnceWith(tab.model, 'new from AI')).to.equal(true);
    expect(tab.originalContent).to.equal('new from AI');
    expect(tab.isDirty).to.equal(false);
    expect(toast.firstCall.args[1]).to.deep.equal({ variant: 'info' });
  });

  it('does nothing when the tab already has the new content', async () => {
    tabs().push(demoTab({ originalContent: 'new from AI' }));
    await emitChange();
    expect(setModelValue.called).to.equal(false);
    expect(toast.called).to.equal(false);
  });

  it('ignores files that are not open', async () => {
    await emitChange('other.ts');
    expect(setModelValue.called).to.equal(false);
    expect(toast.called).to.equal(false);
  });

  it('keeps unsaved edits, flags the conflict and warns only once', async () => {
    const tab = demoTab({ isDirty: true });
    tabs().push(tab);
    await emitChange();
    await emitChange();

    expect(setModelValue.called).to.equal(false);
    expect(tab.externalChange).to.equal(true);
    expect(tab.isDirty).to.equal(true);
    expect(toast.callCount).to.equal(1);
    expect(toast.firstCall.args[1]).to.deep.equal({ variant: 'warning' });
  });

  it('shows a lasting banner for the conflict and lets the user load the AI version', async () => {
    const tab = demoTab({ isDirty: true });
    tabs().push(tab);
    (el as unknown as { _activeTabFilename: string })._activeTabFilename = tab.filename;
    await emitChange();
    await el.updateComplete;

    const banner = el.shadowRoot!.querySelector('.mode-banner.conflict');
    expect(banner, 'banner for the unsaved edits').to.not.equal(null);

    (banner!.querySelector('button') as HTMLButtonElement).click();
    await aTimeout(0);
    await el.updateComplete;

    expect(setModelValue.calledOnceWith(tab.model, 'new from AI')).to.equal(true);
    expect(tab.isDirty).to.equal(false);
    expect(tab.externalChange).to.equal(false);
    expect(el.shadowRoot!.querySelector('.mode-banner.conflict')).to.equal(null);
  });

  describe('a file deleted behind the editor', () => {
    beforeEach(() => {
      window.apiFetch = fakeApi({ 'api/git/status': '' }) as never;
    });

    it('closes a clean tab', async () => {
      const closeTab = sinon.stub().resolves();
      el.closeTab = closeTab;
      tabs().push(demoTab());
      await emitChange();
      expect(closeTab.calledOnceWith('demo.ts')).to.equal(true);
      expect(toast.firstCall.args[1]).to.deep.equal({ variant: 'info' });
    });

    it('keeps a tab with unsaved edits and shows a banner; saving recreates the file', async () => {
      const closeTab = sinon.stub().resolves();
      el.closeTab = closeTab;
      const tab = demoTab({ isDirty: true });
      tabs().push(tab);
      (el as unknown as { _activeTabFilename: string })._activeTabFilename = tab.filename;
      await emitChange();
      await el.updateComplete;

      expect(closeTab.called).to.equal(false);
      expect(tab.deleted).to.equal(true);
      expect(el.shadowRoot!.querySelector('.mode-banner.conflict')).to.not.equal(null);
      expect(toast.firstCall.args[1]).to.deep.equal({ variant: 'warning' });
    });
  });

  it('reloads the paired card tab too', async () => {
    const card = demoTab({
      filename: 'demo.ts[card]',
      type: 'card',
      parentScript: 'demo.ts',
      originalContent: 'old card',
    });
    tabs().push(card);
    await emitChange();
    expect(setModelValue.calledOnceWith(card.model, 'card from AI')).to.equal(true);
    expect(card.originalContent).to.equal('card from AI');
  });

  describe('saving a tab with an external change', () => {
    const save = async (tab: JsaTab) => {
      tabs().push(tab);
      (el as unknown as { _activeTabFilename: string })._activeTabFilename = tab.filename;
      window.monacoEditor = { getModelValue: () => 'my version' } as never;
      window.loadScripts = sinon.stub().resolves() as never;
      await el.saveActiveTab();
    };
    const posts = () =>
      (window.apiFetch as unknown as sinon.SinonStub).getCalls().filter((c) => c.args[1]?.method === 'POST');

    it('asks first and aborts when the user declines', async () => {
      const confirm = sinon.stub().resolves(false);
      window.confirmDialog = { confirm } as never;
      const tab = demoTab({ isDirty: true, externalChange: true });
      await save(tab);

      expect(confirm.calledOnce).to.equal(true);
      expect(posts().length).to.equal(0);
      expect(tab.isDirty).to.equal(true);
      expect(tab.externalChange).to.equal(true);
    });

    it('saves and clears the conflict when the user confirms', async () => {
      window.confirmDialog = { confirm: sinon.stub().resolves(true) } as never;
      const tab = demoTab({ isDirty: true, externalChange: true });
      await save(tab);

      expect(posts().length).to.equal(1);
      expect(tab.isDirty).to.equal(false);
      expect(tab.externalChange).to.equal(false);
      expect(tab.originalContent).to.equal('my version');
    });

    it('does not ask when nothing changed externally', async () => {
      const confirm = sinon.stub().resolves(false);
      window.confirmDialog = { confirm } as never;
      await save(demoTab({ isDirty: true }));
      expect(confirm.called).to.equal(false);
      expect(posts().length).to.equal(1);
    });
  });
});
