import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, lstatSync, chmodSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Session, Run, Command, Event, Question, Invocation } from '../core/types.js';
import type { ImageResource } from '../core/resources.js';
import { SpokeError, fail } from '../core/errors.js';

const decode = <T>(value: unknown): T => {
  try { return JSON.parse(String(value)) as T; } catch { fail('STATE_CORRUPT', 'Stored record is not valid JSON'); }
};
export class Store {
  private readonly db: DatabaseSync;
  private readonly lock: string;
  private readonly token = randomUUID();
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) fail('UNSAFE_PATH');
    chmodSync(directory, 0o700);
    this.lock = join(directory, 'instance.lock');
    try { mkdirSync(this.lock, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Absence of the recorded process is conclusive; a live/reused PID or unreadable owner is not.
      let owner: { pid: number };
      try { owner = JSON.parse(readFileSync(join(this.lock, 'owner.json'), 'utf8')); } catch { fail('INSTANCE_IN_USE', 'Instance lock ownership needs operator inspection'); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) fail('INSTANCE_IN_USE');
      try { process.kill(owner.pid, 0); fail('INSTANCE_IN_USE'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      if (lstatSync(this.lock).isSymbolicLink()) fail('INSTANCE_IN_USE');
      unlinkSync(join(this.lock, 'owner.json')); rmdirSync(this.lock); mkdirSync(this.lock, { mode: 0o700 });
    }
    writeFileSync(join(this.lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: this.token }), { mode: 0o600, flag: 'wx' });
    try {
      const path = join(directory, 'state.sqlite');
      try { if (lstatSync(path).isSymbolicLink()) fail('UNSAFE_PATH'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      // Inspect an existing schema through a read-only handle before changing any database settings.
      try {
        lstatSync(path);
        const inspection = new DatabaseSync(path, { readOnly: true });
        try {
          if (Number(inspection.prepare('PRAGMA user_version').get()?.user_version) > 1) fail('STATE_CORRUPT', 'Database schema is newer than this runtime');
          if (inspection.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') fail('STATE_CORRUPT');
        }
        finally { inspection.close(); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      this.db = new DatabaseSync(path); chmodSync(path, 0o600);
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 1) { this.db.close(); fail('STATE_CORRUPT', 'Database schema is newer than this runtime'); }
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      if (version === 0 && Number(this.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get()?.count) !== 0) {
        this.db.close(); fail('STATE_CORRUPT', 'Unrecognized unversioned database');
      }
      if (version === 0) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE runs(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), state TEXT NOT NULL, data TEXT NOT NULL);
        CREATE UNIQUE INDEX one_active_run ON runs(session_id) WHERE state IN ('starting','running','waiting_input','stopping');
        CREATE TABLE commands(key TEXT PRIMARY KEY, operation TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), source TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(run_id,source));
        CREATE TABLE questions(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), tool_call_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(run_id,tool_call_id));
        CREATE TABLE tool_invocations(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), tool_call_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(run_id,tool_call_id));
        PRAGMA user_version=1; COMMIT;`);
      for (const path of [directory, dirname(directory)]) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
    } catch (error) { this.releaseLock(); throw error; }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); if (error instanceof SpokeError) throw error; throw new SpokeError('STATE_WRITE_FAILED', 'Durable transaction failed'); }
  }
  getSession(id: string): Session | undefined { const row = this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id); return row ? decode<Session>(row.data) : undefined; }
  putSession(value: Session): void { this.db.prepare('INSERT INTO sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(value.id, JSON.stringify(value)); }
  sessions(): Session[] { return this.db.prepare('SELECT data FROM sessions ORDER BY id').all().map(row => decode<Session>(row.data)); }
  getRun(id: string): Run | undefined { const row = this.db.prepare('SELECT data FROM runs WHERE id=?').get(id); return row ? decode<Run>(row.data) : undefined; }
  putRun(value: Run): void { this.db.prepare('INSERT INTO runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data').run(value.id, value.sessionId, value.state, JSON.stringify(value)); }
  runs(): Run[] { return this.db.prepare('SELECT data FROM runs ORDER BY id').all().map(row => decode<Run>(row.data)); }
  activeCount(): number { return Number(this.db.prepare("SELECT COUNT(*) AS count FROM runs WHERE state IN ('starting','running','waiting_input','stopping')").get()?.count); }
  getCommand(key: string): Command | undefined { const row = this.db.prepare('SELECT data FROM commands WHERE key=?').get(key); return row ? decode<Command>(row.data) : undefined; }
  putCommand(value: Command): void { this.db.prepare('INSERT INTO commands VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(value.key, value.operation, value.hash, JSON.stringify(value)); }
  commands(): Command[] { return this.db.prepare('SELECT data FROM commands').all().map(row => decode<Command>(row.data)); }
  event(runId: string, type: string, payload: unknown, source: string = randomUUID()): number {
    this.db.prepare('INSERT INTO events(run_id,source,type,payload,created) VALUES(?,?,?,?,?) ON CONFLICT(run_id,source) DO NOTHING').run(runId, source, type, JSON.stringify(payload), Date.now());
    return Number(this.db.prepare('SELECT seq FROM events WHERE run_id=? AND source=?').get(runId, source)?.seq);
  }
  events(runId: string, after = 0, limit = 100): Event[] { return this.db.prepare('SELECT * FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?').all(runId, after, limit).map(row => ({ seq: Number(row.seq), runId: String(row.run_id), type: String(row.type), payload: decode(row.payload), created: Number(row.created), source: String(row.source) })); }
  question(id: string): Question | undefined { const row = this.db.prepare('SELECT data FROM questions WHERE id=?').get(id); return row ? decode<Question>(row.data) : undefined; }
  questions(runId: string): Question[] { return this.db.prepare('SELECT data FROM questions WHERE run_id=?').all(runId).map(row => decode<Question>(row.data)); }
  putQuestion(value: Question): void { this.db.prepare('INSERT INTO questions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(value.id, value.runId, value.toolCallId, JSON.stringify(value)); }
  invocations(runId: string): Invocation[] { return this.db.prepare('SELECT data FROM tool_invocations WHERE run_id=?').all(runId).map(row => decode<Invocation>(row.data)); }
  putInvocation(value: Invocation): void { this.db.prepare('INSERT INTO tool_invocations VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(value.id, value.runId, value.toolCallId, JSON.stringify(value)); }
  writeArtifact(runId: string, name: 'output.txt' | 'manifest.json', contents: string): string {
    if (!/^run_[a-f0-9-]+$/.test(runId)) fail('INTERNAL_ERROR');
    const path = join(this.directory, 'runs', runId, name); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = path + '.' + randomUUID(); const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path); const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
    return path;
  }
  copyInputs(runId: string, images: ImageResource[]): ImageResource[] {
    if (!/^run_[a-f0-9-]+$/.test(runId)) fail('INTERNAL_ERROR');
    const copied = new Set<string>();
    return images.map(image => {
      if (!/^[a-f0-9]{64}$/.test(image.hash)) fail('STATE_CORRUPT');
      const dir = join(this.directory, 'runs', runId, 'input'); mkdirSync(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, image.hash); if (copied.has(image.hash)) return { ...image, path }; copied.add(image.hash);
      const fd = openSync(path, 'wx', 0o600);
      try { writeFileSync(fd, readFileSync(image.path)); fsyncSync(fd); } finally { closeSync(fd); }
      const parent = openSync(dir, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
      return { ...image, path };
    });
  }
  prune(runId: string): void {
    const run = this.getRun(runId); if (!run || !['completed','failed','cancelled','interrupted'].includes(run.state)) fail('RUN_NOT_ACTIVE');
    // Tombstones and session/run identity survive payload retention. File removal is a separate operator operation.
    this.db.prepare('DELETE FROM events WHERE run_id=?').run(runId);
    this.putRun({ ...run, effective: null, outputPath: null });
  }
  private releaseLock(): void {
    const owner = JSON.parse(readFileSync(join(this.lock, 'owner.json'), 'utf8'));
    if (owner.token !== this.token) fail('INSTANCE_IN_USE', 'Lock ownership changed');
    unlinkSync(join(this.lock, 'owner.json')); rmdirSync(this.lock);
  }
  close(): void { this.db.close(); this.releaseLock(); }
}
