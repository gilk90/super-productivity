import { readFileSync } from 'fs';
import { expect, test } from '../../fixtures/test.fixture';
import {
  deleteFromArchivePage,
  getArchiveRow,
  openArchivePage,
  restoreFromArchivePage,
} from '../../utils/archive-page-helpers';

const FINISH_DAY_BTN = '.e2e-finish-day';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))';

test.describe('Archive page', () => {
  test('searches, restores and permanently deletes archived tasks', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const keep = `${testPrefix}-Keep report`;
    const restore = `${testPrefix}-Restore call`;
    const remove = `${testPrefix}-Remove draft`;

    await workViewPage.waitForTaskList();
    for (const title of [keep, restore, remove]) {
      await workViewPage.addTask(title);
    }
    for (const title of [keep, restore, remove]) {
      await taskPage.markTaskAsDone(taskPage.getTaskByText(title));
    }

    // Finish the day: done tasks move to the archive.
    await page.locator(FINISH_DAY_BTN).click();
    await page.waitForURL(/daily-summary/);
    await page.locator(SAVE_AND_GO_HOME_BTN).click();
    // The daily summary URL also contains tag/TODAY, so wait for the summary
    // to leave and the work view to be back before navigating away.
    await expect(page.locator('daily-summary')).toHaveCount(0);
    await workViewPage.waitForTaskList();

    await openArchivePage(page);
    for (const title of [keep, restore, remove]) {
      await expect(getArchiveRow(page, title)).toBeVisible();
    }

    // Export writes the archived tasks as CSV.
    await page.locator('archive-page button').filter({ hasText: 'Export' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button[mat-menu-item]').filter({ hasText: 'CSV' }).click();
    const csvDownload = await downloadPromise;
    expect(csvDownload.suggestedFilename()).toMatch(
      /^super-productivity-archive-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const csv = readFileSync((await csvDownload.path())!, 'utf8');
    expect(csv.split('\r\n')[0]).toContain('title,project,tags');
    for (const title of [keep, restore, remove]) {
      expect(csv).toContain(`"${title}"`);
    }

    // Search narrows the list.
    await page.locator('archive-page .filter-search input').fill('report');
    await expect(getArchiveRow(page, keep)).toBeVisible();
    await expect(getArchiveRow(page, restore)).toHaveCount(0);
    await page.locator('archive-page .filter-search input').fill('');

    await restoreFromArchivePage(page, restore);
    await deleteFromArchivePage(page, remove);
    await expect(getArchiveRow(page, keep)).toBeVisible();

    // The restored task is active again in its original project (the Inbox);
    // the deleted one is gone everywhere.
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await expect(taskPage.getTaskByText(restore)).toBeVisible();

    await openArchivePage(page);
    await expect(getArchiveRow(page, remove)).toHaveCount(0);
    await expect(getArchiveRow(page, restore)).toHaveCount(0);
    await expect(getArchiveRow(page, keep)).toBeVisible();
  });
});
