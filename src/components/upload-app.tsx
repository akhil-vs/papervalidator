"use client";

import React, { useEffect, useState } from "react";
import { CodeForm } from "./code-form";
import { type ScriptPage } from "./script-panel";
import { UploadPanel } from "./upload-panel";
import { Banner, LoadingBlock } from "./ui";
import { apiBlob, apiJson } from "@/src/lib/browser";
import { normalizeCode } from "@/src/lib/format";
import type { PublicExam, StudentSession } from "@/src/lib/types";

const sessionKey = (token: string) => `paper-validator.session.${token}`;

export function UploadApp({ token }: { token: string }) {
  const [phase, setPhase] = useState<"loading" | "code" | "session" | "error">("loading");
  const [exam, setExam] = useState<PublicExam | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [session, setSession] = useState<StudentSession | null>(null);
  const [code, setCode] = useState("");
  const [pages, setPages] = useState<ScriptPage[]>([]);
  const [pagesState, setPagesState] = useState<"loading" | "empty" | "error" | "ready">("empty");
  const [pageError, setPageError] = useState("");
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiJson<PublicExam>(`/api/join/${token}`)
      .then((payload) => {
        if (cancelled) return;
        setExam(payload);
        const stored = sessionStorage.getItem(sessionKey(token)) ?? "";
        const fromHash = normalizeCode(window.location.hash.replace(/^#/, ""));
        const nextCode = fromHash.length === 8 ? fromHash : stored;
        if (nextCode.length === 8) {
          setCode(nextCode);
          void open(nextCode, "");
        } else setPhase("code");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "This upload link is not valid.");
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
    // open is stable enough for the first load; token changes remount the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function open(nextCode: string, studentId: string) {
    setPending(true);
    setError("");
    try {
      const payload = await apiJson<StudentSession>(`/api/join/${token}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: nextCode, studentId: studentId || undefined }),
      });
      sessionStorage.setItem(sessionKey(token), nextCode);
      setCode(nextCode);
      setSession(payload);
      setPhase("session");
    } catch (reason) {
      sessionStorage.removeItem(sessionKey(token));
      setError(reason instanceof Error ? reason.message : "That code could not be checked.");
      setPhase("code");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (!session || !code) return;
    let cancelled = false;
    const urls: string[] = [];
    if (session.pages.length === 0) {
      setPages([]);
      setPagesState("empty");
      return;
    }
    setPagesState("loading");
    void (async () => {
      try {
        const next: ScriptPage[] = [];
        for (const page of session.pages) {
          const file = await apiBlob(`/api/pages/${page.id}`, { headers: { "x-upload-code": code } });
          const url = URL.createObjectURL(file.blob);
          urls.push(url);
          next.push({ id: page.id, filename: page.filename, mime: page.mime, url });
        }
        if (!cancelled) {
          setPages(next);
          setPagesState("ready");
        }
      } catch (reason) {
        if (!cancelled) {
          setPagesState("error");
          setPageError(reason instanceof Error ? reason.message : "The uploaded pages could not be loaded.");
        }
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [session, code]);

  async function upload(files: File[], replace: boolean) {
    if (!session) return;
    setPending(true);
    setUploadError("");
    try {
      let latest = session;
      for (let index = 0; index < files.length; index += 1) {
        const body = new FormData();
        body.set("page", files[index]);
        const replaceThis = replace && index === 0;
        latest = await apiJson<StudentSession>(`/api/students/${session.student.id}/pages${replaceThis ? "?replace=1" : ""}`, {
          method: "POST",
          headers: { "x-upload-code": code },
          body,
        });
      }
      setSession(latest);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "The page could not be uploaded.");
    } finally {
      setPending(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="page">
        <LoadingBlock label="Opening the upload link…" />
      </div>
    );
  }

  if (phase === "error" || !exam) {
    return (
      <div className="page">
        <div className="card">
          <h1>Upload link</h1>
          <Banner tone="error">{error || "This upload link is not valid."}</Banner>
        </div>
      </div>
    );
  }

  return (
    <div className="page stack">
      <div>
        <h1>{exam.title}</h1>
        <p className="lede">
          {exam.className} · {exam.subject} · {exam.teacherName}
        </p>
      </div>
      {phase === "code" || !session ? (
        <CodeForm students={exam.students} pending={pending} formError={error} onSubmit={(nextCode, studentId) => void open(nextCode, studentId)} />
      ) : (
        <UploadPanel
          student={session.student}
          pages={pages}
          pagesState={pagesState}
          pageError={pageError}
          pending={pending}
          formError={uploadError}
          locked={Boolean(session.student.validatedAt)}
          onUpload={(files, replace) => void upload(files, replace)}
          onSignOut={() => {
            sessionStorage.removeItem(sessionKey(token));
            setSession(null);
            setCode("");
            setPhase("code");
            window.history.replaceState(null, "", `/s/${token}`);
          }}
        />
      )}
    </div>
  );
}
