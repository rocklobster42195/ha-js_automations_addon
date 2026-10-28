"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFeedbackTool = registerFeedbackTool;
// core/mcp-tools-feedback.ts
// The `jsa_feedback` tool — only offered in maintainer mode (see MCP_TOOL_CATALOG `maintainerOnly`).
const zod_1 = require("zod");
const mcp_feedback_store_1 = require("./mcp-feedback-store");
const KINDS = ['bug', 'api', 'feature', 'docs', 'other'];
const EXISTING_LIMIT = 15;
function registerFeedbackTool(protocol, deps) {
    const { store } = deps;
    protocol.registerTool({
        name: 'jsa_feedback',
        title: 'Note feedback about JSA',
        description: "Records an observation about JS Automations itself (not about the user's scripts): an API that is awkward or could be " +
            'simpler, a missing feature, wrong or unclear documentation, surprising behavior, or a bug. Call it silently while you ' +
            'work; do not tell the user about a note unless the result says so. Write notes so they could become a GitHub issue, and ' +
            'name the file or function if you can see the source. If the same issue is already listed in a previous result, pass ' +
            'its id as same_as instead of creating a new note. Use severity "hard_error" only for real failures that are JSA\'s fault: ' +
            'crashes, data loss, wrong results, tools that fail although they are used correctly.',
        inputSchema: {
            kind: zod_1.z.enum(KINDS).describe('bug | api (awkward/complex API) | feature (missing) | docs | other'),
            title: zod_1.z.string().min(3).max(120).describe('One line, specific'),
            detail: zod_1.z
                .string()
                .max(1500)
                .optional()
                .describe('What happened or what would be better; include a short example'),
            severity: zod_1.z.enum(['normal', 'hard_error']).optional().describe('Default "normal"'),
            same_as: zod_1.z.string().optional().describe('Id of an existing note this repeats'),
        },
        handler: (args) => {
            const { note, created, mention } = store.add({
                kind: args.kind,
                title: String(args.title ?? ''),
                detail: typeof args.detail === 'string' ? args.detail : undefined,
                severity: args.severity === 'hard_error' ? 'hard_error' : 'normal',
                sameAs: typeof args.same_as === 'string' ? args.same_as : undefined,
            });
            const lines = [created ? `Noted (${note.id}).` : `Noted again (${note.id}, now ${note.count}×).`];
            if (mention === 'now') {
                lines.push('HARD ERROR. Tell the user about it right away, in your next reply and in plain words: what failed and what you were ' +
                    'doing. Do not wait until the end of the task. Then carry on.');
            }
            else if (mention === 'later') {
                lines.push(`This has now come up ${note.count} times. Mention it to the user ONCE, briefly, at a natural pause or the end of ` +
                    'your current task, as a suggestion for JSA ("I noticed …"). Do not bring it up again.');
            }
            else {
                lines.push(`Do not mention this to the user (a suggestion is raised after ${mcp_feedback_store_1.MENTION_THRESHOLD} repeats; hard errors immediately).`);
            }
            const others = store
                .list()
                .filter((n) => n.id !== note.id)
                .slice(0, EXISTING_LIMIT);
            if (others.length) {
                lines.push('Existing notes (reuse an id with same_as if yours is the same issue):');
                for (const n of others)
                    lines.push(`${n.id} | ${n.kind} | ${n.count}× | ${n.title}`);
            }
            return { content: lines.join('\n') };
        },
    });
}
