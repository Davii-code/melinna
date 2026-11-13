import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeDatabaseClient } from '../../../src/adapters/node-database-client';

describe('read-only IDE SQLite', () => {
  it('queries a real database and refuses writes and attachments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'melinna-ide-'));
    const file = join(dir, 'db.sqlite');
    const seed = new DatabaseSync(file);
    seed.exec(
      "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items(name) VALUES ('first');",
    );
    seed.close();
    const client = new NodeDatabaseClient(async (path) => {
      if (path !== file) throw new Error('outside');
      return file;
    });
    try {
      const id = await client.open(file);
      expect(await client.query(id, 'SELECT name FROM items')).toEqual({
        columns: ['name'],
        rows: [['first']],
        truncated: false,
      });
      await expect(client.query(id, 'DELETE FROM items')).rejects.toThrow();
      await expect(client.query(id, "ATTACH ':memory:' AS other")).rejects.toThrow();
      await expect(client.query(id, "SELECT load_extension('other')")).rejects.toThrow();
      expect((await client.query(id, 'SELECT count(*) AS total FROM items')).rows).toEqual([['1']]);
      client.close(id);
      await expect(client.query(id, 'SELECT 1')).rejects.toThrow();
      await expect(client.open(join(dir, 'other.sqlite'))).rejects.toThrow();
    } finally {
      client.closeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
