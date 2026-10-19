import { expect, test } from "@playwright/test";

test("无 vault 参数时首页能加载", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Live 观演记录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "选择文件" })).toBeVisible();
});

test("vault 输入错误密码时提示密码不对", async ({ page }) => {
  await page.goto("/?vault=tests/fixtures/vault-test.json");

  await expect(page.getByRole("heading", { name: "输入密码" })).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill("definitely-not-the-password");
  await page.getByRole("button", { name: "打开" }).click();

  await expect(page.locator("#vault-error")).toHaveText("密码不对");
});
