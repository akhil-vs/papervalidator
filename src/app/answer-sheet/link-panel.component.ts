import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { saveAs } from 'file-saver';
import { AnswerSheetApiService } from './answer-sheet-api.service';
import {
  countdown,
  formatBytes,
  formatWhen,
  PublicSession,
  RemoteSubmission,
  StoredLink,
  StudentRef,
  toLocalInput
} from './models';

interface MarkRow {
  admNo: string;
  name: string;
  status: string;
  detail: string;
  submissionId: string | null;
  files: { fileId: string; fileName: string; ready: boolean }[];
  partial: boolean;
}

@Component({
  selector: 'app-answer-link',
  templateUrl: './link-panel.component.html',
  styleUrls: ['./link-panel.component.css']
})
export class LinkPanelComponent implements OnInit, OnDestroy {
  @Input() className = '';
  @Input() exam = '';
  @Input() subject = '';
  @Input() teacher = '';
  @Input() students: any[] = [];
  @Output() applyDetails = new EventEmitter<StoredLink>();

  opensAt = '';
  closesAt = '';
  graceMinutes = 15;
  maxFileMb = 20;
  maxAttempts = 2;
  instructions = 'Upload one PDF of your answer sheet, or one clear photo per page. '
    + 'Stay on this page until it says the file has been received. '
    + 'If the network drops, open this same link again on the same phone or computer.';
  linkBase = '';
  notice = '';
  error = '';
  apiOnline: boolean | null = null;
  creating = false;
  saved: StoredLink[] = [];
  active: StoredLink | null = null;
  session: PublicSession | null = null;
  submissions: RemoteSubmission[] = [];
  rows: MarkRow[] = [];
  receivedCount = 0;
  rosterCount = 0;
  nextClose = '';
  restoreToken = '';
  restoreKey = '';
  zoneName = '';
  clock = Date.now();
  activeIndex = '0';
  private offset = 0;
  private timer = 0;
  private poll = 0;

  constructor(private api: AnswerSheetApiService) {}

  ngOnInit() {
    this.zoneName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    this.linkBase = window.location.origin;
    this.opensAt = toLocalInput(Date.now());
    this.closesAt = toLocalInput(Date.now() + 2 * 60 * 60 * 1000);
    this.saved = this.readSaved();
    if (this.saved.length) {
      this.select(this.saved[0], true);
    }
    this.timer = window.setInterval(() => {
      this.clock = Date.now() + this.offset;
    }, 1000);
    this.checkApi();
  }

  ngOnDestroy() {
    window.clearInterval(this.timer);
    window.clearInterval(this.poll);
  }

  checkApi() {
    this.api.health().then(() => {
      this.apiOnline = true;
      if (this.active) {
        this.refresh();
      }
    }).catch(() => {
      this.apiOnline = false;
    });
  }

  create() {
    this.notice = '';
    this.error = '';
    if (!this.className || !this.exam || !this.subject || !this.teacher) {
      this.error = 'Enter the class, exam, subject, and teacher before creating a link.';
      return;
    }
    const opens = new Date(this.opensAt).getTime();
    const closes = new Date(this.closesAt).getTime();
    if (!Number.isFinite(opens) || !Number.isFinite(closes)) {
      this.error = 'Choose both an opening time and a closing time.';
      return;
    }
    this.creating = true;
    this.api.createSession({
      className: this.className,
      exam: this.exam,
      subject: this.subject,
      teacher: this.teacher,
      opensAt: new Date(opens).toISOString(),
      closesAt: new Date(closes).toISOString(),
      graceMinutes: Number(this.graceMinutes),
      maxFileMb: Number(this.maxFileMb),
      maxAttempts: Number(this.maxAttempts),
      instructions: this.instructions,
      students: this.roster()
    }).then(created => {
      const stored: StoredLink = {
        token: created.token,
        manageKey: created.manageKey,
        className: this.className,
        exam: this.exam,
        subject: this.subject,
        teacher: this.teacher,
        opensAt: created.opensAt,
        closesAt: created.closesAt,
        linkBase: this.normalizedBase(),
        createdAt: new Date().toISOString()
      };
      this.saved = [stored].concat(this.saved.filter(item => item.token !== stored.token)).slice(0, 20);
      this.writeSaved();
      this.select(stored, false);
      this.notice = 'Link ready. Share it only with this class.';
    }).catch(err => {
      this.error = this.api.asFailure(err).message;
    }).then(() => {
      this.creating = false;
    });
  }

  onSavedPick(event: Event) {
    const selectEl = event.target as HTMLSelectElement;
    const link = this.saved[Number(selectEl.value)];
    if (link) {
      this.select(link, true);
    }
  }

  excelCount(): number {
    return this.roster().length;
  }

  select(link: StoredLink, fillHeader: boolean) {
    this.active = link;
    const index = this.saved.findIndex(item => item.token === link.token);
    this.activeIndex = String(index < 0 ? 0 : index);
    this.nextClose = toLocalInput(new Date(link.closesAt).getTime());
    this.linkBase = link.linkBase || this.linkBase;
    if (fillHeader) {
      this.applyDetails.emit(link);
    }
    this.refresh();
    window.clearInterval(this.poll);
    this.poll = window.setInterval(() => this.refresh(), 8000);
  }

  refresh() {
    if (!this.active) {
      return;
    }
    const link = this.active;
    this.api.getSession(link.token).then(session => {
      this.session = session;
      this.offset = new Date(session.serverNow).getTime() - Date.now();
      this.clock = Date.now() + this.offset;
      this.apiOnline = true;
      link.opensAt = session.opensAt;
      link.closesAt = session.closesAt;
      this.writeSaved();
      return this.api.listSubmissions(link.token, link.manageKey);
    }).then(list => {
      if (!list) {
        return;
      }
      this.submissions = list.submissions;
      this.rebuildRows(list.serverNow);
      this.error = '';
    }).catch(err => {
      const failure = this.api.asFailure(err);
      if (failure.code === 'NETWORK' || failure.code === 'TIMEOUT') {
        this.apiOnline = false;
      }
      this.error = failure.message;
    });
  }

  updateClose() {
    if (!this.active) {
      return;
    }
    this.error = '';
    const closes = new Date(this.nextClose).getTime();
    if (!Number.isFinite(closes)) {
      this.error = 'Choose a new closing time.';
      return;
    }
    this.api.patchSession(this.active.token, this.active.manageKey, {
      closesAt: new Date(closes).toISOString()
    }).then(session => {
      this.session = session;
      if (this.active) {
        this.active.closesAt = session.closesAt;
        this.writeSaved();
      }
      this.notice = 'Closing time updated.';
    }).catch(err => {
      this.error = this.api.asFailure(err).message;
    });
  }

  closeNow() {
    if (!this.active) {
      return;
    }
    this.api.patchSession(this.active.token, this.active.manageKey, { forceClose: true }).then(session => {
      this.session = session;
      if (this.active) {
        this.active.closesAt = session.closesAt;
        this.nextClose = toLocalInput(new Date(session.closesAt).getTime());
        this.writeSaved();
      }
      this.notice = 'The window is closed. Students can no longer start an upload.';
    }).catch(err => {
      this.error = this.api.asFailure(err).message;
    });
  }

  useCurrentRoster() {
    if (!this.active) {
      return;
    }
    this.api.patchSession(this.active.token, this.active.manageKey, {
      students: this.roster(),
      instructions: this.instructions
    }).then(session => {
      this.session = session;
      this.notice = this.roster().length
        ? 'The class list on this link now matches the Excel file.'
        : 'The class list was cleared. Any student with the link can submit a name.';
      this.refresh();
    }).catch(err => {
      this.error = this.api.asFailure(err).message;
    });
  }

  discardPartial(row: MarkRow) {
    if (!this.active || !row.submissionId) {
      return;
    }
    this.api.discardSubmission(this.active.token, this.active.manageKey, row.submissionId).then(() => {
      this.notice = 'Interrupted upload discarded for ' + row.name + '.';
      this.refresh();
    }).catch(err => {
      this.error = this.api.asFailure(err).message;
    });
  }

  download(row: MarkRow, fileId: string, fileName: string) {
    if (!this.active || !row.submissionId) {
      return;
    }
    this.api.download(this.active.token, this.active.manageKey, row.submissionId, fileId).then(blob => {
      saveAs(blob, fileName);
    }).catch(err => {
      this.error = this.api.asFailure(err).message;
    });
  }

  restore() {
    this.error = '';
    const token = this.tokenFrom(this.restoreToken);
    if (!token) {
      this.error = 'Paste the student link, or the token from the end of it.';
      return;
    }
    if (!this.restoreKey.trim()) {
      this.error = 'Paste the management key that was shown when the link was created.';
      return;
    }
    this.api.getSession(token).then(session => {
      const stored: StoredLink = {
        token,
        manageKey: this.restoreKey.trim(),
        className: session.className,
        exam: session.exam,
        subject: session.subject,
        teacher: session.teacher,
        opensAt: session.opensAt,
        closesAt: session.closesAt,
        linkBase: this.normalizedBase(),
        createdAt: new Date().toISOString()
      };
      return this.api.listSubmissions(token, stored.manageKey).then(() => stored);
    }).then(stored => {
      this.saved = [stored].concat(this.saved.filter(item => item.token !== stored.token)).slice(0, 20);
      this.writeSaved();
      this.select(stored, true);
      this.notice = 'Link restored in this browser.';
      this.restoreToken = '';
      this.restoreKey = '';
    }).catch(err => {
      this.error = this.api.asFailure(err).message;
    });
  }

  copyLink() {
    if (!this.active) {
      return;
    }
    const link = this.studentLink();
    const nav = navigator as Navigator & { clipboard?: { writeText: (value: string) => Promise<void> } };
    if (nav.clipboard && nav.clipboard.writeText) {
      nav.clipboard.writeText(link).then(() => {
        this.notice = 'Link copied.';
      }).catch(() => this.fallbackCopy(link));
      return;
    }
    this.fallbackCopy(link);
  }

  share() {
    if (!this.active) {
      return;
    }
    const link = this.studentLink();
    const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (!nav.share) {
      this.copyLink();
      return;
    }
    nav.share({
      title: this.active.subject + ' answer sheet',
      text: this.shareText(),
      url: link
    }).catch(() => undefined);
  }

  mailHref(): string {
    if (!this.active) {
      return '';
    }
    const subject = encodeURIComponent(this.active.subject + ' answer sheet upload');
    const body = encodeURIComponent(this.shareText() + '\n\n' + this.studentLink());
    return 'mailto:?subject=' + subject + '&body=' + body;
  }

  studentLink(): string {
    if (!this.active) {
      return '';
    }
    return this.normalizedBase() + '/s/' + this.active.token;
  }

  livePhase(): string {
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

  phaseLabel(): string {
    if (!this.session) {
      return 'Checking';
    }
    if (this.livePhase() === 'scheduled') {
      return 'Opens later';
    }
    if (this.livePhase() === 'open') {
      return 'Open';
    }
    return 'Closed';
  }

  countdownLabel(): string {
    if (!this.session) {
      return '';
    }
    if (this.livePhase() === 'scheduled') {
      return 'Opens in ' + countdown(new Date(this.session.opensAt).getTime(), this.clock);
    }
    if (this.livePhase() === 'open') {
      return 'Closes in ' + countdown(new Date(this.session.closesAt).getTime(), this.clock);
    }
    return 'Closed ' + formatWhen(this.session.closesAt);
  }

  when(iso: string): string {
    return formatWhen(iso);
  }

  private rebuildRows(serverNow: string) {
    const now = new Date(serverNow).getTime();
    const latest: { [key: string]: RemoteSubmission } = {};
    this.submissions.forEach(item => {
      const key = item.admNo.toLowerCase();
      const current = latest[key];
      if (!current || item.createdAt > current.createdAt) {
        latest[key] = item;
      }
    });
    const roster = this.session ? this.session.students : [];
    this.rosterCount = roster.length;
    const seen: { [key: string]: boolean } = {};
    const rows: MarkRow[] = [];
    const push = (admNo: string, name: string) => {
      const key = admNo.toLowerCase();
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      rows.push(this.rowFor(admNo, name, latest[key], now));
    };
    roster.forEach(student => push(student.admNo, student.name));
    Object.keys(latest).forEach(key => push(latest[key].admNo, latest[key].name));
    this.rows = rows;
    this.receivedCount = rows.filter(row => row.status === 'Received').length;
  }

  private rowFor(admNo: string, name: string, submission: RemoteSubmission | undefined, now: number): MarkRow {
    if (!submission) {
      return {
        admNo, name, status: 'Not received', detail: 'No file yet',
        submissionId: null, files: [], partial: false
      };
    }
    const files = submission.files.map(file => ({
      fileId: file.fileId,
      fileName: file.fileName,
      ready: file.status === 'complete'
    }));
    if (submission.status === 'complete') {
      const detail = submission.files.map(file => file.fileName + ' (' + formatBytes(file.size) + ')').join(', ');
      return {
        admNo,
        name,
        status: 'Received',
        detail: (submission.completedAt ? formatWhen(submission.completedAt) + ' · ' : '') + detail,
        submissionId: submission.submissionId,
        files,
        partial: false
      };
    }
    const received = submission.files.reduce((sum, file) => sum + file.receivedBytes, 0);
    const total = submission.files.reduce((sum, file) => sum + file.size, 0);
    const updated = submission.files.reduce((latest, file) => {
      const at = file.updatedAt ? new Date(file.updatedAt).getTime() : 0;
      return Math.max(latest, at);
    }, 0);
    const live = updated > 0 && now - updated < 20000;
    return {
      admNo,
      name,
      status: live ? 'Uploading' : 'Interrupted',
      detail: formatBytes(received) + ' of ' + formatBytes(total)
        + (live ? ' arriving now' : ' — waiting for the student to reconnect'),
      submissionId: submission.submissionId,
      files,
      partial: true
    };
  }

  private roster(): StudentRef[] {
    const rows = this.students || [];
    const mapped: StudentRef[] = [];
    const seen: { [key: string]: boolean } = {};
    for (const row of rows) {
      if (!row) {
        continue;
      }
      const admNo = row.AdmNo != null ? String(row.AdmNo).trim() : '';
      const name = row.Name != null ? String(row.Name).trim() : '';
      const slNo = row.SlNo != null ? String(row.SlNo) : (row.SINo != null ? String(row.SINo) : '');
      const key = admNo.toLowerCase();
      if (!admNo || !name || seen[key]) {
        continue;
      }
      seen[key] = true;
      mapped.push({ slNo, admNo, name });
    }
    return mapped;
  }

  private shareText(): string {
    if (!this.active) {
      return '';
    }
    return this.active.exam + ' · ' + this.active.subject + ' (' + this.active.className + ')\n'
      + 'Upload your answer sheet between ' + formatWhen(this.active.opensAt) + ' and ' + formatWhen(this.active.closesAt) + '.';
  }

  private normalizedBase(): string {
    return (this.linkBase || window.location.origin).trim().replace(/\/$/, '');
  }

  private tokenFrom(value: string): string {
    const text = (value || '').trim();
    const match = /\/s\/([A-Za-z0-9_-]{8,80})/.exec(text);
    if (match) {
      return match[1];
    }
    if (/^[A-Za-z0-9_-]{8,80}$/.test(text)) {
      return text;
    }
    return '';
  }

  private fallbackCopy(link: string) {
    const area = document.createElement('textarea');
    area.value = link;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    this.notice = ok ? 'Link copied.' : 'Select the link and copy it.';
  }

  private readSaved(): StoredLink[] {
    try {
      const raw = localStorage.getItem('epv.answerLinks');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  private writeSaved() {
    try {
      localStorage.setItem('epv.answerLinks', JSON.stringify(this.saved));
    } catch (err) {
      this.error = 'This browser blocked local storage, so the management key may be lost if you reload.';
    }
  }
}
