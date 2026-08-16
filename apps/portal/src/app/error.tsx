"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="center-stage">
      <section className="paper-card narrow-card">
        <span className="eyebrow">The studio paused</span>
        <h1>Something went wrong.</h1>
        <p>No command was assumed successful. Try loading the current state again.</p>
        <button className="button primary" onClick={reset}>Reload the studio</button>
      </section>
    </main>
  );
}
