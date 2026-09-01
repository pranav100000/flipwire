import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";

export const AppShell = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="app-shell">
    <header className="topbar">
      <Link aria-label="FlipWire dashboard" className="wordmark" href="/">
        <span className="wordmark-mark">FW</span>
        <span>FlipWire</span>
      </Link>
      <nav aria-label="Primary navigation">
        <Link href="/">Research</Link>
        <Link href="/operations">Operations</Link>
        <LogoutButton />
      </nav>
    </header>
    <main className="workspace">{children}</main>
  </div>
);
