import { fixture, html, expect } from '@open-wc/testing';
import './monaco-editor';
import { ensureCodiconFont } from './monaco-editor';

describe('monaco-editor: icon font', () => {
  afterEach(() => {
    document.getElementById('jsa-codicon-font')?.remove();
  });

  it('declares the codicon font on the document, once', async () => {
    await fixture(html`<monaco-editor></monaco-editor>`);
    await fixture(html`<monaco-editor></monaco-editor>`);
    ensureCodiconFont();

    const styles = document.head.querySelectorAll('#jsa-codicon-font');
    expect(styles.length).to.equal(1);
    expect(styles[0].textContent).to.contain('font-family:codicon');
    expect(styles[0].textContent).to.contain('codicon.ttf');
  });
});
