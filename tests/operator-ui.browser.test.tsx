import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { LoginForm } from "@/components/login-form";
import { ManualRunForm } from "@/components/manual-run-form";

it("submits operator credentials and reports rejected authentication", async () => {
  const authenticate = vi
    .fn<(request: Request) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 401 }));
  render(<LoginForm authenticate={authenticate} onAuthenticated={vi.fn()} />);

  await page.getByLabelText("Username").fill("operator");
  await page.getByLabelText("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect.element(page.getByRole("alert")).toHaveTextContent(
    "The username or password is incorrect.",
  );
  expect(authenticate).toHaveBeenCalledOnce();
});

it("queues a scoped source refresh with an idempotency key", async () => {
  const queueJob = vi
    .fn<(request: Request) => Promise<Response>>()
    .mockResolvedValue(Response.json({ data: { id: "job-1" } }, { status: 202 }));
  render(<ManualRunForm queueJob={queueJob} />);

  await page.getByRole("combobox", { name: "Source" }).selectOptions("b2b");
  await page.getByLabelText("Artist scope").fill("The Midnight");
  await page.getByRole("button", { name: "Queue refresh" }).click();

  await expect.element(page.getByRole("status")).toHaveTextContent("Refresh queued");
  const request = queueJob.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  if (!request) throw new Error("Expected queued request");
  expect(await request.clone().json()).toEqual({ artist: "The Midnight", source: "b2b" });
  expect(request.headers.get("idempotency-key")).toMatch(/^manual-/);
});
