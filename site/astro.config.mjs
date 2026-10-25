import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://unpacked.lockhart.in",
  trailingSlash: "always",
  integrations: [sitemap()],
  // Node binds "localhost" to ::1 only on some Windows setups, which leaves
  // http://127.0.0.1:4321 dead. Bind IPv4 explicitly; "localhost" still works.
  server: { host: "127.0.0.1" },
});
