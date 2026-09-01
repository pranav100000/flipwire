"use client";

import { useState } from "react";

type Authenticate = (request: Request) => Promise<Response>;

export const LoginForm = ({
  authenticate = fetch,
  onAuthenticated,
}: Readonly<{ authenticate?: Authenticate; onAuthenticated?: () => void }>) => {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (formData: FormData) => {
    setPending(true);
    setError("");
    try {
      const response = await authenticate(
        new Request("/api/auth/session", {
          body: JSON.stringify({
            password: String(formData.get("password") ?? ""),
            username: String(formData.get("username") ?? ""),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      if (!response.ok) {
        setError("The username or password is incorrect.");
        return;
      }
      if (onAuthenticated) onAuthenticated();
      else window.location.replace("/");
    } catch {
      setError("FlipWire could not reach the server. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form action={submit} className="auth-form">
      <label>
        <span>Username</span>
        <input autoComplete="username" name="username" required />
      </label>
      <label>
        <span>Password</span>
        <input autoComplete="current-password" name="password" required type="password" />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={pending} type="submit">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
};
