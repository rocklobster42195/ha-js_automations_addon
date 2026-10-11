/**
 * JS AUTOMATIONS - Store Manager
 * Manages persistent global variables with usage tracking.
 *
 * Secrets (isSecret) are encrypted at rest with AES-256-GCM. In memory (`data`) they are held as
 * plaintext so the rest of the addon can keep reading `data[key].value`; encryption and
 * decryption happen only at the disk boundary (`save()` / `load()`).
 *
 * Access control: a secret carries a `sharedWith` list of script file names (or '*' for all
 * scripts). Scripts outside the list can neither read nor overwrite it. This guards against
 * accidents, it is not a sandbox boundary: all scripts run inside the same process.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

const ALGORITHM = 'aes-256-gcm';
const BLOB_VERSION = 1;
/** Suffix of the one-time plaintext copy made before the first encryption (rollback safety net). */
const PRE_ENCRYPTION_SUFFIX = '.pre-encryption';
/** The safety copy is removed on boot once it is older than this and every secret decrypts. */
const PRE_ENCRYPTION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Which scripts may access a secret: a list of script file names, or '*' for every script. */
type Sharing = string[] | '*';

interface EncryptedBlob {
  v: number;
  /** Fingerprint of the key that encrypted this blob (not secret, identifies the key only). */
  kid: string;
  iv: string;
  tag: string;
  data: string;
}

interface StoreEntry {
  /** Plaintext in memory. For locked entries this is null. */
  value: unknown;
  owner: string | undefined;
  isSecret: boolean;
  updated: string;
  accessed: string;
  /** Secrets only. */
  sharedWith?: Sharing;
  /** Runtime-only: the blob could not be decrypted (missing or different key). Never persisted. */
  locked?: boolean;
  /** Runtime-only: original blob of a locked entry, written back untouched so no data is lost. */
  raw?: EncryptedBlob;
}

/** Shape returned to the UI / socket clients: never contains the value of a secret. */
interface PublicStoreEntry {
  value: unknown;
  owner: string | undefined;
  isSecret: boolean;
  updated: string;
  accessed: string;
  sharedWith?: Sharing;
  locked?: boolean;
}

interface StoreSetOptions {
  /** Script file names that may access a secret ('*' = all). Ignored for non-secrets. */
  sharedWith?: Sharing;
  /**
   * File name of the script performing the write. Omit for administrative callers (UI, REPL),
   * which are not subject to the sharing list.
   */
  scriptId?: string;
}

function isBlob(v: unknown): v is EncryptedBlob {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.v === 'number' &&
    typeof b.kid === 'string' &&
    typeof b.iv === 'string' &&
    typeof b.tag === 'string' &&
    typeof b.data === 'string'
  );
}

/** Validates a user-supplied sharing value. Returns undefined when nothing was supplied. */
function normaliseSharing(input: unknown): Sharing | undefined {
  if (input === undefined || input === null) return undefined;
  if (input === '*') return '*';
  if (Array.isArray(input) && input.every((s) => typeof s === 'string' && s.length > 0)) {
    return [...new Set(input as string[])];
  }
  throw new TypeError('sharedWith must be "*" or an array of script file names');
}

class StoreManager extends EventEmitter {
  storeFile: string;
  keyFile: string;
  /**
   * False = rollback mode: secrets are written to store.json as plaintext in the pre-encryption
   * format so an older add-on version can read the file again.
   */
  encryption: boolean;
  data: Record<string, StoreEntry>;
  private key: Buffer | null = null;
  private keyId = '';

  /**
   * @param rootDir Directory holding store.json.
   * @param keyFile Location of the encryption key. Should live outside the scripts directory
   *   (the addon uses its private /data) so it never ends up in backups or git. Defaults to
   *   `store.key` next to store.json. The JSA_STORE_KEY environment variable overrides it.
   * @param opts.encryption Set to false to decrypt every secret back to plaintext on load and keep
   *   it that way (downgrade path before switching back to a version without encryption).
   */
  constructor(rootDir: string, keyFile?: string, opts: { encryption?: boolean } = {}) {
    super();
    this.storeFile = path.join(rootDir, 'store.json');
    this.keyFile = keyFile || path.join(rootDir, 'store.key');
    this.encryption = opts.encryption !== false;
    this.data = {};
    this.load();
  }

  // ---------------------------------------------------------------------------------------
  // Encryption
  // ---------------------------------------------------------------------------------------

  private setKey(key: Buffer): void {
    this.key = key;
    this.keyId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
  }

  /** Loads the key if one exists. Never creates one. */
  private loadKey(): Buffer | null {
    if (this.key) return this.key;

    const fromEnv = process.env.JSA_STORE_KEY;
    if (fromEnv) {
      this.setKey(crypto.createHash('sha256').update(fromEnv).digest());
      return this.key;
    }

    try {
      const hex = fs.readFileSync(this.keyFile, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        this.setKey(Buffer.from(hex, 'hex'));
        return this.key;
      }
      console.error(`❌ Store key file ${this.keyFile} is malformed (expected 64 hex characters).`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`❌ Cannot read store key file: ${(e as Error).message}`);
      }
    }
    return null;
  }

  /** Returns the key, generating and persisting a new one on first use. */
  private requireKey(): Buffer {
    const existing = this.loadKey();
    if (existing) return existing;

    const fresh = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
    // 'wx': never overwrite an existing (possibly unreadable) key file.
    fs.writeFileSync(this.keyFile, fresh.toString('hex'), { flag: 'wx', mode: 0o600 });
    this.setKey(fresh);
    console.log('🔑 Generated a new store encryption key.');
    return fresh;
  }

  private encrypt(entryKey: string, value: unknown): EncryptedBlob {
    const key = this.requireKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    // Binding the blob to its store key prevents swapping ciphertexts between entries.
    cipher.setAAD(Buffer.from(entryKey, 'utf8'));
    const data = Buffer.concat([cipher.update(JSON.stringify(value ?? null), 'utf8'), cipher.final()]);
    return {
      v: BLOB_VERSION,
      kid: this.keyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  }

  private decrypt(entryKey: string, blob: EncryptedBlob): unknown {
    const key = this.loadKey();
    if (!key) throw new Error('no encryption key available');
    if (blob.kid !== this.keyId) throw new Error('encrypted with a different key');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(blob.iv, 'base64'));
    decipher.setAAD(Buffer.from(entryKey, 'utf8'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  }

  // ---------------------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------------------

  load(): void {
    if (!fs.existsSync(this.storeFile)) return;

    let parsed: Record<string, Record<string, unknown>>;
    try {
      parsed = JSON.parse(fs.readFileSync(this.storeFile, 'utf8'));
    } catch (e) {
      console.error('❌ Failed to load store.json');
      this.data = {};
      return;
    }

    const data: Record<string, StoreEntry> = {};
    let migrated = false;
    let decryptedForRollback = false;
    let anyLocked = false;

    for (const [k, raw] of Object.entries(parsed)) {
      const entry = { ...raw } as unknown as StoreEntry & { encrypted?: boolean };
      delete entry.encrypted;

      if (entry.isSecret) {
        if (raw.encrypted === true && isBlob(raw.value)) {
          const blob = raw.value;
          try {
            entry.value = this.decrypt(k, blob);
            if (!this.encryption) decryptedForRollback = true;
          } catch (e) {
            console.error(`🔒 Store entry '${k}' could not be decrypted (${(e as Error).message}) - left locked.`);
            entry.value = null;
            entry.locked = true;
            entry.raw = blob;
            anyLocked = true;
          }
          if (entry.sharedWith === undefined) entry.sharedWith = [];
        } else {
          // Plaintext secret: either a legacy one or one written in rollback mode (which keeps
          // its sharing list). Legacy ones stay visible to every script so existing automations
          // keep working; the user can restrict them afterwards.
          if (this.encryption) migrated = true;
          const keep = raw.sharedWith;
          entry.sharedWith =
            keep === '*' || (Array.isArray(keep) && keep.every((s) => typeof s === 'string')) ? (keep as Sharing) : '*';
        }
      }
      data[k] = entry;
    }

    this.data = data;
    if (migrated) {
      try {
        this.backupBeforeEncryption();
        this.save();
        console.log('🔐 Migrated plaintext store secrets to encrypted storage.');
      } catch (e) {
        console.error(`❌ Failed to encrypt existing store secrets: ${(e as Error).message}`);
      }
    } else if (decryptedForRollback) {
      try {
        this.save();
        console.log('🔓 Encryption is disabled: store secrets were written back as plaintext.');
      } catch (e) {
        console.error(`❌ Failed to decrypt store secrets: ${(e as Error).message}`);
      }
    }
    if (!anyLocked) this.expirePreEncryptionBackup(decryptedForRollback);
  }

  /**
   * Switches encryption at runtime (in-app setting). Turning it on encrypts every secret on the
   * next write (done immediately) after saving the plaintext safety copy; turning it off writes
   * all secrets back as plaintext and drops the safety copy. Locked entries are left untouched.
   */
  setEncryption(enabled: boolean): void {
    if (this.encryption === enabled) return;
    this.encryption = enabled;
    try {
      if (enabled) {
        if (Object.values(this.data).some((e) => e.isSecret && !e.locked)) this.backupBeforeEncryption();
        this.save();
        console.log('🔐 Secret encryption enabled.');
      } else {
        this.save();
        if (!Object.values(this.data).some((e) => e.locked)) this.expirePreEncryptionBackup(true);
        console.log('🔓 Secret encryption disabled: store secrets were written back as plaintext.');
      }
    } catch (e) {
      console.error(`❌ Failed to switch secret encryption: ${(e as Error).message}`);
    }
  }

  private get preEncryptionFile(): string {
    return this.storeFile + PRE_ENCRYPTION_SUFFIX;
  }

  /**
   * Keeps a plaintext copy of store.json from before the first encryption so a failed rollout can
   * be undone by hand. Never overwritten: a later run would copy an already-encrypted file.
   */
  private backupBeforeEncryption(): void {
    if (fs.existsSync(this.preEncryptionFile)) return;
    fs.copyFileSync(this.storeFile, this.preEncryptionFile);
    try {
      fs.chmodSync(this.preEncryptionFile, 0o600);
    } catch {
      /* best effort (not supported on every platform) */
    }
    console.log(
      `💾 Saved a plaintext copy of the store to ${path.basename(this.preEncryptionFile)} (removed automatically after 14 days).`
    );
  }

  /**
   * The safety copy holds secrets in plaintext, so it must not linger. It is dropped right after
   * a successful rollback (secrets are plaintext again anyway) or once it is old enough.
   */
  private expirePreEncryptionBackup(rolledBack: boolean): void {
    const file = this.preEncryptionFile;
    try {
      if (!fs.existsSync(file)) return;
      const expired = Date.now() - fs.statSync(file).mtimeMs > PRE_ENCRYPTION_MAX_AGE_MS;
      if (rolledBack || (this.encryption && expired)) {
        fs.unlinkSync(file);
        console.log(`🧹 Removed ${path.basename(file)}.`);
      }
    } catch (e) {
      console.error(`❌ Could not clean up ${path.basename(file)}: ${(e as Error).message}`);
    }
  }

  save(): void {
    const out: Record<string, unknown> = {};
    for (const [k, e] of Object.entries(this.data)) {
      const base = { owner: e.owner, isSecret: e.isSecret, updated: e.updated, accessed: e.accessed };
      if (!e.isSecret) {
        out[k] = { ...base, value: e.value };
      } else if (e.locked && e.raw) {
        out[k] = { ...base, sharedWith: e.sharedWith, value: e.raw, encrypted: true };
      } else if (!this.encryption) {
        // Rollback mode: the pre-encryption format (older versions read `value` as-is).
        out[k] = { ...base, sharedWith: e.sharedWith, value: e.value };
      } else {
        out[k] = { ...base, sharedWith: e.sharedWith, value: this.encrypt(k, e.value), encrypted: true };
      }
    }
    // Atomic write: a crash mid-write must not leave a truncated store (and lose the secrets).
    const tmp = `${this.storeFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.storeFile);
  }

  // ---------------------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------------------

  /**
   * Whether the given script may read the key's value. Without a scriptId the caller is
   * administrative (UI/REPL) and may read everything that is not locked.
   */
  canRead(key: string, scriptId?: string): boolean {
    const entry = this.data[key];
    if (!entry) return false;
    if (!entry.isSecret) return true;
    if (entry.locked) return false;
    if (scriptId === undefined) return true;
    return entry.sharedWith === '*' || (Array.isArray(entry.sharedWith) && entry.sharedWith.includes(scriptId));
  }

  /** Whether the given script may overwrite or delete the key. Free keys are always writable. */
  canWrite(key: string, scriptId?: string): boolean {
    const entry = this.data[key];
    if (!entry || !entry.isSecret) return true;
    if (scriptId === undefined) return true; // administrative caller may also replace locked entries
    return this.canRead(key, scriptId);
  }

  /** All values a script may see - used to seed a worker and to resync it. */
  valuesFor(scriptId?: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(this.data)) {
      if (this.canRead(k, scriptId)) out[k] = this.data[k].value;
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------------------

  /**
   * Writes a value.
   *
   * `isSecret === undefined` keeps the existing flag, so `ha.store.set(key, v)` on an existing
   * secret does not silently downgrade it to plaintext. Pass `false` to do that deliberately.
   * Returns false when a script is not allowed to write the key (nothing is changed).
   */
  set(key: string, value: unknown, scriptName?: string, isSecret?: boolean, opts: StoreSetOptions = {}): boolean {
    const existing = this.data[key];
    const { scriptId } = opts;
    if (!this.canWrite(key, scriptId)) return false;

    const secret = isSecret === undefined ? existing?.isSecret === true : isSecret === true;
    const requested = secret ? normaliseSharing(opts.sharedWith) : undefined;
    const now = new Date().toISOString();

    const entry: StoreEntry = {
      value: secret && value === undefined ? null : value,
      // A secret keeps the owner it was created with; overwriting does not transfer it.
      owner: secret && existing?.isSecret ? existing.owner : scriptName,
      isSecret: secret,
      updated: now,
      accessed: now,
    };

    if (secret) {
      // Default for a new secret: only the script that created it.
      let sharedWith: Sharing | undefined = existing?.isSecret ? existing.sharedWith : undefined;
      if (requested === '*') sharedWith = '*';
      else if (requested) sharedWith = [...new Set([...requested, ...(scriptId ? [scriptId] : [])])];
      entry.sharedWith = sharedWith ?? (scriptId ? [scriptId] : []);
    }

    this.data[key] = entry;
    this.save();
    this.emit('changed', { key, item: this.publicEntry(entry) });
    return true;
  }

  get(key: string): unknown {
    if (this.data[key]) {
      this.data[key].accessed = new Date().toISOString();
      // We don't save immediately on read for performance reasons.
      // Data stays in RAM and save() is triggered on the next write operation.
      return this.data[key].value;
    }
    return null;
  }

  /** Internal view including plaintext secrets. Never hand this to an API response. */
  getAll(): Record<string, StoreEntry> {
    return this.data;
  }

  /** Safe view for the UI and socket clients: secret values are withheld. */
  getAllPublic(): Record<string, PublicStoreEntry> {
    const out: Record<string, PublicStoreEntry> = {};
    for (const [k, e] of Object.entries(this.data)) out[k] = this.publicEntry(e);
    return out;
  }

  /** Plaintext of a single entry for an explicit "reveal" in the UI. */
  reveal(key: string): { found: boolean; locked: boolean; value: unknown } {
    const entry = this.data[key];
    if (!entry) return { found: false, locked: false, value: null };
    return { found: true, locked: entry.locked === true, value: entry.value };
  }

  private publicEntry(e: StoreEntry): PublicStoreEntry {
    const pub: PublicStoreEntry = {
      value: e.isSecret ? null : e.value,
      owner: e.owner,
      isSecret: e.isSecret,
      updated: e.updated,
      accessed: e.accessed,
    };
    if (e.isSecret) pub.sharedWith = e.sharedWith ?? [];
    if (e.locked) pub.locked = true;
    return pub;
  }

  /** Deletes a key. A script may only delete secrets it has access to. */
  delete(key: string, scriptId?: string): boolean {
    if (!this.data[key]) return false;
    if (!this.canWrite(key, scriptId)) return false;
    delete this.data[key];
    this.save();
    this.emit('changed', { key, deleted: true });
    return true;
  }

  clear(): void {
    this.data = {};
    this.save();
    this.emit('changed', { cleared: true });
  }

  /**
   * Re-points secret sharing lists from a renamed script file to its new name, so a rename does
   * not silently cut the script off from its secrets. Returns the keys that were updated.
   */
  renameScript(oldId: string, newId: string): string[] {
    const touched: string[] = [];
    for (const [key, entry] of Object.entries(this.data)) {
      if (!entry.isSecret || !Array.isArray(entry.sharedWith) || !entry.sharedWith.includes(oldId)) continue;
      entry.sharedWith = [...new Set(entry.sharedWith.map((id) => (id === oldId ? newId : id)))];
      touched.push(key);
    }
    if (touched.length > 0) {
      this.save();
      for (const key of touched) this.emit('changed', { key, item: this.publicEntry(this.data[key]) });
    }
    return touched;
  }

  /**
   * Deletes all variables created by a specific script. Secrets are exempt: they may be shared
   * with other scripts and must not vanish because their creator was removed.
   */
  pruneByOwner(scriptName: string): number {
    let count = 0;
    for (const key in this.data) {
      if (this.data[key].owner === scriptName && !this.data[key].isSecret) {
        delete this.data[key];
        count++;
      }
    }
    if (count > 0) {
      this.save();
    }
    return count;
  }
}

export = StoreManager;
