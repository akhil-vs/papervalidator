export type Question = {
  id: string;
  position: number;
  label: string;
  maxMarks: number;
};

export type PageInfo = {
  id: string;
  position: number;
  filename: string;
  mime: string;
};

export type MarkCell = {
  questionId: string;
  awarded: number | null;
  comment: string;
};

export type DeskStudent = {
  id: string;
  rollNo: string;
  name: string;
  uploadCode: string;
  absent: boolean;
  validatedAt: string | null;
  note: string;
  pages: PageInfo[];
  marks: MarkCell[];
};

export type DeskExam = {
  id: string;
  title: string;
  className: string;
  subject: string;
  teacherName: string;
  studentToken: string;
  createdAt: string;
};

export type DeskPayload = {
  exam: DeskExam;
  questions: Question[];
  students: DeskStudent[];
};

export type PublicExam = {
  title: string;
  className: string;
  subject: string;
  teacherName: string;
  students: { id: string; rollNo: string; name: string }[];
};

export type StudentSession = {
  student: {
    id: string;
    rollNo: string;
    name: string;
    absent: boolean;
    validatedAt: string | null;
  };
  pages: PageInfo[];
};

export type CreatedExam = {
  teacherKey: string;
  studentToken: string;
  title: string;
  className: string;
  subject: string;
  teacherName: string;
  studentCount: number;
  questionCount: number;
};

export type StoredPage = {
  mime: string;
  filename: string;
  bytes: Uint8Array;
};
