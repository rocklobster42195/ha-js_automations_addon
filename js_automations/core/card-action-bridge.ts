// core/card-action-bridge.ts
//
// Card actions for Home Assistant users without admin rights.
//
// Cards normally talk to their script over the HA event bus (fire_event `jsa_action`, answer
// `jsa_action_result`). Home Assistant allows firing events and listening to custom events only for
// admins, so on a wall tablet signed in as a normal user every `__jsa__.callAction()` fails. Normal
// users may call entity services and see state changes, so this bridge offers a second way in:
//
//   card --text.set_value--> text entity "JSA Card Action"  --MQTT--> this bridge --> script action
//   card <--state_changed--  sensor "JSA Card Action Result" <--MQTT-- this bridge <-- result
//
// A text value holds at most 255 characters; longer messages arrive in base64 pieces. The sensor keeps
// the last answers in its attributes, so an answer is not lost when the frontend merges fast updates.

export const CARD_ACTION_COMMAND_TOPIC = 'jsa/system/card_action/set';
const CARD_ACTION_ATTR_TOPIC = 'jsa/system/card_action/attributes';
const RESULT_STATE_TOPIC = 'jsa/system/card_action_result/state';
const RESULT_ATTR_TOPIC = 'jsa/system/card_action_result/attributes';
const TEXT_UNIQUE_ID = 'jsa_system_card_action';
const RESULT_UNIQUE_ID = 'jsa_system_card_action_result';

export const MAX_ANSWERS = 20;
export const MAX_ANSWER_BYTES = 12000;
const CHUNK_TTL_MS = 30000;
const SEEN_TTL_MS = 30000;

export interface CardAnswer {
  c: string;
  ok: boolean;
  r?: unknown;
  e?: string;
  t: number;
}

interface PendingChunks {
  n: number;
  parts: string[];
  at: number;
}

interface MqttLike {
  publish(topic: string, payload: unknown, options?: { retain?: boolean }): void;
}

export interface CardActionBridgeDeps {
  mqtt: MqttLike;
  /** Whether card actions for non-admin users are switched on (settings). */
  enabled: () => boolean;
  /** Runs an action of a running script; `script` is the file name without extension. */
  callAction: (script: string, action: string, payload: unknown) => Promise<unknown>;
  /** Writes a card runtime error into the script log. */
  logCardError: (script: string, message: string, line?: number) => void;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
  /** Hides the two helper entities right after HA created them (optional). */
  hideEntities?: (uniqueIds: string[]) => void;
  now?: () => number;
}

/**
 * Assembles a card message: either a whole JSON message or base64 pieces `{c,i,n,d}`.
 * Returns the parsed message once complete, otherwise null.
 */
export class ChunkAssembler {
  private pending = new Map<string, PendingChunks>();

  constructor(private now: () => number = Date.now) {}

  add(raw: string): Record<string, unknown> | null {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!msg || typeof msg !== 'object') return null;
    if (typeof msg.d !== 'string' || typeof msg.n !== 'number' || typeof msg.i !== 'number') return msg;

    this.sweep();
    const id = String(msg.c ?? '');
    const n = Math.floor(msg.n);
    if (!id || n < 1 || n > 500 || msg.i < 0 || msg.i >= n) return null;
    let entry = this.pending.get(id);
    if (!entry || entry.n !== n) {
      entry = { n, parts: new Array(n), at: this.now() };
      this.pending.set(id, entry);
    }
    entry.parts[msg.i] = msg.d;
    for (let i = 0; i < n; i++) if (entry.parts[i] === undefined) return null;
    this.pending.delete(id);
    try {
      return JSON.parse(Buffer.from(entry.parts.join(''), 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  get size(): number {
    return this.pending.size;
  }

  private sweep(): void {
    const limit = this.now() - CHUNK_TTL_MS;
    for (const [id, e] of this.pending) if (e.at < limit) this.pending.delete(id);
  }
}

/** Keeps the newest answers, dropping the oldest beyond `max`. */
export function pushAnswer(list: CardAnswer[], answer: CardAnswer, max = MAX_ANSWERS): CardAnswer[] {
  const next = [...list.filter((a) => a.c !== answer.c), answer];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Replaces a result that is too large for an HA attribute with an error answer. */
export function limitAnswer(answer: CardAnswer, maxBytes = MAX_ANSWER_BYTES): CardAnswer {
  if (!answer.ok) return answer;
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(answer.r ?? null), 'utf8');
  } catch {
    return { c: answer.c, ok: false, e: 'Answer cannot be serialized', t: answer.t };
  }
  if (size <= maxBytes) return answer;
  return { c: answer.c, ok: false, e: `Answer too large (${size} bytes, max ${maxBytes})`, t: answer.t };
}

export class CardActionBridge {
  private assembler: ChunkAssembler;
  private answers: CardAnswer[] = [];
  private seen = new Map<string, number>();
  private published = false;
  private readonly now: () => number;

  constructor(private deps: CardActionBridgeDeps) {
    this.now = deps.now ?? Date.now;
    this.assembler = new ChunkAssembler(this.now);
  }

  /** Publishes (or removes, when switched off) the discovery of the two helper entities. */
  publishDiscovery(): void {
    const textTopic = `homeassistant/text/${TEXT_UNIQUE_ID}/config`;
    const sensorTopic = `homeassistant/sensor/${RESULT_UNIQUE_ID}/config`;
    if (!this.deps.enabled()) {
      this.deps.mqtt.publish(textTopic, null, { retain: true });
      this.deps.mqtt.publish(sensorTopic, null, { retain: true });
      this.published = false;
      return;
    }
    this.deps.mqtt.publish(
      textTopic,
      {
        name: 'JSA Card Action',
        unique_id: TEXT_UNIQUE_ID,
        // No device block: with one, HA names the entity "js_automations_…", which the orphan cleanup
        // treats as a relic of the old integration and deletes.
        default_entity_id: 'text.jsa_card_action',
        object_id: 'jsa_card_action',
        command_topic: CARD_ACTION_COMMAND_TOPIC,
        json_attributes_topic: CARD_ACTION_ATTR_TOPIC,
        max: 255,
        mode: 'text',
        icon: 'mdi:card-text-outline',
        entity_category: 'config',
        availability_topic: 'jsa/status',
      },
      { retain: true }
    );
    this.deps.mqtt.publish(
      sensorTopic,
      {
        name: 'JSA Card Action Result',
        unique_id: RESULT_UNIQUE_ID,
        default_entity_id: 'sensor.jsa_card_action_result',
        object_id: 'jsa_card_action_result',
        state_topic: RESULT_STATE_TOPIC,
        json_attributes_topic: RESULT_ATTR_TOPIC,
        icon: 'mdi:card-bulleted-outline',
        entity_category: 'diagnostic',
        availability_topic: 'jsa/status',
      },
      { retain: true }
    );
    // The card finds both entities by this marker, whatever their entity ids became
    this.deps.mqtt.publish(CARD_ACTION_ATTR_TOPIC, { jsa_role: 'card_action' }, { retain: true });
    this.publishAnswers();
    if (!this.published) this.deps.hideEntities?.([TEXT_UNIQUE_ID, RESULT_UNIQUE_ID]);
    this.published = true;
  }

  /** Handles one value written to the text entity. */
  async handleCommand(raw: string): Promise<void> {
    const msg = this.assembler.add(raw);
    if (!msg) return;

    if (msg.k === 'err') {
      if (typeof msg.s === 'string' && typeof msg.m === 'string') {
        this.deps.logCardError(msg.s, msg.m, typeof msg.l === 'number' ? msg.l : undefined);
      }
      return;
    }

    const c = typeof msg.c === 'string' ? msg.c : '';
    const script = typeof msg.s === 'string' ? msg.s : '';
    const action = typeof msg.a === 'string' ? msg.a : '';
    if (!c || !script || !action) return;
    if (this.isDuplicate(c)) return;

    if (!this.deps.enabled()) {
      this.answer({ c, ok: false, e: 'Card actions for non-admin users are switched off in the JSA settings', t: 0 });
      return;
    }
    const filename = script.replace(/\.(js|ts)$/, '');
    try {
      const result = await this.deps.callAction(filename, action, msg.p ?? {});
      this.answer({ c, ok: true, r: result ?? null, t: 0 });
    } catch (err) {
      this.answer({ c, ok: false, e: (err as Error)?.message || String(err), t: 0 });
    }
  }

  /** Answers kept for the card (newest last). */
  get currentAnswers(): CardAnswer[] {
    return this.answers;
  }

  private answer(a: CardAnswer): void {
    this.answers = pushAnswer(this.answers, limitAnswer({ ...a, t: this.now() }));
    this.publishAnswers();
  }

  private publishAnswers(): void {
    const last = this.answers[this.answers.length - 1];
    // Retained: HA subscribes after the discovery and must still see the marker the card looks for
    this.deps.mqtt.publish(RESULT_ATTR_TOPIC, { jsa_role: 'card_action_result', answers: this.answers }, { retain: true });
    this.deps.mqtt.publish(RESULT_STATE_TOPIC, last ? last.c : 'idle', { retain: true });
  }

  private isDuplicate(c: string): boolean {
    const t = this.now();
    for (const [id, at] of this.seen) if (t - at > SEEN_TTL_MS) this.seen.delete(id);
    if (this.seen.has(c)) return true;
    this.seen.set(c, t);
    return false;
  }
}
