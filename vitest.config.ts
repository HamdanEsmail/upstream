import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // Fixed test values. They win over anything in .dev.vars, so tests
          // never see a real TinyFish key and never reach the network.
          TINYFISH_API_KEY: "test-tinyfish-key",
          TINYFISH_API_KEY_2: "test-tinyfish-key-2",
          ADMIN_TOKEN: "test-admin",
          // Room for exactly one paid deep search in tests.
          PAID_DEEP_BUDGET_USD: "2",
          PUBLIC_BASE_URL: "https://upstream.test",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});
