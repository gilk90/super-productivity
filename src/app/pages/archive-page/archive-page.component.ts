import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { T } from '../../t.const';
import { TaskArchiveService } from '../../features/archive/task-archive.service';
import { ArchivedTaskActionsService } from '../../features/archive/archived-task-actions.service';
import {
  ArchivedTaskExportNames,
  ArchivedTaskRow,
  archivedTasksToCsv,
  archivedTasksToMarkdown,
  buildArchivedTaskRows,
  filterArchivedTaskRows,
  isRestorableArchivedTask,
} from '../../features/archive/util/archived-task-list.util';
import { selectAllProjects } from '../../features/project/store/project.selectors';
import { selectAllTags } from '../../features/tag/store/tag.reducer';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { SnackService } from '../../core/snack/snack.service';
import { MsToStringPipe } from '../../ui/duration/ms-to-string.pipe';
import { download } from '../../util/download';
import { getDbDateStr } from '../../util/get-db-date-str';
import { Log } from '../../core/log';

/** Rows rendered per step; the archive can hold tens of thousands of tasks. */
export const ARCHIVE_PAGE_SIZE = 100;

@Component({
  selector: 'archive-page',
  templateUrl: './archive-page.component.html',
  styleUrls: ['./archive-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    MatButton,
    MatIconButton,
    MatCheckbox,
    MatFormField,
    MatLabel,
    MatSuffix,
    MatIcon,
    MatInput,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatSelect,
    MatOption,
    MatTooltip,
    TranslatePipe,
    MsToStringPipe,
  ],
})
export class ArchivePageComponent implements OnInit {
  private readonly _store = inject(Store);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _archivedTaskActions = inject(ArchivedTaskActionsService);

  readonly T = T;

  readonly isLoading = signal(true);
  readonly isBusy = signal(false);
  private readonly _rows = signal<ArchivedTaskRow[]>([]);

  readonly searchTerm = signal('');
  readonly projectId = signal<string | null>(null);
  readonly tagId = signal<string | null>(null);
  readonly fromDay = signal<string>('');
  readonly toDay = signal<string>('');
  readonly shownCount = signal(ARCHIVE_PAGE_SIZE);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  readonly projects = this._store.selectSignal(selectAllProjects);
  private readonly _allTags = this._store.selectSignal(selectAllTags);
  readonly tags = computed(() =>
    this._allTags().filter((tag) => tag.id !== TODAY_TAG.id),
  );

  readonly projectTitles = computed(() =>
    Object.fromEntries(this.projects().map((p) => [p.id, p.title])),
  );
  private readonly _tagTitles = computed(() =>
    Object.fromEntries(this._allTags().map((tag) => [tag.id, tag.title])),
  );

  readonly totalCount = computed(() => this._rows().length);
  readonly isFiltered = computed(
    () =>
      !!this.searchTerm().trim() ||
      !!this.projectId() ||
      !!this.tagId() ||
      !!this.fromDay() ||
      !!this.toDay(),
  );
  readonly filteredRows = computed(() =>
    filterArchivedTaskRows(this._rows(), {
      term: this.searchTerm(),
      projectId: this.projectId(),
      tagId: this.tagId(),
      fromDay: this.fromDay() || null,
      toDay: this.toDay() || null,
    }),
  );
  readonly shownRows = computed(() => this.filteredRows().slice(0, this.shownCount()));
  readonly hasMore = computed(() => this.filteredRows().length > this.shownCount());

  readonly selectedCount = computed(() => this.selectedIds().size);
  readonly isAllShownSelected = computed(() => {
    const shown = this.shownRows();
    const selected = this.selectedIds();
    return shown.length > 0 && shown.every((row) => selected.has(row.task.id));
  });
  readonly isSomeShownSelected = computed(
    () =>
      !this.isAllShownSelected() &&
      this.shownRows().some((row) => this.selectedIds().has(row.task.id)),
  );
  readonly selectedRestorableIds = computed(() =>
    this._rows()
      .filter(
        (row) =>
          this.selectedIds().has(row.task.id) && isRestorableArchivedTask(row.task),
      )
      .map((row) => row.task.id),
  );

  ngOnInit(): void {
    void this._load();
  }

  onFilterChange(): void {
    this.shownCount.set(ARCHIVE_PAGE_SIZE);
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.projectId.set(null);
    this.tagId.set(null);
    this.fromDay.set('');
    this.toDay.set('');
    this.onFilterChange();
  }

  showMore(): void {
    this.shownCount.update((count) => count + ARCHIVE_PAGE_SIZE);
  }

  toggleSelected(id: string, isSelected: boolean): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (isSelected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  toggleAllShown(isSelected: boolean): void {
    const shownIds = this.shownRows().map((row) => row.task.id);
    this.selectedIds.update((current) => {
      const next = new Set(current);
      for (const id of shownIds) {
        if (isSelected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  async restore(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this._runAction(async () => {
      const count = await this._archivedTaskActions.restore(ids);
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.ARCHIVE.S_RESTORED,
        translateParams: { count },
      });
    });
  }

  async deletePermanently(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const isConfirmed = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            okTxt: T.F.ARCHIVE.BTN_DELETE,
            message: T.F.ARCHIVE.D_CONFIRM_DELETE,
            translateParams: { count: ids.length },
          },
        })
        .afterClosed(),
    );
    if (isConfirmed !== true) return;
    await this._runAction(async () => {
      const count = await this._archivedTaskActions.deletePermanently(ids);
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.ARCHIVE.S_DELETED,
        translateParams: { count },
      });
    });
  }

  /** Exports the selection when there is one, otherwise everything filtered. */
  async export(format: 'csv' | 'md'): Promise<void> {
    const selected = this.selectedIds();
    const rows =
      selected.size > 0
        ? this.filteredRows().filter((row) => selected.has(row.task.id))
        : this.filteredRows();
    if (rows.length === 0) return;
    const names: ArchivedTaskExportNames = {
      projectTitles: this.projectTitles(),
      tagTitles: this._tagTitles(),
    };
    const content =
      format === 'csv'
        ? archivedTasksToCsv(rows, names)
        : archivedTasksToMarkdown(rows, names);
    const result = await download(
      `super-productivity-archive-${getDbDateStr()}.${format}`,
      content,
    );
    if (!result.wasCanceled) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.ARCHIVE.S_EXPORTED,
        translateParams: { count: rows.length },
      });
    }
  }

  private async _runAction(action: () => Promise<void>): Promise<void> {
    this.isBusy.set(true);
    try {
      await action();
    } catch (err) {
      Log.err('[ArchivePage] archive action failed', err);
      this._snackService.open({ type: 'ERROR', msg: T.F.ARCHIVE.S_ERROR });
    } finally {
      this.selectedIds.set(new Set());
      await this._load();
      this.isBusy.set(false);
    }
  }

  private async _load(): Promise<void> {
    try {
      const archive = await this._taskArchiveService.load();
      this._rows.set(buildArchivedTaskRows(archive));
    } catch (err) {
      Log.err('[ArchivePage] could not load the archive', err);
      this._snackService.open({ type: 'ERROR', msg: T.F.ARCHIVE.S_ERROR });
    } finally {
      this.isLoading.set(false);
    }
  }
}
