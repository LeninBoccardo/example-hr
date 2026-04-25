import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { entities } from '@timeoff/persistence/entities';

export interface TestDataSourceHandle {
  dataSource: DataSource;
  dbFile: string;
  close: () => Promise<void>;
}

export async function createTestDataSource(): Promise<TestDataSourceHandle> {
  const dir = join(tmpdir(), 'timeoff-tests');
  mkdirSync(dir, { recursive: true });
  const dbFile = join(dir, `${randomUUID()}.sqlite`);
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: dbFile,
    entities,
    synchronize: true,
    logging: false,
  });
  await dataSource.initialize();
  return {
    dataSource,
    dbFile,
    close: async () => {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    },
  };
}
