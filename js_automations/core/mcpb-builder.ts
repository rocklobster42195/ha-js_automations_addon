// core/mcpb-builder.ts
// Builds the one-click Claude Desktop extension (.mcpb): a zip with manifest.json and the
// stdio bridge (js_automations/mcpb/bridge.js). Format: https://github.com/modelcontextprotocol/mcpb
import * as fs from 'fs';
import { ZipArchive } from 'archiver';

export interface McpbOptions {
  /** Add-on version, used as the extension version (must be valid semver). */
  version: string;
  /** Endpoint the bridge connects to, prefilled in the install dialog. */
  url: string;
  /** Access token, prefilled in the install dialog. */
  token: string;
  /** Absolute path of bridge.js. */
  bridgePath: string;
  /** Absolute path of a PNG icon; skipped when the file does not exist. */
  iconPath?: string;
}

/** Beta add-on versions look like "3.0.3-beta.6"; the beta gets its own extension name so both can coexist. */
export const isBetaVersion = (version: string): boolean => /beta/i.test(version);

export function buildManifest(opts: { version: string; url: string; token: string; icon: boolean }) {
  const beta = isBetaVersion(opts.version);
  return {
    manifest_version: '0.3',
    name: beta ? 'js-automations-beta' : 'js-automations',
    display_name: beta ? 'JS Automations (Beta)' : 'JS Automations',
    version: opts.version,
    description: 'Lets Claude read, write and control your JS Automations scripts for Home Assistant.',
    long_description:
      'Connects Claude Desktop to the JS Automations add-on running in your Home Assistant. Claude can list and read ' +
      'scripts, check logs and errors, and — if you enable it in the add-on settings — write and restart scripts. ' +
      'You decide per tool what is allowed (Settings → MCP Server in the add-on). This file contains your access token: ' +
      'do not share it.',
    author: { name: 'JS Automations' },
    ...(opts.icon ? { icon: 'icon.png' } : {}),
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.js'],
        env: {
          JSA_MCP_URL: '${user_config.url}',
          JSA_MCP_TOKEN: '${user_config.token}',
          JSA_ALLOW_SELF_SIGNED: '${user_config.allow_self_signed}',
        },
      },
    },
    tools_generated: true,
    prompts_generated: true,
    user_config: {
      url: {
        type: 'string',
        title: 'MCP endpoint',
        description: 'Address of the JS Automations MCP server (shown in Settings → MCP Server).',
        required: true,
        default: opts.url,
      },
      token: {
        type: 'string',
        title: 'Access token',
        description: 'Access token from Settings → MCP Server in the add-on.',
        required: true,
        sensitive: true,
        default: opts.token,
      },
      allow_self_signed: {
        type: 'boolean',
        title: 'Accept self-signed certificate',
        description: 'Only needed when the endpoint uses HTTPS with a self-signed certificate.',
        required: false,
        default: false,
      },
    },
    compatibility: { platforms: ['darwin', 'win32'], runtimes: { node: '>=18.0.0' } },
  };
}

/** Packs the extension into an in-memory zip. */
export function buildMcpb(opts: McpbOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const hasIcon = !!opts.iconPath && fs.existsSync(opts.iconPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    const manifest = buildManifest({ version: opts.version, url: opts.url, token: opts.token, icon: hasIcon });
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(fs.readFileSync(opts.bridgePath), { name: 'server/index.js' });
    if (hasIcon) archive.append(fs.readFileSync(opts.iconPath as string), { name: 'icon.png' });
    void archive.finalize();
  });
}
