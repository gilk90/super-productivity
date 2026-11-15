import { Task, TaskArchive } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';

/**
 * One row of the archive page: an archived task that is not the child of
 * another archived task, plus its archived subtasks.
 */
export interface ArchivedTaskRow {
  task: Task;
  subTasks: Task[];
  /** Completion time, falling back to creation time for tasks without one. */
  sortTime: number;
}

export interface ArchivedTaskFilter {
  /** Case-insensitive match on the title, notes, and subtask titles. */
  term?: string;
  projectId?: string | null;
  tagId?: string | null;
  /** Inclusive `YYYY-MM-DD` bounds on the completion day. */
  fromDay?: string | null;
  toDay?: string | null;
}

/** Display names used by the exports; ids without a name are exported as-is. */
export interface ArchivedTaskExportNames {
  projectTitles: Record<string, string>;
  tagTitles: Record<string, string>;
}

/**
 * The given ids plus every archived descendant (subtasks of subtasks
 * included). Ids that are not in the archive are skipped, and cycles in
 * corrupted data cannot loop.
 */
export const collectArchivedTaskTree = (
  entities: TaskArchive['entities'],
  rootIds: readonly string[],
): string[] => {
  const result = new Set<string>();
  const queue = [...rootIds];
  while (queue.length) {
    const id = queue.shift() as string;
    const task = entities[id];
    if (!task || result.has(id)) continue;
    result.add(id);
    queue.push(...(task.subTaskIds || []));
  }
  return [...result];
};

/**
 * Archived tasks as page rows, newest completion first. A subtask is listed on
 * its own only when its parent is not archived (an orphan); otherwise it is
 * part of its parent's row.
 */
export const buildArchivedTaskRows = (archive: TaskArchive): ArchivedTaskRow[] => {
  const { entities } = archive;
  const rows: ArchivedTaskRow[] = [];
  for (const id of archive.ids as string[]) {
    const task = entities[id];
    if (!task || (task.parentId && entities[task.parentId])) continue;
    const subTasks = (task.subTaskIds || [])
      .map((subId) => entities[subId])
      .filter((sub): sub is Task => !!sub);
    rows.push({ task, subTasks, sortTime: task.doneOn || task.created || 0 });
  }
  return rows.sort((a, b) => b.sortTime - a.sortTime);
};

/** Only a root task (no parent) can be restored; its subtasks come with it. */
export const isRestorableArchivedTask = (task: Task): boolean => !task.parentId;

const matchesTerm = (row: ArchivedTaskRow, term: string): boolean =>
  row.task.title.toLowerCase().includes(term) ||
  (row.task.notes || '').toLowerCase().includes(term) ||
  row.subTasks.some((sub) => sub.title.toLowerCase().includes(term));

export const filterArchivedTaskRows = (
  rows: readonly ArchivedTaskRow[],
  filter: ArchivedTaskFilter,
): ArchivedTaskRow[] => {
  const term = (filter.term || '').trim().toLowerCase();
  const { projectId, tagId, fromDay, toDay } = filter;
  return rows.filter((row) => {
    if (projectId && row.task.projectId !== projectId) return false;
    if (tagId && !(row.task.tagIds || []).includes(tagId)) return false;
    if (fromDay || toDay) {
      const day = getDbDateStr(row.sortTime);
      if (fromDay && day < fromDay) return false;
      if (toDay && day > toDay) return false;
    }
    return !term || matchesTerm(row, term);
  });
};

const CSV_HEADER = [
  'title',
  'project',
  'tags',
  'completed',
  'created',
  'time_spent_hours',
  'estimate_hours',
  'subtasks',
  'notes',
];

/**
 * Quotes a CSV field. A leading `=`, `+`, `-`, `@`, tab or carriage return is
 * prefixed with `'`, so a spreadsheet opening the file shows a task title such
 * as `=HYPERLINK(...)` as text instead of evaluating it as a formula.
 */
export const toCsvField = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

const toHours = (ms: number | undefined): string =>
  ms ? (ms / 3_600_000).toFixed(2) : '0.00';

const toDay = (time: number | undefined): string => (time ? getDbDateStr(time) : '');

const projectName = (task: Task, names: ArchivedTaskExportNames): string =>
  task.projectId ? (names.projectTitles[task.projectId] ?? task.projectId) : '';

const tagNames = (task: Task, names: ArchivedTaskExportNames): string[] =>
  (task.tagIds || []).map((id) => names.tagTitles[id] ?? id);

export const archivedTasksToCsv = (
  rows: readonly ArchivedTaskRow[],
  names: ArchivedTaskExportNames,
): string => {
  const lines = [CSV_HEADER.join(',')];
  for (const { task, subTasks } of rows) {
    lines.push(
      [
        task.title,
        projectName(task, names),
        tagNames(task, names).join('; '),
        toDay(task.doneOn),
        toDay(task.created),
        toHours(task.timeSpent),
        toHours(task.timeEstimate),
        subTasks.map((sub) => sub.title).join(' | '),
        task.notes || '',
      ]
        .map(toCsvField)
        .join(','),
    );
  }
  // CRLF per RFC 4180; spreadsheet apps read it on every platform.
  return lines.join('\r\n') + '\r\n';
};

/** Keeps a title on one Markdown list line. */
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** Markdown checklist grouped by completion day, newest day first. */
export const archivedTasksToMarkdown = (
  rows: readonly ArchivedTaskRow[],
  names: ArchivedTaskExportNames,
): string => {
  const out: string[] = [];
  let currentDay: string | null = null;
  for (const { task, subTasks, sortTime } of rows) {
    const day = getDbDateStr(sortTime);
    if (day !== currentDay) {
      if (currentDay !== null) out.push('');
      out.push(`## ${day}`, '');
      currentDay = day;
    }
    const meta = [
      projectName(task, names),
      ...tagNames(task, names).map((tag) => `#${tag}`),
      task.timeSpent ? msToString(task.timeSpent) : '',
    ].filter(Boolean);
    out.push(`- [x] ${oneLine(task.title)}${meta.length ? ` (${meta.join(', ')})` : ''}`);
    for (const sub of subTasks) {
      out.push(`  - [${sub.isDone ? 'x' : ' '}] ${oneLine(sub.title)}`);
    }
  }
  return out.length ? out.join('\n') + '\n' : '';
};
