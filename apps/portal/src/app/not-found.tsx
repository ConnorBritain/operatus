import Link from "next/link";

export default function NotFound() {
  return (
    <main className="center-stage">
      <section className="paper-card narrow-card">
        <span className="eyebrow">Wrong corridor</span>
        <h1>That room is not here.</h1>
        <Link className="button primary" href="/">Return to the floor</Link>
      </section>
    </main>
  );
}
