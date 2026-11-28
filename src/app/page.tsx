import React from "react";
import type { Metadata } from "next";
import { HomeApp } from "@/src/components/home-app";

export const metadata: Metadata = { title: "Set up a paper" };

export default function Page() {
  return <HomeApp />;
}
