import { test, expect } from '../../fixtures/supersync.fixture';
import {
  archiveDoneTasks,
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  markTaskDone,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  expectNotInArchive,
  getArchiveYoungTasks,
  getLiveIds,
  getTaskIdByTitle,
} from '../../utils/audit-archive-helpers';
import {
  deleteFromArchivePage,
  getArchiveRow,
  openArchivePage,
  restoreFromArchivePage,
} from '../../utils/archive-page-helpers';

/**
 * Permanent delete from the archive page is the synced
 * `[Archive] Delete Archived Tasks` op (entityType ALL, archive side effect
 * only). These tests prove it reaches the other client, and that a concurrent
 * restore of the same task wins on both clients in either apply order.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-archive-permanent-delete.spec.ts
 */

/** Creates the tasks on A, archives them, and returns their ids. */
const createArchivedTasks = async (
  client: SimulatedE2EClient,
  titles: string[],
): Promise<string[]> => {
  for (const title of titles) {
    await client.workView.addTask(title);
    await waitForTask(client.page, title);
  }
  const ids: string[] = [];
  for (const title of titles) {
    ids.push(await getTaskIdByTitle(client.page, title));
    await markTaskDone(client, title);
  }
  await archiveDoneTasks(client);
  return ids;
};

const archivedIds = async (client: SimulatedE2EClient): Promise<string[]> =>
  ((await getArchiveYoungTasks(client.page)) ?? []).map((t) => t.id);

test.describe('@supersync Archive permanent delete', () => {
  test('a permanent delete on one client removes the task on the other', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const removeTitle = `ArchDel-remove-${testRunId}`;
      const keepTitle = `ArchDel-keep-${testRunId}`;

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      const [removeId, keepId] = await createArchivedTasks(clientA, [
        removeTitle,
        keepTitle,
      ]);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await expect
        .poll(() => archivedIds(clientB!), { message: 'B received both archived tasks' })
        .toEqual(expect.arrayContaining([removeId, keepId]));

      await openArchivePage(clientA.page);
      await deleteFromArchivePage(clientA.page, removeTitle);
      await clientA.sync.syncAndWait();

      await clientB.sync.syncAndWait();
      await expect
        .poll(() => archivedIds(clientB!), { message: 'B dropped the deleted task' })
        .not.toContain(removeId);
      await expectNotInArchive(clientB.page, [removeId], 'B after remote delete');
      expect(await archivedIds(clientB)).toContain(keepId);
      expect(await getLiveIds(clientB.page, [removeId])).toEqual([]);

      await openArchivePage(clientB.page);
      await expect(getArchiveRow(clientB.page, removeTitle)).toHaveCount(0);
      await expect(getArchiveRow(clientB.page, keepTitle)).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('a concurrent restore wins over a permanent delete on both clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const title = `ArchDel-race-${testRunId}`;

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      const [taskId] = await createArchivedTasks(clientA, [title]);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await expect.poll(() => archivedIds(clientB!)).toContain(taskId);

      // Concurrent, with no sync in between: A deletes, B restores.
      await openArchivePage(clientA.page);
      await deleteFromArchivePage(clientA.page, title);
      await openArchivePage(clientB.page);
      await restoreFromArchivePage(clientB.page, title);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      for (const client of [clientA, clientB]) {
        await expect
          .poll(() => getLiveIds(client.page, [taskId]), {
            message: `${client.clientName}: restored task is live`,
          })
          .toEqual([taskId]);
        await expectNotInArchive(client.page, [taskId], `${client.clientName} archive`);
      }
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
