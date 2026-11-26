import { Injectable, NgZone } from '@angular/core';
import { AnswerSheetApiService } from './answer-sheet-api.service';
import { UploadStoreService } from './upload-store.service';
import {
  ApiFailure,
  backoffMs,
  FileProgress,
  formatBytes,
  formatWhen,
  idleSnapshot,
  PendingUpload,
  RemoteSubmission,
  StoredFile,
  UploadSnapshot
} from './models';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AnswerUploadService {
  readonly state$ = new BehaviorSubject<UploadSnapshot>(idleSnapshot());
  private run = 0;
  private looping = false;
  private current: PendingUpload | null = null;
  private sleeper: { timer: number; resolve: () => void } | null = null;

  constructor(
    private api: AnswerSheetApiService,
    private store: UploadStoreService,
    private zone: NgZone
  ) {}

  begin(token: string, name: string, admNo: string, files: File[]): Promise<void> {
    const pending = this.fromFiles(token, name, admNo, files);
    return this.persist(pending).then(() => this.drive(pending));
  }

  continuePending(pending: PendingUpload): Promise<void> {
    return this.drive(pending);
  }

  retry(): void {
    if (!this.current) {
      return;
    }
    const phase = this.state$.value.phase;
    if (phase === 'complete' || phase === 'blocked' || phase === 'idle') {
      return;
    }
    if (this.looping) {
      this.wakeNow();
      return;
    }
    this.drive(this.current);
  }

  stop(): void {
    this.run++;
    this.looping = false;
    this.wakeNow();
  }

  wakeNow(): void {
    if (!this.sleeper) {
      return;
    }
    window.clearTimeout(this.sleeper.timer);
    const resolve = this.sleeper.resolve;
    this.sleeper = null;
    resolve();
  }

  discard(): Promise<void> {
    this.stop();
    const pending = this.current;
    this.current = null;
    this.emit(idleSnapshot());
    if (!pending) {
      return Promise.resolve();
    }
    return this.store.remove(pending.localId);
  }

  localFiles(): { name: string; blob: Blob }[] {
    if (!this.current) {
      return [];
    }
    return this.current.files.map(file => ({ name: file.fileName, blob: file.blob }));
  }

  private async drive(pending: PendingUpload): Promise<void> {
    const run = ++this.run;
    this.current = pending;
    this.looping = true;
    this.wakeNow();
    let failures = 0;
    try {
      while (this.run === run) {
        if (!navigator.onLine) {
          failures = 0;
          this.emit(this.view(
            pending,
            'paused',
            'You are offline',
            'The answer sheet is saved on this device. Uploading continues automatically when the connection returns.',
            true
          ));
          await this.sleep(5000);
          continue;
        }
        try {
          const session = await this.api.getSession(pending.token);
          if (this.run !== run) {
            return;
          }
          if (session.phase === 'scheduled' && !pending.submissionId) {
            this.emit(this.view(
              pending,
              'paused',
              'Waiting for the window to open',
              'The file is saved on this device. Sending starts on its own when the teacher’s window opens.',
              false
            ));
            await this.sleep(5000);
            continue;
          }
          if (session.phase === 'closed' && !pending.submissionId) {
            this.emit(this.blocked(
              'The upload window has closed',
              'This file was not sent because the window closed before the upload started. '
                + 'Download your copy below and contact your teacher.',
              false,
              true
            ));
            return;
          }
          await this.ensureSubmission(pending);
          if (this.run !== run) {
            return;
          }
          const remote = await this.api.getSubmission(pending.token, pending.submissionId || '');
          if (this.run !== run) {
            return;
          }
          if (remote.status === 'complete') {
            await this.finish(pending, remote.completedAt);
            return;
          }
          this.applyRemote(pending, remote);
          const piece = this.nextPiece(pending);
          if (!piece) {
            const done = await this.api.completeSubmission(pending.token, pending.submissionId || '');
            if (this.run !== run) {
              return;
            }
            await this.finish(pending, done.completedAt);
            return;
          }
          const sent = this.receivedBytes(pending);
          const total = this.totalBytes(pending);
          const duringGrace = session.phase === 'closed';
          this.emit(this.view(
            pending,
            'uploading',
            duringGrace ? 'Finishing an upload that started on time' : 'Uploading your answer sheet',
            'Sent ' + formatBytes(sent) + ' of ' + formatBytes(total)
              + '. Keep this page open. If it closes, open the same link on this device to continue.',
            false,
            piece.file.fileName
          ));
          const result = await this.api.putChunk(
            pending.token,
            pending.submissionId || '',
            piece.file.fileId || '',
            piece.index,
            piece.blob
          );
          if (this.run !== run) {
            return;
          }
          piece.file.received = result.received.slice();
          await this.persist(pending);
          failures = 0;
        } catch (err) {
          if (this.run !== run) {
            return;
          }
          const failure = this.api.asFailure(err);
          if (failure.code === 'NOT_FOUND') {
            pending.submissionId = null;
            pending.files.forEach(file => {
              file.fileId = null;
              file.received = [];
            });
            await this.persist(pending);
            continue;
          }
          if (failure.code === 'INCOMPLETE' || failure.code === 'WINDOW_NOT_OPEN') {
            await this.sleep(1500);
            continue;
          }
          if (failure.terminal) {
            this.emit(this.terminalSnapshot(pending, failure));
            return;
          }
          failures++;
          const wait = backoffMs(failures);
          const attention = failures >= 4;
          this.emit(this.view(
            pending,
            attention ? 'attention' : 'paused',
            attention ? 'Still trying to reach the server' : 'Connection problem',
            failure.message + ' Parts already received are kept. Next try in ' + Math.ceil(wait / 1000) + ' seconds.',
            true
          ));
          await this.sleep(wait);
        }
      }
    } finally {
      if (this.run === run) {
        this.looping = false;
      }
    }
  }

  private async ensureSubmission(pending: PendingUpload): Promise<void> {
    if (pending.submissionId && pending.files.every(file => !!file.fileId)) {
      return;
    }
    const created = await this.api.createSubmission(pending.token, {
      admNo: pending.admNo,
      name: pending.name,
      files: pending.files.map(file => ({ fileName: file.fileName, mime: file.mime, size: file.size }))
    });
    if (created.files.length !== pending.files.length) {
      throw new ApiFailure(500, 'SERVER', 'The server did not accept every page. The upload will try again.', false);
    }
    pending.submissionId = created.submissionId;
    created.files.forEach((info, index) => {
      pending.files[index].fileId = info.fileId;
      pending.files[index].chunkSize = info.chunkSize;
      pending.files[index].totalChunks = info.totalChunks;
      pending.files[index].received = (info.received || []).slice();
    });
    await this.persist(pending);
  }

  private async finish(pending: PendingUpload, completedAt: string | null): Promise<void> {
    const when = completedAt || new Date().toISOString();
    try {
      localStorage.setItem('epv.receipt.' + pending.localId, JSON.stringify({
        token: pending.token,
        admNo: pending.admNo,
        name: pending.name,
        completedAt: when,
        fileNames: pending.files.map(file => file.fileName)
      }));
    } catch (err) {
      // The receipt is only a convenience. The server already has the file.
    }
    await this.store.remove(pending.localId);
    this.emit({
      phase: 'complete',
      title: 'Answer sheet received',
      message: 'The server has the file' + (pending.files.length > 1 ? 's' : '') + '. You can close this page.',
      percent: 100,
      files: pending.files.map(file => ({
        fileName: file.fileName,
        size: file.size,
        receivedBytes: file.size,
        status: 'Received'
      })),
      canRetry: false,
      canChooseFile: false,
      canDownloadLocal: false,
      persisted: true,
      completedAt: when
    });
  }

  private terminalSnapshot(pending: PendingUpload, failure: ApiFailure): UploadSnapshot {
    let message = failure.message;
    if (failure.code === 'ATTEMPT_LIMIT' && failure.completedAt) {
      message += ' Last received ' + formatWhen(failure.completedAt) + '.';
    }
    const choose = failure.code === 'UNKNOWN_STUDENT' || failure.code === 'BAD_TYPE'
      || failure.code === 'TOO_LARGE' || failure.code === 'EMPTY_FILE' || failure.code === 'BAD_REQUEST';
    const download = failure.code === 'WINDOW_CLOSED';
    const titles: { [code: string]: string } = {
      INVALID_LINK: 'This link is not valid',
      WINDOW_CLOSED: 'The upload window has closed',
      UNKNOWN_STUDENT: 'Name not on the class list',
      ATTEMPT_LIMIT: 'Upload not accepted',
      TOO_LARGE: 'File is too large',
      BAD_TYPE: 'That file type is not allowed',
      EMPTY_FILE: 'The file is empty',
      BAD_REQUEST: 'The upload needs a correction'
    };
    return {
      phase: 'blocked',
      title: titles[failure.code] || 'Upload stopped',
      message,
      percent: this.percent(pending),
      files: this.fileRows(pending, null),
      canRetry: false,
      canChooseFile: choose,
      canDownloadLocal: download,
      persisted: pending.persisted,
      completedAt: failure.completedAt
    };
  }

  private fromFiles(token: string, name: string, admNo: string, files: File[]): PendingUpload {
    return {
      localId: token + '::' + admNo.trim().toLowerCase(),
      token,
      admNo: admNo.trim(),
      name: name.trim(),
      submissionId: null,
      persisted: true,
      updatedAt: Date.now(),
      files: files.map(file => ({
        fileName: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        blob: file,
        fileId: null,
        chunkSize: 0,
        totalChunks: 0,
        received: []
      }))
    };
  }

  private applyRemote(pending: PendingUpload, remote: RemoteSubmission): void {
    pending.files.forEach(file => {
      const match = remote.files.find(item => item.fileId === file.fileId);
      if (!match) {
        return;
      }
      file.received = (match.received || []).slice();
      file.chunkSize = match.chunkSize;
      file.totalChunks = match.totalChunks;
    });
  }

  private nextPiece(pending: PendingUpload): { file: StoredFile; index: number; blob: Blob } | null {
    for (const file of pending.files) {
      if (!file.fileId || !file.chunkSize) {
        continue;
      }
      const have: { [index: number]: boolean } = {};
      file.received.forEach(index => {
        have[index] = true;
      });
      for (let index = 0; index < file.totalChunks; index++) {
        if (!have[index]) {
          const start = index * file.chunkSize;
          const end = Math.min(start + file.chunkSize, file.size);
          return { file, index, blob: file.blob.slice(start, end) };
        }
      }
    }
    return null;
  }

  private async persist(pending: PendingUpload): Promise<void> {
    pending.updatedAt = Date.now();
    try {
      await this.store.put(pending);
      pending.persisted = true;
    } catch (err) {
      pending.persisted = false;
    }
  }

  private view(
    pending: PendingUpload,
    phase: UploadSnapshot['phase'],
    title: string,
    message: string,
    canRetry: boolean,
    activeName?: string
  ): UploadSnapshot {
    let text = message;
    if (!pending.persisted) {
      text += ' This browser could not store a backup of the file. Keep this page open until it is received.';
    }
    return {
      phase,
      title,
      message: text,
      percent: this.percent(pending),
      files: this.fileRows(pending, activeName || null),
      canRetry,
      canChooseFile: false,
      canDownloadLocal: true,
      persisted: pending.persisted,
      completedAt: null
    };
  }

  private blocked(title: string, message: string, canChooseFile: boolean, canDownloadLocal: boolean): UploadSnapshot {
    const pending = this.current;
    return {
      phase: 'blocked',
      title,
      message,
      percent: pending ? this.percent(pending) : 0,
      files: pending ? this.fileRows(pending, null) : [],
      canRetry: false,
      canChooseFile,
      canDownloadLocal,
      persisted: pending ? pending.persisted : true,
      completedAt: null
    };
  }

  private fileRows(pending: PendingUpload, activeName: string | null): FileProgress[] {
    return pending.files.map(file => {
      const receivedBytes = this.fileReceivedBytes(file);
      let status = 'Waiting';
      if (file.totalChunks > 0 && receivedBytes >= file.size) {
        status = 'Saved on server';
      } else if (activeName === file.fileName) {
        status = 'Sending';
      } else if (receivedBytes > 0) {
        status = 'Partly sent';
      }
      return { fileName: file.fileName, size: file.size, receivedBytes, status };
    });
  }

  private fileReceivedBytes(file: StoredFile): number {
    if (!file.chunkSize) {
      return 0;
    }
    const have: { [index: number]: boolean } = {};
    file.received.forEach(index => {
      have[index] = true;
    });
    let total = 0;
    Object.keys(have).forEach(key => {
      const index = Number(key);
      if (index >= 0 && index < file.totalChunks) {
        const start = index * file.chunkSize;
        total += Math.min(file.chunkSize, file.size - start);
      }
    });
    return total;
  }

  private receivedBytes(pending: PendingUpload): number {
    return pending.files.reduce((sum, file) => sum + this.fileReceivedBytes(file), 0);
  }

  private totalBytes(pending: PendingUpload): number {
    return pending.files.reduce((sum, file) => sum + file.size, 0);
  }

  private percent(pending: PendingUpload): number {
    const total = this.totalBytes(pending);
    if (!total) {
      return 0;
    }
    return Math.min(100, Math.floor(this.receivedBytes(pending) * 100 / total));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = window.setTimeout(() => {
        this.sleeper = null;
        resolve();
      }, ms);
      this.sleeper = { timer, resolve };
    });
  }

  private emit(snapshot: UploadSnapshot): void {
    this.zone.run(() => this.state$.next(snapshot));
  }
}
