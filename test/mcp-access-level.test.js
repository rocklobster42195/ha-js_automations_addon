const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MCP_TOOL_CATALOG,
  MCP_SEPARATE_SWITCH_TOOLS,
  isToolEnabled,
  migrateMcpAccessLevel,
} = require('../js_automations/core/mcp-tool-catalog.js');

const enabled = (settings) =>
  MCP_TOOL_CATALOG.filter((m) => !m.maintainerOnly && isToolEnabled(settings, m)).map((m) => m.name);

test('each access level adds one group and never touches the separately switched tools', () => {
  const read = enabled({ access_level: 'read' });
  const control = enabled({ access_level: 'control' });
  const write = enabled({ access_level: 'write' });

  assert.ok(read.includes('read_script') && !read.includes('start_script') && !read.includes('write_script'));
  assert.ok(
    control.includes('start_script') && control.includes('restart_script') && !control.includes('write_script')
  );
  assert.ok(write.includes('write_script') && write.includes('write_card'));

  for (const level of [read, control, write]) {
    for (const name of MCP_SEPARATE_SWITCH_TOOLS) assert.ok(!level.includes(name), `${name} stays off by default`);
  }
});

test('the separately switched tools follow their own switch at every level', () => {
  for (const level of ['read', 'control', 'write', 'custom']) {
    const on = enabled({
      access_level: level,
      tool_delete_script: true,
      tool_call_service: true,
      tool_get_store: true,
      tool_run_snippet: true,
    });
    for (const name of MCP_SEPARATE_SWITCH_TOOLS) assert.ok(on.includes(name), `${name} on at level ${level}`);
  }
});

test('"custom" and missing levels use the switch of every tool, with the catalog defaults', () => {
  assert.deepEqual(enabled({ access_level: 'custom' }), enabled({}));
  const custom = enabled({ access_level: 'custom', tool_write_script: true, tool_start_script: false });
  assert.ok(custom.includes('write_script') && !custom.includes('start_script'));
  // The level overrides single switches of the tools it covers.
  const levelRead = enabled({ access_level: 'read', tool_write_script: true });
  assert.ok(!levelRead.includes('write_script'));
});

test('settings from before the access levels keep their choices by moving to "custom"', () => {
  const untouched = { tool_write_script: false, tool_start_script: true };
  migrateMcpAccessLevel(untouched);
  assert.equal(untouched.access_level, undefined, 'only defaults: the default level applies');

  const changed = { tool_write_script: true, tool_start_script: true };
  migrateMcpAccessLevel(changed);
  assert.equal(changed.access_level, 'custom');
  assert.ok(enabled(changed).includes('write_script'), 'the user keeps writing enabled');

  const onlySeparate = { tool_delete_script: true };
  migrateMcpAccessLevel(onlySeparate);
  assert.equal(onlySeparate.access_level, undefined, 'separate switches are independent of the level');

  const already = { access_level: 'read', tool_write_script: true };
  migrateMcpAccessLevel(already);
  assert.equal(already.access_level, 'read', 'an existing level is never overwritten');

  migrateMcpAccessLevel(undefined);
});
