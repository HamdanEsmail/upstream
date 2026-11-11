import { describe, expect, it } from "vitest";
import panelCss from "../extension/line.css?raw";
import manifest from "../extension/manifest.json";
import config from "../extension/config.js?raw";
import siteCss from "../public/assets/line.css?raw";
import wrangler from "../wrangler.jsonc?raw";

const base = /"PUBLIC_BASE_URL":\s*"([^"]+)"/.exec(wrangler)?.[1] ?? "";

describe("the extension", () => {
  it("carries the same stylesheet as the site", () => {
    expect(panelCss).toBe(siteCss);
  });

  it("asks for no more than it needs", () => {
    expect([...manifest.permissions].sort()).toEqual(["activeTab", "contextMenus", "scripting", "sidePanel", "storage"]);
    expect(manifest.host_permissions).toEqual([`${base}/*`]);
    expect(manifest).not.toHaveProperty("content_scripts");
  });

  it("talks to the address the service is deployed at", () => {
    expect(base).toMatch(/^https:\/\//);
    expect(config).toContain(`"${base}"`);
  });
});
