// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { defineConfig } from "vitest/config";

export default defineConfig({
  // CI machines are a few times slower than a dev laptop
  test: { include: ["tests/unit/**/*.test.ts"], testTimeout: 60_000 },
});
