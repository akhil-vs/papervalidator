import type { FieldError } from './errors.js';

export function passwordError(password: string, email: string): FieldError | null {
  if (password.length < 12 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { pointer: '/password', detail: 'Password must be 12 to 128 characters and include a letter and a number.' };
  }
  if (/[\u0000-\u001f\u007f]/.test(password)) {
    return { pointer: '/password', detail: 'Password cannot include control characters.' };
  }
  if (password.toLocaleLowerCase('en') === email.toLocaleLowerCase('en')) {
    return { pointer: '/password', detail: 'Password must not match the email.' };
  }
  return null;
}
