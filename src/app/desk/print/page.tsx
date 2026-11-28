import React, { Suspense } from "react";
import type { Metadata } from "next";
import { PrintApp } from "@/src/components/print-app";

export const metadata: Metadata = { title: "Validation sheet" };

export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading the sheet…</p>}>
      <PrintApp />
    </Suspense>
  );
}
