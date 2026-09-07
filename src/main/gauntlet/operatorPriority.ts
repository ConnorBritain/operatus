import type Database from 'better-sqlite3';
import type { OperatorPriority } from '../../shared/gauntlet';

/** Human attention annotation with its own revision. Does not touch run version,
 * contracts, acknowledgments, launch ownership or dispatch reservations. */
export class OperatorPriorityStore {
  constructor(private readonly database: () => Database.Database) {}

  current(runId: string): OperatorPriority | undefined {
    return this.database().prepare('SELECT revision,level,note,at FROM gauntlet_operator_priorities WHERE run_id=? ORDER BY revision DESC LIMIT 1')
      .get(runId) as OperatorPriority | undefined;
  }

  history(runId: string): OperatorPriority[] {
    return this.database().prepare('SELECT revision,level,note,at FROM gauntlet_operator_priorities WHERE run_id=? ORDER BY revision')
      .all(runId) as OperatorPriority[];
  }

  set(runId: string, expectedRevision: number, level: OperatorPriority['level'], note: string): void {
    if (typeof runId !== 'string' || !runId || runId.length > 100 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !['low','normal','high'].includes(level) || typeof note !== 'string' || !note.trim() || note.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) throw Error('Invalid attention priority');
    const db = this.database();
    db.transaction(()=>{
      if (!db.prepare('SELECT 1 FROM gauntlet_runs WHERE id=?').get(runId)) throw Error('Unknown run');
      if ((this.current(runId)?.revision ?? 0) !== expectedRevision) throw Error('Attention priority changed; reload before saving');
      db.prepare('INSERT INTO gauntlet_operator_priorities(run_id,level,note,at) VALUES(?,?,?,?)')
        .run(runId,level,note.trim(),Date.now());
    })();
  }
}

export function desktopPriority(services: {
  localWindow(): {mainFrame:unknown}|null;
  set(runId:string,revision:number,level:OperatorPriority['level'],note:string): unknown;
}) {
  return (event:{sender:unknown;senderFrame:unknown},runId:unknown,revision:unknown,level:unknown,note:unknown): unknown => {
    const local = services.localWindow();
    if (!local || event.sender !== local || event.senderFrame !== local.mainFrame) throw Error('Attention priority requires the local desktop');
    if (typeof runId !== 'string' || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 ||
      !['low','normal','high'].includes(level as string) || typeof note !== 'string') throw Error('Invalid attention priority');
    return services.set(runId,revision,level as OperatorPriority['level'],note);
  };
}

export const OPERATOR_PRIORITY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS gauntlet_operator_priorities (
    revision INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id),
    level TEXT NOT NULL CHECK(level IN ('low','normal','high')),
    note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 2000),
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS gauntlet_operator_priorities_run ON gauntlet_operator_priorities(run_id,revision);
  CREATE TRIGGER IF NOT EXISTS gauntlet_operator_priorities_no_update BEFORE UPDATE ON gauntlet_operator_priorities
    BEGIN SELECT RAISE(ABORT,'attention priority history is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS gauntlet_operator_priorities_no_delete BEFORE DELETE ON gauntlet_operator_priorities
    BEGIN SELECT RAISE(ABORT,'attention priority history is immutable'); END;
`;
