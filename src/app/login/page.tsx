import { LoginForm } from "@/components/login-form";

const LoginPage = () => (
  <main className="login-page">
    <section className="login-panel">
      <div className="login-brand">
        <span className="wordmark-mark">FW</span>
        <span>FlipWire</span>
      </div>
      <p className="eyebrow">Internal market research</p>
      <h1>One view of every ticket source.</h1>
      <p className="lede">
        Sign in to inspect canonical events, source listings, refresh health, and raw collection
        records.
      </p>
      <LoginForm />
    </section>
    <aside aria-label="Product description" className="login-aside">
      <p className="aside-index">Phase 01 / Unified pipeline</p>
      <div>
        <p className="aside-kicker">Research surface</p>
        <p className="aside-statement">
          Ticket Data context. TickPick and B2B inventory. No scoring, no buying automation.
        </p>
      </div>
      <p className="aside-footer">Restricted to FlipWire operators</p>
    </aside>
  </main>
);

export default LoginPage;
