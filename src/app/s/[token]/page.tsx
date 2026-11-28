import React from "react";
import type { Metadata } from "next";
import { UploadApp } from "@/src/components/upload-app";

export const metadata: Metadata = { title: "Upload a script" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <UploadApp token={token} />;
}
