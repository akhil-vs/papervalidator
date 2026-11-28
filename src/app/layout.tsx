import React from "react";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Paper Validator", template: "%s · Paper Validator" },
  description: "Collect handwritten scripts, mark a class, and download the mark list.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="topbar">
          <a className="brand" href="/">
            Paper Validator
          </a>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
