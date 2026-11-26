export class ApiFailure extends Error {
  status: number;
  code: string;
  terminal: boolean;
  gaps: ChunkGap[];
  completedAt: string | null;

  constructor(status: number, code: string, message: string, terminal: boolean, gaps?: ChunkGap[], completedAt?: string | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.terminal = terminal;
    this.gaps = gaps || [];
    this.completedAt = completedAt == null ? null : completedAt;
    Object.setPrototypeOf(this, ApiFailure.prototype);
  }
}

export interface ChunkGap {
  fileId: string;
  missing: number[];
}

export interface StudentRef {
  slNo: string;
  admNo: string;
  name: string;
}

export interface PublicSession {
  className: string;
  exam: string;
  subject: string;
  teacher: string;
  opensAt: string;
  closesAt: string;
  graceMinutes: number;
  instructions: string;
  maxFileBytes: number;
  maxAttempts: number;
  maxFiles: number;
  students: StudentRef[];
  phase: 'scheduled' | 'open' | 'closed';
  serverNow: string;
}

export interface CreatedSession {
  token: string;
  manageKey: string;
  opensAt: string;
  closesAt: string;
  graceMinutes: number;
  phase: 'scheduled' | 'open' | 'closed';
  serverNow: string;
}

export interface RemoteFile {
  fileId: string;
  fileName: string;
  mime: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  received: number[];
  receivedBytes: number;
  status: string;
  updatedAt: string | null;
}

export interface RemoteSubmission {
  submissionId: string;
  admNo: string;
  name: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  files: RemoteFile[];
}

export interface MineStatus {
  admNo: string;
  name: string;
  completeCount: number;
  maxAttempts: number;
  lastCompletedAt: string | null;
  inProgress: boolean;
  serverNow: string;
}

export interface StoredFile {
  fileName: string;
  mime: string;
  size: number;
  blob: Blob;
  fileId: string | null;
  chunkSize: number;
  totalChunks: number;
  received: number[];
}

export interface PendingUpload {
  localId: string;
  token: string;
  admNo: string;
  name: string;
  submissionId: string | null;
  files: StoredFile[];
  persisted: boolean;
  updatedAt: number;
}

export interface FileProgress {
  fileName: string;
  size: number;
  receivedBytes: number;
  status: string;
}

export interface UploadSnapshot {
  phase: 'idle' | 'uploading' | 'paused' | 'attention' | 'complete' | 'blocked';
  title: string;
  message: string;
  percent: number;
  files: FileProgress[];
  canRetry: boolean;
  canChooseFile: boolean;
  canDownloadLocal: boolean;
  persisted: boolean;
  completedAt: string | null;
}

export interface StoredLink {
  token: string;
  manageKey: string;
  className: string;
  exam: string;
  subject: string;
  teacher: string;
  opensAt: string;
  closesAt: string;
  linkBase: string;
  createdAt: string;
}

export function idleSnapshot(): UploadSnapshot {
  return {
    phase: 'idle',
    title: '',
    message: '',
    percent: 0,
    files: [],
    canRetry: false,
    canChooseFile: true,
    canDownloadLocal: false,
    persisted: true,
    completedAt: null
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return bytes + ' B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function toLocalInput(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

export function countdown(targetMs: number, nowMs: number): string {
  const total = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (hours > 0) {
    return hours + 'h ' + pad(minutes) + 'm ' + pad(seconds) + 's';
  }
  return pad(minutes) + 'm ' + pad(seconds) + 's';
}

export function tokenOk(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

export function backoffMs(failures: number): number {
  const step = Math.min(Math.max(failures, 1), 6);
  return Math.min(30000, 1000 * Math.pow(2, step - 1));
}
