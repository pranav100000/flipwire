"use client";

import { useState } from "react";

export const LogoutButton = () => {
  const [pending, setPending] = useState(false);
  return (
    <button
      className="nav-action"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch("/api/auth/session", { method: "DELETE" });
        window.location.replace("/login");
      }}
      type="button"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
};
