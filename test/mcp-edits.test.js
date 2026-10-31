const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyEdits } = require('../js_automations/core/mcp-edits.js');

const edit = (old_string, new_string, replace_all) => ({ old_string, new_string, replace_all });

test('a unique match is replaced, "$" in the text is taken literally', () => {
  const r = applyEdits('a = 1;\nb = 2;\n', [edit('b = 2;', "b = '$&';")]);
  assert.deepEqual(r, { ok: true, text: "a = 1;\nb = '$&';\n", replacements: 1 });
});

test('no match, several matches and empty or identical edits are errors that name the edit', () => {
  const src = 'x\nx\ny\n';
  assert.match(applyEdits(src, [edit('zzz', 'a')]).error, /not found/);
  assert.match(applyEdits(src, [edit('x', 'a')]).error, /matches 2 times/);
  assert.match(applyEdits(src, [edit('', 'a')]).error, /empty/);
  assert.match(applyEdits(src, [edit('y', 'y')]).error, /identical/);
  assert.match(applyEdits(src, [edit('y', 'z'), edit('nope', 'a')]).error, /Edit 2 of 2/);
});

test('replace_all changes every occurrence and counts them', () => {
  const r = applyEdits('x\nx\ny\n', [edit('x', 'a', true)]);
  assert.equal(r.text, 'a\na\ny\n');
  assert.equal(r.replacements, 2);
});

test('edits apply in order and an error leaves nothing half done', () => {
  assert.equal(applyEdits('one', [edit('one', 'two'), edit('two', 'three')]).text, 'three');
  const failed = applyEdits('one', [edit('one', 'two'), edit('missing', 'x')]);
  assert.equal(failed.ok, false);
  assert.equal(failed.text, undefined);
});

test('a file with Windows line endings still matches multi-line edits', () => {
  const r = applyEdits('a\r\nb\r\nc\r\n', [edit('a\nb', 'a\nB\nb2')]);
  assert.equal(r.text, 'a\r\nB\r\nb2\r\nc\r\n');
});
