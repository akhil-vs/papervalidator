import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, TimeoutError, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  ApiFailure,
  ChunkGap,
  CreatedSession,
  MineStatus,
  PublicSession,
  RemoteSubmission
} from './models';

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    gaps?: ChunkGap[];
    completedAt?: string | null;
  };
}

const TERMINAL: { [code: string]: boolean } = {
  INVALID_LINK: true,
  WINDOW_CLOSED: true,
  UNKNOWN_STUDENT: true,
  ATTEMPT_LIMIT: true,
  TOO_LARGE: true,
  BAD_TYPE: true,
  EMPTY_FILE: true,
  BAD_REQUEST: true,
  UNAUTHORIZED: true
};

@Injectable({ providedIn: 'root' })
export class AnswerSheetApiService {
  constructor(private http: HttpClient) {}

  health(): Promise<{ ok: boolean; now: string }> {
    return this.send(this.http.get<{ ok: boolean; now: string }>(this.url('/health')), 4000);
  }

  createSession(body: unknown): Promise<CreatedSession> {
    return this.send(this.http.post<CreatedSession>(this.url('/sessions'), body), 30000);
  }

  getSession(token: string): Promise<PublicSession> {
    return this.send(this.http.get<PublicSession>(this.url('/sessions/' + encodeURIComponent(token))), 15000);
  }

  patchSession(token: string, manageKey: string, body: unknown): Promise<PublicSession> {
    return this.send(this.http.patch<PublicSession>(this.url('/sessions/' + encodeURIComponent(token)), body, {
      headers: this.manageHeaders(manageKey)
    }), 30000);
  }

  listSubmissions(token: string, manageKey: string): Promise<{ serverNow: string; submissions: RemoteSubmission[] }> {
    return this.send(this.http.get<{ serverNow: string; submissions: RemoteSubmission[] }>(
      this.url('/sessions/' + encodeURIComponent(token) + '/submissions'),
      { headers: this.manageHeaders(manageKey) }
    ), 15000);
  }

  mine(token: string, admNo: string, name: string): Promise<MineStatus> {
    const query = 'admNo=' + encodeURIComponent(admNo) + '&name=' + encodeURIComponent(name || 'student');
    return this.send(this.http.get<MineStatus>(this.url('/sessions/' + encodeURIComponent(token) + '/mine?' + query)), 15000);
  }

  createSubmission(token: string, body: unknown): Promise<{ submissionId: string; resumed: boolean; files: RemoteSubmission['files'] }> {
    return this.send(this.http.post<{ submissionId: string; resumed: boolean; files: RemoteSubmission['files'] }>(
      this.url('/sessions/' + encodeURIComponent(token) + '/submissions'),
      body
    ), 30000);
  }

  getSubmission(token: string, submissionId: string): Promise<RemoteSubmission> {
    return this.send(this.http.get<RemoteSubmission>(
      this.url('/sessions/' + encodeURIComponent(token) + '/submissions/' + encodeURIComponent(submissionId))
    ), 15000);
  }

  putChunk(
    token: string,
    submissionId: string,
    fileId: string,
    index: number,
    blob: Blob
  ): Promise<{ received: number[]; receivedBytes: number }> {
    return this.readBlob(blob).then(buffer => this.send(this.http.put<{ received: number[]; receivedBytes: number }>(
      this.url('/sessions/' + encodeURIComponent(token) + '/submissions/' + encodeURIComponent(submissionId)
        + '/files/' + encodeURIComponent(fileId) + '/chunks/' + index),
      buffer,
      { headers: new HttpHeaders({ 'Content-Type': 'application/octet-stream' }) }
    ), 25000));
  }

  completeSubmission(token: string, submissionId: string): Promise<RemoteSubmission> {
    return this.send(this.http.post<RemoteSubmission>(
      this.url('/sessions/' + encodeURIComponent(token) + '/submissions/' + encodeURIComponent(submissionId) + '/complete'),
      {}
    ), 30000);
  }

  discardSubmission(token: string, manageKey: string, submissionId: string): Promise<{ ok: boolean }> {
    return this.send(this.http.delete<{ ok: boolean }>(
      this.url('/sessions/' + encodeURIComponent(token) + '/submissions/' + encodeURIComponent(submissionId)),
      { headers: this.manageHeaders(manageKey) }
    ), 15000);
  }

  download(token: string, manageKey: string, submissionId: string, fileId: string): Promise<Blob> {
    return this.send(this.http.get(
      this.url('/sessions/' + encodeURIComponent(token) + '/submissions/' + encodeURIComponent(submissionId)
        + '/files/' + encodeURIComponent(fileId)),
      { headers: this.manageHeaders(manageKey), responseType: 'blob' }
    ), 60000);
  }

  asFailure(err: unknown): ApiFailure {
    if (err instanceof ApiFailure) {
      return err;
    }
    return this.mapError(err);
  }

  private send<T>(source: Observable<T>, ms: number): Promise<T> {
    return source.pipe(
      timeout(ms),
      catchError(err => throwError(this.mapError(err)))
    ).toPromise().then(value => {
      if (value === undefined) {
        throw new ApiFailure(0, 'NETWORK', 'The server sent an empty response. The upload will try again.', false);
      }
      return value;
    });
  }

  private manageHeaders(manageKey: string): HttpHeaders {
    return new HttpHeaders({ 'X-Manage-Key': manageKey });
  }

  private url(path: string): string {
    return environment.apiUrl + path;
  }

  private readBlob(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
          return;
        }
        reject(new ApiFailure(0, 'BAD_REQUEST', 'The file could not be read on this device. Choose it again.', true));
      };
      reader.onerror = () => {
        reject(new ApiFailure(0, 'BAD_REQUEST', 'The file could not be read on this device. Choose it again.', true));
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  private mapError(err: unknown): ApiFailure {
    if (err instanceof ApiFailure) {
      return err;
    }
    if (err instanceof TimeoutError) {
      return new ApiFailure(
        0,
        'TIMEOUT',
        'The server took too long to answer. This usually means the connection is weak. '
          + 'The part that already arrived is kept, and the upload will try again.',
        false
      );
    }
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new ApiFailure(
          0,
          'NETWORK',
          'The request did not reach the server. Check the connection. '
            + 'The file stays on this device and the upload continues when the network returns.',
          false
        );
      }
      const body = err.error as ErrorBody;
      if (body && body.error && typeof body.error === 'object') {
        const code = body.error.code || 'SERVER';
        const message = body.error.message || 'The server could not complete that request.';
        return new ApiFailure(err.status, code, message, !!TERMINAL[code], body.error.gaps, body.error.completedAt);
      }
      if (err.status === 401) {
        return new ApiFailure(401, 'UNAUTHORIZED', 'This browser does not have the management key for that link.', true);
      }
      if (err.status >= 500) {
        return new ApiFailure(
          err.status,
          'SERVER',
          'The upload service did not answer. The file stays on this device, and sending continues automatically.',
          false
        );
      }
      return new ApiFailure(err.status, 'SERVER', 'The server could not complete that request. The upload will try again.', false);
    }
    return new ApiFailure(
      0,
      'NETWORK',
      'The request did not reach the server. The file stays on this device and the upload continues when the network returns.',
      false
    );
  }
}
