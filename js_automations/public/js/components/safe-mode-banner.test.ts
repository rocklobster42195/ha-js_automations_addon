import { fixture, html, expect, aTimeout } from '@open-wc/testing';
import sinon from 'sinon';
import './safe-mode-banner';
import type { SafeModeBanner } from './safe-mode-banner';
import type { JsaSocket } from './global';

/** Minimal fake of the socket.io client surface this component actually uses —
 * captures registered handlers by event name so a test can fire them manually. */
function fakeSocket(): JsaSocket & { handlers: Record<string, (...args: unknown[]) => void> } {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    connected: true,
    on: (event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
    },
    emit: sinon.stub(),
    handlers,
  };
}

describe('safe-mode-banner', () => {
  afterEach(() => {
    delete window.socket;
    delete window.apiFetch;
    delete window.alertToast;
  });

  it('renders nothing until Safe Mode is reported active', async () => {
    window.socket = fakeSocket();
    const el = await fixture<SafeModeBanner>(html`<safe-mode-banner></safe-mode-banner>`);
    expect(el.shadowRoot!.querySelector('.banner')).to.be.null;
  });

  it('shows the banner once the safe_mode socket event fires with true', async () => {
    const socket = fakeSocket();
    window.socket = socket;
    const el = await fixture<SafeModeBanner>(html`<safe-mode-banner></safe-mode-banner>`);

    socket.handlers['safe_mode'](true);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.banner')).to.not.be.null;
    expect(el.shadowRoot!.querySelector('.title')?.textContent).to.equal('SAFE MODE ACTIVE');
  });

  it('queries get_integration_status on connect and reflects the response', async () => {
    const socket = fakeSocket();
    window.socket = socket;
    const el = await fixture<SafeModeBanner>(html`<safe-mode-banner></safe-mode-banner>`);

    socket.handlers['connect']();
    expect((socket.emit as sinon.SinonStub).calledWith('get_integration_status')).to.be.true;

    const callback = (socket.emit as sinon.SinonStub).firstCall.args[1] as (r: { safe_mode: boolean }) => void;
    callback({ safe_mode: true });
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.banner')).to.not.be.null;
  });

  it('resolves Safe Mode on button click: disables the button while in flight, hides the banner and toasts on success', async () => {
    const socket = fakeSocket();
    window.socket = socket;
    let resolveFetch!: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    window.apiFetch = sinon.stub().returns(fetchPromise);
    const toastShow = sinon.stub();
    window.alertToast = { show: toastShow };

    const el = await fixture<SafeModeBanner>(html`<safe-mode-banner></safe-mode-banner>`);
    socket.handlers['safe_mode'](true);
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLButtonElement>('.btn')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>('.btn')!.disabled).to.be.true;
    expect((window.apiFetch as sinon.SinonStub).calledWith('api/system/safe-mode/resolve', { method: 'POST' })).to.be
      .true;

    resolveFetch({ json: async () => ({ success: true }) });
    await aTimeout(0);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.banner')).to.be.null;
    expect(toastShow.calledOnce).to.be.true;
    expect(toastShow.firstCall.args[1]).to.deep.equal({ variant: 'success' });
  });

  it('re-enables the button and keeps the banner up when the resolve call reports failure', async () => {
    const socket = fakeSocket();
    window.socket = socket;
    window.apiFetch = sinon.stub().resolves({ json: async () => ({ success: false }) });
    window.alertToast = { show: sinon.stub() };

    const el = await fixture<SafeModeBanner>(html`<safe-mode-banner></safe-mode-banner>`);
    socket.handlers['safe_mode'](true);
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLButtonElement>('.btn')!.click();
    await aTimeout(0);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.banner')).to.not.be.null;
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>('.btn')!.disabled).to.be.false;
  });

  it('shows a failure toast and re-enables the button when the resolve call throws', async () => {
    const socket = fakeSocket();
    window.socket = socket;
    window.apiFetch = sinon.stub().rejects(new Error('network down'));
    const toastShow = sinon.stub();
    window.alertToast = { show: toastShow };
    const consoleError = sinon.stub(console, 'error');

    const el = await fixture<SafeModeBanner>(html`<safe-mode-banner></safe-mode-banner>`);
    socket.handlers['safe_mode'](true);
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLButtonElement>('.btn')!.click();
    await aTimeout(0);
    await el.updateComplete;

    expect(toastShow.calledOnce).to.be.true;
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>('.btn')!.disabled).to.be.false;
    consoleError.restore();
  });
});
