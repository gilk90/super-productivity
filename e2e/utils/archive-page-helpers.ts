import { expect, type Locator, type Page } from '@playwright/test';

/** Helpers for the archive page (`/#/archive`). */

const ARCHIVE_PAGE = 'archive-page';

export const openArchivePage = async (page: Page): Promise<void> => {
  await page.goto('/#/archive');
  // Loaded once the loading text is gone (empty state, toolbar or list).
  await expect(page.locator(ARCHIVE_PAGE)).toBeVisible();
  await expect(
    page.locator(`${ARCHIVE_PAGE} .toolbar, ${ARCHIVE_PAGE} .empty-state`).first(),
  ).toBeVisible();
  await expect(
    page.locator(`${ARCHIVE_PAGE} .empty-state`).filter({ hasText: /Loading/ }),
  ).toHaveCount(0);
};

export const getArchiveRow = (page: Page, title: string): Locator =>
  page.locator(`${ARCHIVE_PAGE} li.task-row`).filter({ hasText: title });

export const deleteFromArchivePage = async (page: Page, title: string): Promise<void> => {
  await getArchiveRow(page, title)
    .locator('button')
    .filter({ has: page.locator('mat-icon', { hasText: 'delete_forever' }) })
    .click();
  const confirmDialog = page.locator('dialog-confirm');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog
    .locator('button')
    .filter({ hasText: /Delete permanently/i })
    .click();
  await expect(confirmDialog).toBeHidden();
  await expect(getArchiveRow(page, title)).toHaveCount(0);
};

export const restoreFromArchivePage = async (
  page: Page,
  title: string,
): Promise<void> => {
  await getArchiveRow(page, title)
    .locator('button')
    .filter({ has: page.locator('mat-icon', { hasText: 'unarchive' }) })
    .click();
  await expect(getArchiveRow(page, title)).toHaveCount(0);
};
