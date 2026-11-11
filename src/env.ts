// The Worker's bindings and secrets.
export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** My main TinyFish account. */
  TINYFISH_API_KEY: string;
  /** My second TinyFish account; its free research runs are used after the first account's. */
  TINYFISH_API_KEY_2?: string;
  ADMIN_TOKEN: string;
  PUBLIC_BASE_URL: string;
};
