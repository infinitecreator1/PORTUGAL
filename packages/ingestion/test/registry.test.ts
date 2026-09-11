import { loadConfig } from "@imovel/core";
import { describe, expect, it } from "vitest";
import { CasafariSource } from "../src/adapters/casafari";
import { CsvFeedSource, XmlFeedSource } from "../src/adapters/csvFeed";
import { IdealistaOfficialSource } from "../src/adapters/idealistaOfficial";
import { IdealistaPiloterrSource } from "../src/adapters/idealistaPiloterr";
import { ImovirtualParsebotSource } from "../src/adapters/imovirtualParsebot";
import { createListingSource } from "../src/registry";

const baseCfg = loadConfig({ NODE_ENV: "test" });

describe("createListingSource", () => {
  it("builds the feed sources with no key required", () => {
    expect(createListingSource("csv-feed", baseCfg)).toBeInstanceOf(CsvFeedSource);
    expect(createListingSource("xml-feed", baseCfg)).toBeInstanceOf(XmlFeedSource);
  });

  it("builds imovirtual-parsebot when PARSEBOT_API_KEY is set, else throws", () => {
    expect(() => createListingSource("imovirtual-parsebot", baseCfg)).toThrow(/PARSEBOT_API_KEY/);
    const cfg = loadConfig({ NODE_ENV: "test", PARSEBOT_API_KEY: "k" });
    expect(createListingSource("imovirtual-parsebot", cfg)).toBeInstanceOf(ImovirtualParsebotSource);
  });

  it("builds idealista-piloterr when PILOTERR_API_KEY is set, else throws", () => {
    expect(() => createListingSource("idealista-piloterr", baseCfg)).toThrow(/PILOTERR_API_KEY/);
    const cfg = loadConfig({ NODE_ENV: "test", PILOTERR_API_KEY: "k" });
    expect(createListingSource("idealista-piloterr", cfg)).toBeInstanceOf(IdealistaPiloterrSource);
  });

  it("builds casafari when CASAFARI_API_KEY is set, else throws", () => {
    expect(() => createListingSource("casafari", baseCfg)).toThrow(/CASAFARI_API_KEY/);
    const cfg = loadConfig({ NODE_ENV: "test", CASAFARI_API_KEY: "k" });
    expect(createListingSource("casafari", cfg)).toBeInstanceOf(CasafariSource);
  });

  it("builds idealista-official only when deps.idealistaOfficial credentials are given", () => {
    expect(() => createListingSource("idealista-official", baseCfg)).toThrow(/idealista-official/);
    const source = createListingSource("idealista-official", baseCfg, {
      idealistaOfficial: { apiKey: "k", apiSecret: "s" },
    });
    expect(source).toBeInstanceOf(IdealistaOfficialSource);
  });

  it("throws for source ids with no adapter registered", () => {
    expect(() => createListingSource("idealista-parsebot", baseCfg)).toThrow(/no ListingSource adapter/);
    expect(() => createListingSource("api", baseCfg)).toThrow(/no ListingSource adapter/);
  });
});
