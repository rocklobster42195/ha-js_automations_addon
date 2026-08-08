/**
 * Developer Tools — Live REPL
 * Runs a JS snippet in a sandboxed server-side worker with full ha API access.
 */

let _replEditor = null;
let _replEditorInit = false;

// IDs from SNIPPET_REGISTRY that make sense in a one-shot REPL worker.
// Excludes ha.on / ha.onStop / ha.register / card-* (need a persistent worker).
const REPL_SNIPPET_IDS = [
    'log', 'service', 'notify', 'ask',
    'state', 'select', 'update_state',
    'store_set', 'store_get', 'store_del',
];

function initRepl() {
    const panel = document.getElementById('dev-tab-repl');
    if (!panel) return;

    panel.innerHTML = `
        <div class="repl-wrap">
            <div class="repl-toolbar">
                <button class="repl-toolbar-btn" onclick="runRepl()" title="Run (Ctrl+Enter)">
                    <i class="mdi mdi-play"></i>
                </button>
                <button class="repl-toolbar-btn" onclick="clearReplEditor()" title="Clear editor">
                    <i class="mdi mdi-trash-can-outline"></i>
                </button>
                <div class="repl-snippet-wrap">
                    <button class="repl-toolbar-btn" onclick="toggleReplSnippets(event)" title="Snippets">
                        <i class="mdi mdi-code-braces"></i>
                    </button>
                    <div id="repl-snippets-dropdown" class="repl-snippets-dropdown hidden"></div>
                </div>
                <span id="repl-status" class="repl-status"></span>
            </div>
            <div class="repl-editor-wrap" id="repl-editor-container"></div>
        </div>
    `;

    _buildSnippetDropdown();

    if (typeof observeTabVisibility === 'function') {
        observeTabVisibility(panel, (visible) => {
            if (visible && !_replEditorInit) _initReplEditor();
        });
    }
    if (!panel.classList.contains('hidden') && !_replEditorInit) _initReplEditor();

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.repl-snippet-wrap')) _closeReplSnippets();
    }, true);
}

function _buildSnippetDropdown() {
    const dropdown = document.getElementById('repl-snippets-dropdown');
    if (!dropdown) return;

    const registry = (typeof SNIPPET_REGISTRY !== 'undefined' && Array.isArray(SNIPPET_REGISTRY))
        ? SNIPPET_REGISTRY : [];

    REPL_SNIPPET_IDS.forEach(id => {
        const def = registry.find(s => s.id === id);
        if (!def) return;
        const label = (typeof i18next !== 'undefined')
            ? i18next.t(def.labelKey, { defaultValue: def.id })
            : def.id;
        const row = document.createElement('div');
        row.className = 'repl-snippet-row';
        row.innerHTML = `<i class="mdi ${def.icon}"></i><span>${label}</span>`;
        row.onmousedown = (e) => {
            e.preventDefault();
            _insertReplSnippet(def);
            _closeReplSnippets();
        };
        dropdown.appendChild(row);
    });
}

function _initReplEditor() {
    _replEditorInit = true;
    if (typeof monaco === 'undefined') return;
    _replEditor = monaco.editor.create(document.getElementById('repl-editor-container'), {
        value: '// ha.log(ha.getState(\'sun.sun\'));\n',
        language: 'javascript',
        theme: 'vs-dark',
        minimap: { enabled: false },
        lineNumbers: 'off',
        scrollBeyondLastLine: false,
        fontSize: 12,
        automaticLayout: true,
        overviewRulerLanes: 0,
        folding: false,
        renderLineHighlight: 'none',
    });
    _replEditor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => runRepl()
    );
    _replEditor.onDidChangeModelContent(() => {
        const el = document.getElementById('repl-status');
        if (el) el.textContent = '';
    });
}

function _insertReplSnippet(def) {
    if (!_replEditor) return;
    const template = def.full || def.minimal;
    if (!template) return;
    _replEditor.focus();
    _replEditor.getContribution('snippetController2').insert(template);
}

function toggleReplSnippets(e) {
    e.stopPropagation();
    const d = document.getElementById('repl-snippets-dropdown');
    if (d) d.classList.toggle('hidden');
}

function _closeReplSnippets() {
    const d = document.getElementById('repl-snippets-dropdown');
    if (d) d.classList.add('hidden');
}

function clearReplEditor() {
    if (_replEditor) {
        _replEditor.setValue('');
        _replEditor.focus();
    }
    const el = document.getElementById('repl-status');
    if (el) el.textContent = '';
}

async function runRepl() {
    const code = _replEditor ? _replEditor.getValue() : '';
    if (!code.trim()) return;

    const statusEl = document.getElementById('repl-status');
    if (statusEl) statusEl.textContent = 'Running…';

    try {
        const res = await apiFetch('api/debug/repl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();

        if (statusEl) statusEl.textContent = data.error ? '✗ Error' : '✓ Done';

        const entries = data.logs || [];
        if (data.error) entries.push({ level: 'error', message: data.error });

        entries.forEach(entry => {
            if (typeof appendLog === 'function') {
                appendLog({ source: 'REPL', message: entry.message, level: entry.level });
            }
        });
    } catch (e) {
        if (statusEl) statusEl.textContent = '✗ Network error';
        if (typeof appendLog === 'function') appendLog({ source: 'REPL', message: e.message, level: 'error' });
    }
}

window.initRepl           = initRepl;
window.runRepl            = runRepl;
window.clearReplEditor    = clearReplEditor;
window.toggleReplSnippets = toggleReplSnippets;
