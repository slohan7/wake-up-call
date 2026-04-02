import { DatabaseService } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { detectSampleData, purgeSampleData } from '../src/services/sample-data';

describe('sample data cleanup', () => {
  let db: DatabaseService;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('detects seeded sample data and removes it cleanly', () => {
    seedDatabase(db);

    const before = detectSampleData(db);
    expect(before.hasSampleData).toBe(true);
    expect(before.people).toBeGreaterThan(0);
    expect(before.tasks).toBeGreaterThan(0);
    expect(before.followUps).toBeGreaterThan(0);
    expect(before.meetings).toBeGreaterThan(0);

    const result = purgeSampleData(db);

    expect(result.deleted.people).toBe(4);
    expect(result.deleted.tasks).toBe(4);
    expect(result.deleted.followUps).toBe(3);
    expect(result.deleted.meetings).toBe(3);
    expect(result.remaining.hasSampleData).toBe(false);
    expect(result.remaining.people).toBe(0);
    expect(result.remaining.tasks).toBe(0);
    expect(result.remaining.followUps).toBe(0);
    expect(result.remaining.meetings).toBe(0);
  });
});
