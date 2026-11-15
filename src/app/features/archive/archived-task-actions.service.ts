import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskArchiveService } from './task-archive.service';
import { TaskService } from '../tasks/task.service';
import { Task } from '../tasks/task.model';
import { deleteArchivedTasks } from './store/archive.actions';
import {
  collectArchivedTaskTree,
  isRestorableArchivedTask,
} from './util/archived-task-list.util';
import { ArchiveOperationHandler } from '../../op-log/apply/archive-operation-handler.service';
import { Log } from '../../core/log';

/**
 * Restore and permanent delete for archived tasks, as synced operations.
 *
 * Both resolve only after the archive write has landed (the side effect runs
 * from a queue after the dispatch), so a caller that reloads the archive next
 * sees the result.
 */
@Injectable({ providedIn: 'root' })
export class ArchivedTaskActionsService {
  private readonly _store = inject(Store);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _taskService = inject(TaskService);
  private readonly _archiveOperationHandler = inject(ArchiveOperationHandler);

  /**
   * Permanently deletes the given archived tasks and all their archived
   * descendants, on this and every synced device. Returns how many tasks were
   * removed (0 when none of the ids is archived).
   */
  async deletePermanently(taskIds: readonly string[]): Promise<number> {
    const archive = await this._taskArchiveService.load();
    const idsToDelete = collectArchivedTaskTree(archive.entities, taskIds);
    if (idsToDelete.length === 0) {
      return 0;
    }
    this._store.dispatch(deleteArchivedTasks({ taskIds: idsToDelete }));
    await this._archiveOperationHandler.whenLocalOperationsSettled();
    Log.log('[ArchivedTaskActions] deleted permanently', {
      requested: taskIds.length,
      removed: idsToDelete.length,
    });
    return idsToDelete.length;
  }

  /**
   * Restores the given archived root tasks, each with its archived subtasks.
   * Subtasks whose parent is not restored are skipped (restoring one alone
   * would leave it pointing at a parent that is not active). Returns how many
   * root tasks were restored.
   */
  async restore(taskIds: readonly string[]): Promise<number> {
    const archive = await this._taskArchiveService.load();
    const restoredIds: string[] = [];
    for (const id of taskIds) {
      const task = archive.entities[id];
      if (!task || !isRestorableArchivedTask(task)) continue;
      const subTasks = (task.subTaskIds || [])
        .map((subId) => archive.entities[subId])
        .filter((sub): sub is Task => !!sub);
      this._taskService.restoreTask(task, subTasks);
      restoredIds.push(id);
    }
    if (restoredIds.length > 0) {
      await this._archiveOperationHandler.whenLocalOperationsSettled();
    }
    Log.log('[ArchivedTaskActions] restored', {
      requested: taskIds.length,
      restored: restoredIds.length,
    });
    return restoredIds.length;
  }
}
