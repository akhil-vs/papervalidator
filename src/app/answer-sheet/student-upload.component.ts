import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { AnswerSheetApiService } from './answer-sheet-api.service';
import { AnswerUploadService } from './answer-upload.service';
import { UploadStoreService } from './upload-store.service';
import {
  countdown,
  formatBytes,
  formatWhen,
  idleSnapshot,
  PendingUpload,
  PublicSession,
  tokenOk,
  UploadSnapshot
} from './models';
import { Subscription } from 'rxjs';

interface Receipt {
  admNo: string;
  name: string;
  completedAt: string;
  fileNames: string[];
}

@Component({
  selector: 'app-student-upload',
  templateUrl: './student-upload.component.html',
  styleUrls: ['./student-upload.component.css']
})
export class StudentUploadComponent implements OnInit, OnDestroy {
  token = '';
  session: PublicSession | null = null;
  loadError = '';
  formError = '';
  admNo = '';
  name = '';
  chosen: File[] = [];
  snapshot: UploadSnapshot = idleSnapshot();
  pendingList: PendingUpload[] = [];
  online = true;
  clock = Date.now();
  zoneName = '';
  mineNote = '';
  mineLocked = false;
  private offset = 0;
  private ticks = 0;
  private timer = 0;
  private sub: Subscription | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: AnswerSheetApiService,
    private store: UploadStoreService,
    private uploads: AnswerUploadService,
    private title: Title
  ) {}

  ngOnInit() {
    this.title.setTitle('Upload answer sheet');
    this.zoneName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    this.online = navigator.onLine;
    this.token = this.route.snapshot.paramMap.get('token') || '';
    this.sub = this.uploads.state$.subscribe(snapshot => {
      this.snapshot = snapshot;
    });
    this.timer = window.setInterval(() => {
      this.clock = Date.now() + this.offset;
      this.online = navigator.onLine;
      this.ticks++;
      if (tokenOk(this.token) && this.ticks % 5 === 0) {
        this.loadSession();
      }
    }, 1000);
    if (!tokenOk(this.token)) {
      this.loadError = 'This link is not valid. Ask your teacher for the upload link.';
      return;
    }
    this.loadSession();
    this.restore();
  }

  ngOnDestroy() {
    window.clearInterval(this.timer);
    if (this.sub) {
      this.sub.unsubscribe();
    }
    this.uploads.stop();
    this.title.setTitle('Exam Paper Validator');
  }

  @HostListener('window:online')
  onOnline() {
    this.online = true;
    this.uploads.wakeNow();
    if (!this.session) {
      this.loadSession();
    }
  }

  @HostListener('window:offline')
  onOffline() {
    this.online = false;
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    const phase = this.snapshot.phase;
    if (phase === 'uploading' || phase === 'paused' || phase === 'attention') {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  loadSession() {
    this.api.getSession(this.token).then(session => {
      this.session = session;
      this.loadError = '';
      this.offset = new Date(session.serverNow).getTime() - Date.now();
      this.clock = Date.now() + this.offset;
    }).catch(err => {
      const failure = this.api.asFailure(err);
      if (!this.session) {
        this.loadError = failure.message;
      }
    });
  }

  onFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    this.chosen = [];
    this.formError = '';
    const list = input.files;
    if (!list) {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const file = list.item(i);
      if (file) {
        this.chosen.push(file);
      }
    }
  }

  onStudentPick() {
    if (!this.session) {
      return;
    }
    const match = this.session.students.find(student => student.admNo === this.admNo);
    if (match) {
      this.name = match.name;
    }
    this.lookupMine();
  }

  lookupMine() {
    this.mineNote = '';
    this.mineLocked = false;
    if (!this.admNo || !this.name) {
      return;
    }
    this.api.mine(this.token, this.admNo, this.name).then(status => {
      this.name = status.name;
      if (status.completeCount >= status.maxAttempts) {
        this.mineLocked = true;
        this.mineNote = 'An answer sheet for this admission number is already with your teacher'
          + (status.lastCompletedAt ? ' (' + formatWhen(status.lastCompletedAt) + ')' : '')
          + '. Another upload is not allowed.';
        return;
      }
      if (status.completeCount > 0) {
        this.mineNote = 'A file was already received'
          + (status.lastCompletedAt ? ' at ' + formatWhen(status.lastCompletedAt) : '')
          + '. You can send a replacement (' + status.completeCount + ' of ' + status.maxAttempts + ' used).';
      } else if (status.inProgress) {
        this.mineNote = 'An upload for this admission number is unfinished. '
          + 'If you choose the same file on this device, it continues from the last part received.';
      }
    }).catch(() => {
      this.mineNote = '';
    });
  }

  submit() {
    this.formError = this.validateChoice();
    if (this.formError || !this.session) {
      return;
    }
    this.uploads.begin(this.token, this.name, this.admNo, this.chosen).catch(err => {
      this.formError = this.api.asFailure(err).message;
    });
  }

  continueOne(pending: PendingUpload) {
    this.uploads.continuePending(pending).catch(err => {
      this.formError = this.api.asFailure(err).message;
    });
  }

  retry() {
    this.uploads.retry();
  }

  discard() {
    this.uploads.discard().then(() => {
      this.chosen = [];
      this.formError = '';
      this.restore();
    });
  }

  downloadLocal() {
    this.uploads.localFiles().forEach(file => {
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  chooseAgain() {
    this.uploads.discard().then(() => {
      this.chosen = [];
      this.formError = '';
      this.snapshot = idleSnapshot();
    });
  }

  busy(): boolean {
    const phase = this.snapshot.phase;
    return phase === 'uploading' || phase === 'paused' || phase === 'attention';
  }

  showForm(): boolean {
    if (this.busy() || this.snapshot.phase === 'complete') {
      return false;
    }
    if (this.snapshot.phase === 'blocked' && !this.snapshot.canChooseFile) {
      return false;
    }
    return true;
  }

  windowPhase(): string {
    if (!this.session) {
      return '';
    }
    const opens = new Date(this.session.opensAt).getTime();
    const closes = new Date(this.session.closesAt).getTime();
    if (this.clock < opens) {
      return 'scheduled';
    }
    if (this.clock >= closes) {
      return 'closed';
    }
    return 'open';
  }

  countdownLabel(): string {
    if (!this.session) {
      return '';
    }
    if (this.windowPhase() === 'scheduled') {
      return 'Opens in ' + countdown(new Date(this.session.opensAt).getTime(), this.clock);
    }
    if (this.windowPhase() === 'open') {
      return 'Closes in ' + countdown(new Date(this.session.closesAt).getTime(), this.clock);
    }
    return 'Closed at ' + formatWhen(this.session.closesAt);
  }

  size(bytes: number): string {
    return formatBytes(bytes);
  }

  when(iso: string): string {
    return formatWhen(iso);
  }

  receipt(): Receipt | null {
    if (!this.admNo) {
      return null;
    }
    try {
      const raw = localStorage.getItem('epv.receipt.' + this.token + '::' + this.admNo.trim().toLowerCase());
      return raw ? JSON.parse(raw) as Receipt : null;
    } catch (err) {
      return null;
    }
  }

  private restore() {
    this.store.list(this.token).then(rows => {
      this.pendingList = rows.sort((a, b) => b.updatedAt - a.updatedAt);
      if (this.pendingList.length === 1 && this.snapshot.phase === 'idle') {
        this.continueOne(this.pendingList[0]);
      }
    });
  }

  private validateChoice(): string {
    if (!this.session) {
      return 'The exam details have not loaded yet.';
    }
    if (this.windowPhase() === 'closed') {
      return 'The upload window has closed. Your teacher cannot take a new answer sheet from this link.';
    }
    if (!this.name.trim() || !this.admNo.trim()) {
      return this.session.students.length
        ? 'Select your name from the class list.'
        : 'Enter your name and admission number.';
    }
    if (this.mineLocked) {
      return this.mineNote;
    }
    if (!this.chosen.length) {
      return 'Choose the answer sheet file first.';
    }
    if (this.chosen.length > this.session.maxFiles) {
      return 'Upload at most ' + this.session.maxFiles + ' files.';
    }
    for (const file of this.chosen) {
      if (!file.size) {
        return file.name + ' is empty. Choose the file again.';
      }
      if (file.size > this.session.maxFileBytes) {
        return file.name + ' is larger than ' + formatBytes(this.session.maxFileBytes) + '.';
      }
      if (!this.allowed(file.name)) {
        return file.name + ' is not a PDF or a photo. Use PDF, JPG, PNG, or WEBP.';
      }
    }
    return '';
  }

  private allowed(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return lower.endsWith('.pdf') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      || lower.endsWith('.png') || lower.endsWith('.webp');
  }
}
