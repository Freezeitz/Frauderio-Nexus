import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
let server;
if (process.env.START_TEST_SERVER) {
  server = spawn(
    "python",
    [
      "-m",
      "uvicorn",
      "backend.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8012",
    ],
    { cwd: "..", stdio: "inherit", env: process.env },
  );
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch("http://localhost:8012/api/health");
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
}
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const base = process.env.TEST_URL || "http://localhost:8000";
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Full name").fill("QA Analyst");
  await page.getByLabel("Work email").fill("qa-" + Date.now() + "@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Browser-test-1234");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("heading", { name: "Operations overview" }).waitFor();
  await page.locator("tbody tr").first().waitFor();
  await page.locator(".js-plotly-plot").first().waitFor();
  await page.screenshot({
    path: process.env.SCREENSHOT || "/tmp/frauderio-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await page.getByRole("heading", { name: "Decision factors" }).waitFor();
  await page.getByRole("button", { name: "Create case", exact: true }).click();
  await page
    .getByLabel("Note", { exact: true })
    .fill("Browser workflow verified.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByText("Browser workflow verified.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Networks", exact: true }).click();
  await page.locator(".network canvas").first().waitFor();
  await page
    .getByRole("heading", { name: "Shared-device communities" })
    .waitFor();
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await page.getByRole("heading", { name: "Model comparison" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Operations overview" }).waitFor();
  await page.locator("tbody tr").first().waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
    "Mobile page overflows",
  );
  await page.screenshot({
    path: process.env.MOBILE_SCREENSHOT || "/tmp/frauderio-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: registration, ledger, assessment, case notes, network, models, mobile and sign out.",
  );
} finally {
  await browser.close();
  server?.kill();
}
