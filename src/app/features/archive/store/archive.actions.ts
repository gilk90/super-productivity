import { createAction } from '@ngrx/store';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

/**
 * Non-persistent action dispatched after remote archive-affecting operations
 * have been applied to the store. This triggers UI refresh for worklog/archive views.
 *
 * This action breaks the circular dependency between OperationApplierService
 * and WorklogService by using NgRx instead of direct service injection.
 */
export const remoteArchiveDataApplied = createAction(
  '[Archive] Remote Archive Data Applied',
);

/**
 * Persistent action to flush data from archiveYoung to archiveOld.
 * This action is dispatched when the local client determines it's time to flush,
 * and is synced to other clients to ensure deterministic archive state.
 *
 * When received remotely, the receiving client executes the same flush logic,
 * ensuring both clients have consistent archiveOld content without needing
 * to sync the large archiveOld files directly.
 *
 * Prerequisites:
 * - Vector clock ordering ensures this action is applied AFTER all preceding
 *   moveToArchive operations that populated archiveYoung.
 */
export const flushYoungToOld = createAction(
  '[Archive] Flush Young to Old',
  (actionProps: { timestamp: number }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'ALL', // Affects multiple entity types (tasks, timeTracking)
      opType: OpType.Batch, // Bulk operation affecting multiple entities
    } satisfies PersistentActionMeta,
  }),
);

/**
 * Persistent action to compress archive data by:
 * 1. Deleting subtask entities and merging their time data to parent tasks
 * 2. Clearing notes from tasks older than 1 year
 * 3. Clearing non-essential issue fields (keeps issueId and issueType)
 *
 * The oneYearAgoTimestamp is passed explicitly so all clients compress the same
 * tasks deterministically, regardless of when they process the operation.
 */
export const compressArchive = createAction(
  '[Archive] Compress Archive',
  (actionProps: { timestamp: number; oneYearAgoTimestamp: number }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'ALL',
      opType: OpType.Batch,
    } satisfies PersistentActionMeta,
  }),
);

/**
 * Persistent action to permanently delete archived tasks.
 *
 * `taskIds` is the complete, pre-computed id list (roots plus every archived
 * descendant), so applying it is deterministic and needs no archive read on the
 * receiving client. The archive side effect is an id-keyed delete in both
 * partitions, so it is idempotent: replaying it, or deleting ids that are no
 * longer archived, is a no-op.
 *
 * It never touches NgRx task state. A concurrent `restoreTask` of the same task
 * therefore wins in either order: the restored live task stays, and the delete
 * only finds nothing left in the archive.
 *
 * `entityType: 'ALL'` (like compressArchive): the op names no entity, so it is
 * never part of an entity conflict.
 *
 * Known limits (accepted, see the PR):
 * - Released clients that predate this action apply it as an unknown action
 *   type: a no-op that is marked applied, so they keep the archived copy for
 *   good, even after updating. Their archive can reintroduce the task, e.g. in
 *   a file-based upload or a "use local" SYNC_IMPORT.
 * - A restore that is then archived again, concurrently with this delete,
 *   does not converge: clients that apply the delete last lose the task, the
 *   others keep it archived. The op names no entity, so no conflict is raised.
 */
export const deleteArchivedTasks = createAction(
  '[Archive] Delete Archived Tasks',
  (actionProps: { taskIds: string[] }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'ALL',
      opType: OpType.Batch,
    } satisfies PersistentActionMeta,
  }),
);
