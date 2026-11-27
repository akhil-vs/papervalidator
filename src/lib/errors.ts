export class ExamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ExamError";
    this.status = status;
  }
}
