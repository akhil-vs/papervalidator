export type FieldError = {
  pointer?: string;
  detail: string;
};

export class ValidationFailed extends Error {
  readonly fieldErrors: FieldError[];

  constructor(fieldErrors: FieldError[]) {
    super(fieldErrors[0]?.detail ?? 'Request is invalid.');
    this.name = 'ValidationFailed';
    this.fieldErrors = fieldErrors;
  }
}

export class Unauthorized extends Error {
  constructor(message = 'Bearer token is missing or invalid.') {
    super(message);
    this.name = 'Unauthorized';
  }
}

export class MethodNotAllowed extends Error {
  readonly allow: string;

  constructor(allow: string) {
    super(`Use ${allow}.`);
    this.name = 'MethodNotAllowed';
    this.allow = allow;
  }
}

export class AccessDenied extends Error {
  constructor(message = 'This account is not a teacher of the school.') {
    super(message);
    this.name = 'AccessDenied';
  }
}

export class NotFound extends Error {
  constructor(message = 'Teacher was not found.') {
    super(message);
    this.name = 'NotFound';
  }
}

export class EmailAlreadyUsed extends Error {
  constructor() {
    super('A teacher with this email already exists.');
    this.name = 'EmailAlreadyUsed';
  }
}
