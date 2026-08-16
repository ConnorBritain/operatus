"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function social(provider: "google" | "github") {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/`;
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) {
      setMessage(error.message);
      setBusy(false);
    }
  }

  async function emailLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/` },
    });
    setMessage(error ? error.message : "Check your inbox for a secure sign-in link.");
    setBusy(false);
  }

  return (
    <div className="auth-stack">
      <div className="social-row">
        <button className="button provider" disabled={busy} onClick={() => social("google")}>
          <span className="provider-mark">G</span> Continue with Google
        </button>
        <button className="button provider" disabled={busy} onClick={() => social("github")}>
          <span className="provider-mark">GH</span> Continue with GitHub
        </button>
      </div>
      <div className="divider"><span>or use email</span></div>
      <form className="email-form" onSubmit={emailLink}>
        <label htmlFor="email">Email address</label>
        <div className="inline-form">
          <input id="email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" />
          <button className="button primary" disabled={busy} type="submit">Send link</button>
        </div>
      </form>
      {message ? <p className="form-message" role="status">{message}</p> : null}
    </div>
  );
}
