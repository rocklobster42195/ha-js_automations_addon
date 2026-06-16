/**
 * JS AUTOMATIONS - Layout Manager
 * Handles UI resizing and layout adjustments.
 */

function initResizer() {
    const resizer = document.getElementById('resizer');
    const editorSection = document.getElementById('editor-section');
    const mainContent = document.querySelector('.main-content');

    if (!resizer || !editorSection || !mainContent) return;

    // Restore saved height from localStorage
    const savedEditorHeight = localStorage.getItem('js_editor_height_px');
    if (savedEditorHeight) {
        editorSection.style.height = `${savedEditorHeight}px`;
    }

    const handleMouseMove = (e) => {
        const mainContentRect = mainContent.getBoundingClientRect();
        let newEditorHeight = e.clientY - mainContentRect.top;

        // Constraints
        const minHeight = 90; // From CSS (tab-bar + editor-toolbar)
        const maxHeight = mainContent.clientHeight - 45 - resizer.offsetHeight; // 45px for log-header
        
        if (newEditorHeight < minHeight) newEditorHeight = minHeight;
        if (newEditorHeight > maxHeight) newEditorHeight = maxHeight;
        
        editorSection.style.height = `${newEditorHeight}px`;
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        document.body.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Save the new height in pixels
        localStorage.setItem('js_editor_height_px', editorSection.clientHeight);
    };

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        document.body.classList.add('resizing');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });
}

window.initResizer = initResizer;

function initLogPaneResizer() {
    const resizer = document.getElementById('log-pane-resizer');
    const paneRight = document.querySelector('.log-pane-right');
    if (!resizer || !paneRight) return;

    const saved = localStorage.getItem('js_dev_pane_width_px');
    if (saved) paneRight.style.width = `${saved}px`;

    const handleMouseMove = (e) => {
        const logSection = document.querySelector('.log-section');
        const rect = logSection.getBoundingClientRect();
        const newWidth = rect.right - e.clientX;
        const clamped = Math.min(Math.max(newWidth, 200), rect.width * 0.7);
        paneRight.style.width = `${clamped}px`;
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.classList.remove('resizing-pane');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('js_dev_pane_width_px', parseInt(paneRight.style.width));
    };

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.classList.add('resizing-pane');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });
}

window.initLogPaneResizer = initLogPaneResizer;

function initDevPanelTabs() {
    const tabBar = document.querySelector('.log-pane-tab-bar');
    if (!tabBar) return;

    tabBar.addEventListener('click', (e) => {
        const tab = e.target.closest('.log-pane-tab');
        if (!tab) return;
        const target = tab.dataset.tab;

        tabBar.querySelectorAll('.log-pane-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.dev-tab-panel').forEach(panel => {
            panel.classList.toggle('hidden', panel.id !== `dev-tab-${target}`);
        });
    });
}

window.initDevPanelTabs = initDevPanelTabs;