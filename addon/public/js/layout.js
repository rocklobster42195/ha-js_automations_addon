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