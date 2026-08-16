import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="center-stage">
      <section className="paper-card narrow-card">
        <span className="eyebrow">Ventura identity</span>
        <h1>That sign-in did not finish.</h1>
        <p>The provider did not return a usable session. No machine access was granted.</p>
        <Link className="button primary" href="/">Try again</Link>
      </section>
    </main>
  );
}
