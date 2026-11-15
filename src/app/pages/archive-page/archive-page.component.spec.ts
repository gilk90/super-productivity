import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { ArchivePageComponent, ARCHIVE_PAGE_SIZE } from './archive-page.component';
import { TaskArchiveService } from '../../features/archive/task-archive.service';
import { ArchivedTaskActionsService } from '../../features/archive/archived-task-actions.service';
import { SnackService } from '../../core/snack/snack.service';
import { selectAllProjects } from '../../features/project/store/project.selectors';
import { selectAllTags } from '../../features/tag/store/tag.reducer';
import { Task, TaskArchive } from '../../features/tasks/task.model';

const NOV_10 = Date.UTC(2026, 10, 10, 12);

const task = (id: string, partial: Partial<Task> = {}): Task =>
  ({
    id,
    title: `Task ${id}`,
    projectId: 'p1',
    subTaskIds: [],
    tagIds: [],
    timeSpent: 0,
    timeEstimate: 0,
    isDone: true,
    created: NOV_10,
    doneOn: NOV_10,
    ...partial,
  }) as Task;

const archiveOf = (tasks: Task[]): TaskArchive => ({
  ids: tasks.map((t) => t.id),
  entities: Object.fromEntries(tasks.map((t) => [t.id, t])),
});

describe('ArchivePageComponent', () => {
  let fixture: ComponentFixture<ArchivePageComponent>;
  let component: ArchivePageComponent;
  let taskArchiveService: jasmine.SpyObj<TaskArchiveService>;
  let actions: jasmine.SpyObj<ArchivedTaskActionsService>;
  let matDialog: jasmine.SpyObj<MatDialog>;

  const setup = async (tasks: Task[]): Promise<void> => {
    taskArchiveService = jasmine.createSpyObj('TaskArchiveService', ['load']);
    taskArchiveService.load.and.resolveTo(archiveOf(tasks));
    actions = jasmine.createSpyObj('ArchivedTaskActionsService', [
      'restore',
      'deletePermanently',
    ]);
    actions.restore.and.resolveTo(1);
    actions.deletePermanently.and.resolveTo(1);
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectAllProjects, value: [{ id: 'p1', title: 'Work' }] },
            { selector: selectAllTags, value: [] },
          ],
        }),
        { provide: TaskArchiveService, useValue: taskArchiveService },
        { provide: ArchivedTaskActionsService, useValue: actions },
        { provide: MatDialog, useValue: matDialog },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArchivePageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const renderedTitles = (): string[] =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.task-title'),
    ).map((el) => el.textContent?.trim() || '');

  it('renders archived root tasks and filters them by search term', async () => {
    await setup([
      task('a', { title: 'Write report' }),
      task('b', { title: 'Call bank' }),
    ]);
    expect(renderedTitles()).toEqual(['Write report', 'Call bank']);

    component.searchTerm.set('bank');
    fixture.detectChanges();

    expect(renderedTitles()).toEqual(['Call bank']);
  });

  it('renders the first page only and shows more on request', async () => {
    await setup(
      Array.from({ length: ARCHIVE_PAGE_SIZE + 5 }, (_, i) =>
        task(`t${i}`, { doneOn: NOV_10 - i }),
      ),
    );
    expect(renderedTitles().length).toBe(ARCHIVE_PAGE_SIZE);
    expect(component.hasMore()).toBe(true);

    component.showMore();
    fixture.detectChanges();

    expect(renderedTitles().length).toBe(ARCHIVE_PAGE_SIZE + 5);
  });

  it('deletes only after the user confirms, then reloads the archive', async () => {
    await setup([task('a')]);
    matDialog.open.and.returnValue({ afterClosed: () => of(false) } as never);

    await component.deletePermanently(['a']);
    expect(actions.deletePermanently).not.toHaveBeenCalled();

    matDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    await component.deletePermanently(['a']);

    expect(actions.deletePermanently).toHaveBeenCalledOnceWith(['a']);
    expect(taskArchiveService.load).toHaveBeenCalledTimes(2);
    expect(component.selectedCount()).toBe(0);
  });

  it('selects and restores only restorable tasks', async () => {
    await setup([task('root'), task('orphan', { parentId: 'gone' })]);

    component.toggleAllShown(true);

    expect(component.selectedCount()).toBe(2);
    expect(component.selectedRestorableIds()).toEqual(['root']);
    await component.restore(component.selectedRestorableIds());
    expect(actions.restore).toHaveBeenCalledOnceWith(['root']);
  });
});
