import { fixture, html, expect, aTimeout } from '@open-wc/testing';
import sinon from 'sinon';
import './status-bar-header-actions';
import type { StatusBarHeaderActions } from './status-bar-header-actions';
import type { JsaSocket, JsaHaState } from './global';

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

describe('status-bar-header-actions', () => {
  beforeEach(() => {
    window.socket = fakeSocket();
  });

  afterEach(() => {
    delete window.socket;
    delete window.currentSettings;
    delete window.cachedEntities;
    delete window.apiFetch;
  });

  it('renders no buttons when no header actions are configured', async () => {
    const el = await fixture<StatusBarHeaderActions>(html`<status-bar-header-actions></status-bar-header-actions>`);
    expect(el.shadowRoot!.querySelectorAll('button').length).to.equal(0);
  });

  it('applies window.currentSettings immediately on connect', async () => {
    window.currentSettings = { statusbar: { header_action_1: 'switch.garage_light' } };
    window.cachedEntities = [
      { entity_id: 'switch.garage_light', state: 'on', attributes: { friendly_name: 'Garage Light' } },
    ];
    const el = await fixture<StatusBarHeaderActions>(html`<status-bar-header-actions></status-bar-header-actions>`);
    await aTimeout(0);
    await el.updateComplete;

    const button = el.shadowRoot!.querySelector('button');
    expect(button).to.not.be.null;
    expect(button!.title).to.equal('Garage Light\n(switch.garage_light)');
    expect(button!.querySelector('i')!.className).to.contain('mdi-toggle-switch');
  });

  it('reacts to a settings-changed event and looks up the configured entity', async () => {
    window.cachedEntities = [
      { entity_id: 'button.doorbell', state: 'unknown', attributes: { friendly_name: 'Doorbell' } },
    ];
    const el = await fixture<StatusBarHeaderActions>(html`<status-bar-header-actions></status-bar-header-actions>`);

    window.dispatchEvent(
      new CustomEvent('settings-changed', { detail: { statusbar: { header_action_1: 'button.doorbell' } } })
    );
    await aTimeout(0);
    await el.updateComplete;

    const button = el.shadowRoot!.querySelector('button');
    expect(button!.querySelector('i')!.className).to.contain('mdi-gesture-tap-button');
  });

  it('updates an already-rendered button on a live ha_state_changed event', async () => {
    window.cachedEntities = [{ entity_id: 'switch.fan', state: 'off', attributes: {} }];
    const el = await fixture<StatusBarHeaderActions>(html`<status-bar-header-actions></status-bar-header-actions>`);
    window.dispatchEvent(
      new CustomEvent('settings-changed', { detail: { statusbar: { header_action_1: 'switch.fan' } } })
    );
    await aTimeout(0);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('button i')!.className).to.contain('toggle-switch-off');

    (window.socket as ReturnType<typeof fakeSocket>).handlers['ha_state_changed']({
      entity_id: 'switch.fan',
      new_state: { entity_id: 'switch.fan', state: 'on', attributes: {} } as JsaHaState,
    });
    await el.updateComplete;

    const icon = el.shadowRoot!.querySelector('button i')!;
    expect(icon.className).to.contain('mdi-toggle-switch');
    expect(icon.className).to.not.contain('toggle-switch-off');
  });

  it('uses attributes.icon_color for an active entity with no rgb_color', async () => {
    window.cachedEntities = [{ entity_id: 'light.desk', state: 'on', attributes: { icon_color: '#ff8800' } }];
    const el = await fixture<StatusBarHeaderActions>(html`<status-bar-header-actions></status-bar-header-actions>`);
    window.dispatchEvent(
      new CustomEvent('settings-changed', { detail: { statusbar: { header_action_1: 'light.desk' } } })
    );
    await aTimeout(0);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('button i')!.getAttribute('style')).to.contain('#ff8800');
  });

  it('clicking a switch button optimistically flips color and calls apiFetch with the right service', async () => {
    window.cachedEntities = [{ entity_id: 'switch.fan', state: 'off', attributes: {} }];
    let resolveFetch!: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const apiFetch = sinon.stub().returns(fetchPromise);
    window.apiFetch = apiFetch;

    const el = await fixture<StatusBarHeaderActions>(html`<status-bar-header-actions></status-bar-header-actions>`);
    window.dispatchEvent(
      new CustomEvent('settings-changed', { detail: { statusbar: { header_action_1: 'switch.fan' } } })
    );
    await aTimeout(0);
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click();
    await el.updateComplete;

    expect(apiFetch.calledOnce).to.be.true;
    const [url, opts] = apiFetch.firstCall.args as [string, RequestInit];
    expect(url).to.equal('api/ha/call-service');
    expect(JSON.parse(opts.body as string)).to.deep.equal({
      domain: 'switch',
      service: 'turn_on',
      entity_id: 'switch.fan',
    });
    // Optimistic flip: switch was off, so the icon color should already show the "active" tone.
    expect(el.shadowRoot!.querySelector('button i')!.getAttribute('style')).to.contain('var(--primary-color');

    resolveFetch({});
  });

  it('clicking a button-domain entity calls the press service', async () => {
    window.cachedEntities = [{ entity_id: 'button.doorbell', state: 'unknown', attributes: {} }];
    const apiFetch = sinon.stub().resolves({});
    window.apiFetch = apiFetch;

    const el = await fixture<StatusBarHeaderActions>(html`<status-bar-header-actions></status-bar-header-actions>`);
    window.dispatchEvent(
      new CustomEvent('settings-changed', { detail: { statusbar: { header_action_1: 'button.doorbell' } } })
    );
    await aTimeout(0);
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click();
    await aTimeout(0);

    expect(apiFetch.calledOnce).to.be.true;
    const [, opts] = apiFetch.firstCall.args as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).to.deep.equal({
      domain: 'button',
      service: 'press',
      entity_id: 'button.doorbell',
    });
  });
});
