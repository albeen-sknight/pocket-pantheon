// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import en from "../../data/text/en.json";
import es from "../../data/text/es.json";
import { pickLang } from "../../src/ui/i18n";

describe("text files", () => {
  it("have the same pages and keys in both languages", () => {
    for (const page of Object.keys(en) as (keyof typeof en)[]) {
      expect(Object.keys(es[page]).sort()).toEqual(Object.keys(en[page]).sort());
    }
  });
});

describe("pickLang", () => {
  it("prefers a saved choice", () => {
    expect(pickLang("es", "en-US")).toBe("es");
  });

  it("falls back to the browser language", () => {
    expect(pickLang(null, "es-ES")).toBe("es");
    expect(pickLang(null, "es")).toBe("es");
    expect(pickLang("fr", "en-GB")).toBe("en");
    expect(pickLang(null, "estonian")).toBe("en");
  });
});
