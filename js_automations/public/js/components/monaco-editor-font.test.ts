import { fixture, html, expect } from '@open-wc/testing';
import './monaco-editor';
import { ensureCodiconFont, treatEnclosingShadowHostsAsInside } from './monaco-editor';

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

describe('monaco-editor: hover inside Shadow DOM', () => {
  it('counts the enclosing shadow hosts as part of the editor node', () => {
    const outerHost = document.createElement('div');
    const outerRoot = outerHost.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('div');
    outerRoot.appendChild(innerHost);
    const innerRoot = innerHost.attachShadow({ mode: 'open' });
    const editorNode = document.createElement('div');
    const inside = document.createElement('span');
    editorNode.appendChild(inside);
    innerRoot.appendChild(editorNode);
    document.body.appendChild(outerHost);

    const stranger = document.createElement('div');
    document.body.appendChild(stranger);

    // What a document-level mousemove listener sees for any pointer movement in there: the outermost host.
    expect(editorNode.contains(outerHost)).to.equal(false);
    treatEnclosingShadowHostsAsInside(editorNode);
    expect(editorNode.contains(outerHost)).to.equal(true);
    expect(editorNode.contains(innerHost)).to.equal(true);
    expect(editorNode.contains(inside)).to.equal(true);
    expect(editorNode.contains(stranger)).to.equal(false);
    expect(editorNode.contains(null)).to.equal(false);

    outerHost.remove();
    stranger.remove();
  });
});
