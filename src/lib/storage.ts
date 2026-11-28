export type SavedDesk = {
  title: string;
  className: string;
  subject: string;
  teacherKey: string;
  studentToken: string;
  createdAt: string;
};

const DESKS = "paper-validator.desks";
const ACTIVE = "paper-validator.active";

export function readDesks(): SavedDesk[] {
  try {
    const raw = localStorage.getItem(DESKS);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedDesk => {
      if (!item || typeof item !== "object") return false;
      const desk = item as Partial<SavedDesk>;
      return typeof desk.teacherKey === "string" && typeof desk.title === "string" && typeof desk.studentToken === "string";
    });
  } catch {
    return [];
  }
}

export function rememberDesk(desk: SavedDesk) {
  const next = [desk, ...readDesks().filter((item) => item.teacherKey !== desk.teacherKey)].slice(0, 12);
  localStorage.setItem(DESKS, JSON.stringify(next));
  sessionStorage.setItem(ACTIVE, desk.teacherKey);
}

export function readActiveKey(): string {
  try {
    return sessionStorage.getItem(ACTIVE) ?? "";
  } catch {
    return "";
  }
}

export function writeActiveKey(key: string) {
  sessionStorage.setItem(ACTIVE, key);
}

export function clearActiveKey() {
  sessionStorage.removeItem(ACTIVE);
}
