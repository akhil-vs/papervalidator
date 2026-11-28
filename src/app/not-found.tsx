import React from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <section className="page narrow">
      <div className="card">
        <h1>This page is not available</h1>
        <p>Check the link, or go back to the home page to open a paper.</p>
        <a className="button button-primary" href="/">
          Back to Paper Validator
        </a>
      </div>
    </section>
  );
}
