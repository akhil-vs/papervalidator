import React from "react";
import type { Metadata } from "next";
import { DeskApp } from "@/src/components/desk-app";

export const metadata: Metadata = { title: "Marking desk" };

export default function Page() {
  return <DeskApp />;
}
