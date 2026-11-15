import { Task, TaskArchive } from '../../tasks/task.model';
import {
  archivedTasksToCsv,
  archivedTasksToMarkdown,
  buildArchivedTaskRows,
  collectArchivedTaskTree,
  filterArchivedTaskRows,
  isRestorableArchivedTask,
  toCsvField,
} from './archived-task-list.util';

const DAY = 24 * 60 * 60 * 1000;
// Noon UTC keeps the local day stable in every test time zone.
const NOV_10 = Date.UTC(2026, 10, 10, 12);
const TWO_DAYS = 2 * DAY;
const NOV_12 = NOV_10 + TWO_DAYS;

const task = (id: string, partial: Partial<Task> = {}): Task =>
  ({
    id,
    title: `Task ${id}`,
    projectId: 'p1',
    subTaskIds: [],
    tagIds: [],
    timeSpent: 0,
    timeEstimate: 0,
    timeSpentOnDay: {},
    isDone: true,
    created: NOV_10 - DAY,
    doneOn: NOV_10,
    attachments: [],
    ...partial,
  }) as Task;

const archiveOf = (...tasks: Task[]): TaskArchive => ({
  ids: tasks.map((t) => t.id),
  entities: Object.fromEntries(tasks.map((t) => [t.id, t])),
});

const NAMES = {
  projectTitles: { p1: 'Work' },
  tagTitles: { t1: 'urgent' },
};

describe('archived-task-list.util', () => {
  describe('collectArchivedTaskTree', () => {
    it('collects nested descendants and skips unknown ids', () => {
      const archive = archiveOf(
        task('root', { subTaskIds: ['child'] }),
        task('child', { parentId: 'root', subTaskIds: ['grandchild'] }),
        task('grandchild', { parentId: 'child' }),
        task('other'),
      );
      expect(collectArchivedTaskTree(archive.entities, ['root', 'missing'])).toEqual([
        'root',
        'child',
        'grandchild',
      ]);
    });

    it('terminates on cyclic subtask references', () => {
      const archive = archiveOf(
        task('a', { subTaskIds: ['b'] }),
        task('b', { parentId: 'a', subTaskIds: ['a'] }),
      );
      expect(collectArchivedTaskTree(archive.entities, ['a'])).toEqual(['a', 'b']);
    });
  });

  describe('buildArchivedTaskRows', () => {
    it('lists roots with their subtasks, newest completion first', () => {
      const rows = buildArchivedTaskRows(
        archiveOf(
          task('old', { doneOn: NOV_10 }),
          task('new', { doneOn: NOV_12, subTaskIds: ['sub'] }),
          task('sub', { parentId: 'new' }),
        ),
      );
      expect(rows.map((row) => row.task.id)).toEqual(['new', 'old']);
      expect(rows[0].subTasks.map((sub) => sub.id)).toEqual(['sub']);
    });

    it('lists a subtask whose parent is not archived as its own row', () => {
      const rows = buildArchivedTaskRows(archiveOf(task('orphan', { parentId: 'gone' })));
      expect(rows.map((row) => row.task.id)).toEqual(['orphan']);
      expect(isRestorableArchivedTask(rows[0].task)).toBe(false);
    });

    it('falls back to the creation time when there is no completion time', () => {
      const rows = buildArchivedTaskRows(
        archiveOf(task('a', { doneOn: undefined, created: NOV_12 })),
      );
      expect(rows[0].sortTime).toBe(NOV_12);
    });
  });

  describe('filterArchivedTaskRows', () => {
    const rows = buildArchivedTaskRows(
      archiveOf(
        task('a', { title: 'Write report', projectId: 'p1', tagIds: ['t1'] }),
        task('b', {
          title: 'Call bank',
          projectId: 'p2',
          doneOn: NOV_12,
          notes: 'about the REPORT',
        }),
        task('c', { title: 'Plan', projectId: 'p2', subTaskIds: ['c1'] }),
        task('c1', { title: 'Book flights', parentId: 'c' }),
      ),
    );
    const ids = (filter: Parameters<typeof filterArchivedTaskRows>[1]): string[] =>
      filterArchivedTaskRows(rows, filter)
        .map((row) => row.task.id)
        .sort();

    it('matches the term in titles, notes and subtask titles, case-insensitively', () => {
      expect(ids({ term: 'report' })).toEqual(['a', 'b']);
      expect(ids({ term: 'FLIGHTS' })).toEqual(['c']);
      expect(ids({ term: '  ' })).toEqual(['a', 'b', 'c']);
    });

    it('filters by project and tag', () => {
      expect(ids({ projectId: 'p2' })).toEqual(['b', 'c']);
      expect(ids({ tagId: 't1' })).toEqual(['a']);
    });

    it('filters by an inclusive completion-day range', () => {
      expect(ids({ fromDay: '2026-11-12' })).toEqual(['b']);
      expect(ids({ toDay: '2026-11-10' })).toEqual(['a', 'c']);
      expect(ids({ fromDay: '2026-11-10', toDay: '2026-11-12' })).toEqual([
        'a',
        'b',
        'c',
      ]);
    });
  });

  describe('toCsvField', () => {
    it('quotes and escapes double quotes', () => {
      expect(toCsvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    });

    it('neutralises spreadsheet formulas', () => {
      expect(toCsvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
      expect(toCsvField('+1')).toBe('"\'+1"');
      expect(toCsvField('-1')).toBe('"\'-1"');
      expect(toCsvField('@cmd')).toBe('"\'@cmd"');
      expect(toCsvField('plain')).toBe('"plain"');
    });
  });

  describe('archivedTasksToCsv', () => {
    it('writes a header and one row per task with names, days and hours', () => {
      const rows = buildArchivedTaskRows(
        archiveOf(
          task('a', {
            title: 'Write report',
            tagIds: ['t1', 'unknown-tag'],
            timeSpent: 90 * 60 * 1000,
            timeEstimate: 2 * 60 * 60 * 1000,
            subTaskIds: ['s'],
            notes: 'line1\nline2',
          }),
          task('s', { title: 'Draft', parentId: 'a' }),
        ),
      );
      const [header, row, end] = archivedTasksToCsv(rows, NAMES).split('\r\n');
      expect(header).toBe(
        'title,project,tags,completed,created,time_spent_hours,estimate_hours,subtasks,notes',
      );
      expect(row).toBe(
        '"Write report","Work","urgent; unknown-tag","2026-11-10","2026-11-09",' +
          '"1.50","2.00","Draft","line1\nline2"',
      );
      expect(end).toBe('');
    });
  });

  describe('archivedTasksToMarkdown', () => {
    it('groups by completion day with subtasks and metadata', () => {
      const rows = buildArchivedTaskRows(
        archiveOf(
          task('a', {
            title: 'Write\nreport',
            tagIds: ['t1'],
            timeSpent: 60 * 60 * 1000,
            subTaskIds: ['s1', 's2'],
          }),
          task('s1', { title: 'Draft', parentId: 'a', isDone: true }),
          task('s2', { title: 'Review', parentId: 'a', isDone: false }),
          task('b', { title: 'Call bank', doneOn: NOV_12, projectId: '' }),
        ),
      );
      expect(archivedTasksToMarkdown(rows, NAMES).split('\n')).toEqual([
        '## 2026-11-12',
        '',
        '- [x] Call bank',
        '',
        '## 2026-11-10',
        '',
        '- [x] Write report (Work, #urgent, 1h)',
        '  - [x] Draft',
        '  - [ ] Review',
        '',
      ]);
    });

    it('returns an empty string for no rows', () => {
      expect(archivedTasksToMarkdown([], NAMES)).toBe('');
    });
  });
});
