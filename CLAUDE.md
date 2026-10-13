# Pocket Pantheon
Read docs/PLAN.md before any work. It is the source of truth. docs/preview.html is the visual target.
Work one phase at a time (PLAN section 21). Open one pull request per phase.
All player text goes in data/text/en.json and data/text/es.json. Never hardcode strings.
No em dashes, en dashes or hyphens in player text (PLAN section 25).
Write code to the coding prompt in PLAN section 26, matching docs/STYLE_REFERENCE.md.
Keep the project signature: boot log, generator meta, save metadata, pp prefix, one line file header.
Simulation code is deterministic: seeded random only, no Math.random.
Commands: npm run dev, npm run build, npm test, npm run lint:text, npm run test:e2e
