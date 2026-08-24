const { test } = require("playwright/test");

test("authenticated WNBA showdown lineup generation", async ({ page }) => {
  test.setTimeout(120000);
  const events = [];
  let generateResponse;
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) events.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => events.push({ type: "pageerror", text: error.message }));
  page.on("response", async (response) => {
    if (response.url().includes("/api/generate")) {
      generateResponse = { status: response.status(), body: await response.text() };
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:3015/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /sign in to continue/i }).click();
  await page.getByLabel("Email").fill("jasmine@demo.com");
  await page.getByLabel("Password").fill("Test1234!");
  await page.getByRole("button", { name: /^sign in/i }).last().click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "WNBA", exact: true }).click();
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: "Showdown", exact: true }).click();
  await page.waitForTimeout(8000);
  await page.locator(".contest-card").filter({ hasText: "WNBA Showdown $5K Fadeaway [$1K to 1st] (GSV @ MIN)" }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /build lines/i }).click();
  await page.waitForTimeout(15000);
  await page.screenshot({ path: "/tmp/floyd-dfs-wnba-showdown-generated-success.png", fullPage: true });
  const bodyText = await page.locator("body").innerText();
  console.log(JSON.stringify({ url: page.url(), selectedContest: bodyText.includes("WNBA Showdown $5K Fadeaway [$1K to 1st] (GSV @ MIN)"), hasGenerated: bodyText.includes("Generated lines") || bodyText.includes("Your lines"), generateResponse, events }, null, 2));
});
