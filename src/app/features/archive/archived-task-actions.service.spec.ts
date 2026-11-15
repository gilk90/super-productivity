import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { ArchivedTaskActionsService } from './archived-task-actions.service';
import { TaskArchiveService } from './task-archive.service';
import { TaskService } from '../tasks/task.service';
import { ArchiveOperationHandler } from '../../op-log/apply/archive-operation-handler.service';
import { Task, TaskArchive } from '../tasks/task.model';
import { deleteArchivedTasks } from './store/archive.actions';

const task = (id: string, partial: Partial<Task> = {}): Task =>
  ({ id, title: id, subTaskIds: [], tagIds: [], projectId: 'p1', ...partial }) as Task;

const archiveOf = (...tasks: Task[]): TaskArchive => ({
  ids: tasks.map((t) => t.id),
  entities: Object.fromEntries(tasks.map((t) => [t.id, t])),
});

describe('ArchivedTaskActionsService', () => {
  let service: ArchivedTaskActionsService;
  let store: MockStore;
  let taskArchiveService: jasmine.SpyObj<TaskArchiveService>;
  let taskService: jasmine.SpyObj<TaskService>;
  let archiveHandler: jasmine.SpyObj<ArchiveOperationHandler>;

  beforeEach(() => {
    taskArchiveService = jasmine.createSpyObj('TaskArchiveService', ['load']);
    taskService = jasmine.createSpyObj('TaskService', ['restoreTask']);
    archiveHandler = jasmine.createSpyObj('ArchiveOperationHandler', [
      'whenLocalOperationsSettled',
    ]);
    archiveHandler.whenLocalOperationsSettled.and.resolveTo();
    taskArchiveService.load.and.resolveTo(
      archiveOf(
        task('root', { subTaskIds: ['sub'] }),
        task('sub', { parentId: 'root' }),
        task('orphan', { parentId: 'gone' }),
        task('other'),
      ),
    );

    TestBed.configureTestingModule({
      providers: [
        ArchivedTaskActionsService,
        provideMockStore(),
        { provide: TaskArchiveService, useValue: taskArchiveService },
        { provide: TaskService, useValue: taskService },
        { provide: ArchiveOperationHandler, useValue: archiveHandler },
      ],
    });
    service = TestBed.inject(ArchivedTaskActionsService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  describe('deletePermanently', () => {
    it('dispatches one synced op with the roots and all their descendants', async () => {
      taskArchiveService.load.and.returnValues(
        Promise.resolve(
          archiveOf(
            task('root', { subTaskIds: ['sub'] }),
            task('sub', { parentId: 'root' }),
            task('orphan', { parentId: 'gone' }),
            task('other'),
          ),
        ),
        Promise.resolve(archiveOf(task('other'))),
      );
      const removed = await service.deletePermanently(['root', 'orphan']);

      expect(removed).toBe(3);
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        deleteArchivedTasks({ taskIds: ['root', 'orphan', 'sub'] }),
      );
      expect(archiveHandler.whenLocalOperationsSettled).toHaveBeenCalled();
    });

    it('throws when the archive write did not land', async () => {
      // load() keeps returning the unchanged archive: the delete failed locally.
      await expectAsync(service.deletePermanently(['other'])).toBeRejectedWithError(
        /did not complete \(1 left\)/,
      );
    });

    it('dispatches nothing when no id is archived', async () => {
      expect(await service.deletePermanently(['missing'])).toBe(0);
      expect(store.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('restores root tasks with their archived subtasks', async () => {
      const restored = await service.restore(['root', 'other']);

      expect(restored).toBe(2);
      expect(taskService.restoreTask).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: 'root' }),
        [jasmine.objectContaining({ id: 'sub' })],
      );
      expect(taskService.restoreTask).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: 'other' }),
        [],
      );
      expect(archiveHandler.whenLocalOperationsSettled).toHaveBeenCalled();
    });

    it('skips subtasks, which cannot be restored without their parent', async () => {
      expect(await service.restore(['orphan', 'sub', 'missing'])).toBe(0);
      expect(taskService.restoreTask).not.toHaveBeenCalled();
      expect(archiveHandler.whenLocalOperationsSettled).not.toHaveBeenCalled();
    });
  });
});
