"use strict";
// core/mcp-edits.ts
// Search-and-replace edits for edit_script / edit_card: change a few lines of a large file without resending it.
// All-or-nothing: if one edit cannot be applied, nothing is changed and the error names that edit.
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyEdits = applyEdits;
const preview = (s) => {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
};
/** Applies the edits in order; each one sees the result of the previous one. */
function applyEdits(source, edits) {
    const usesCrlf = source.includes('\r\n');
    let text = source;
    let replacements = 0;
    for (let i = 0; i < edits.length; i++) {
        const label = edits.length > 1 ? `Edit ${i + 1} of ${edits.length}` : 'The edit';
        let from = edits[i].old_string;
        let to = edits[i].new_string;
        if (from === '')
            return { ok: false, error: `${label}: old_string is empty.` };
        if (from === to)
            return { ok: false, error: `${label}: old_string and new_string are identical.` };
        // The file uses Windows line endings but the edit was written with plain newlines: match what the file has.
        if (usesCrlf && from.includes('\n') && !from.includes('\r\n')) {
            from = from.replace(/\n/g, '\r\n');
            to = to.replace(/\r?\n/g, '\r\n');
        }
        const count = text.split(from).length - 1;
        if (count === 0) {
            return {
                ok: false,
                error: `${label}: old_string was not found ("${preview(from)}"). It must match the file exactly, including ` +
                    'indentation and line breaks; read the file again if it may have changed.',
            };
        }
        if (count > 1 && !edits[i].replace_all) {
            return {
                ok: false,
                error: `${label}: old_string matches ${count} times ("${preview(from)}"). Include more of the surrounding lines ` +
                    'to make it unique, or set replace_all to change every occurrence.',
            };
        }
        if (edits[i].replace_all) {
            text = text.split(from).join(to);
            replacements += count;
        }
        else {
            const at = text.indexOf(from);
            text = text.slice(0, at) + to + text.slice(at + from.length);
            replacements += 1;
        }
    }
    return { ok: true, text, replacements };
}
