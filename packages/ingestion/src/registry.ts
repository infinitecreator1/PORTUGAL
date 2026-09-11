import type { Config, ListingSource, SourceId } from "@imovel/core";
import { ValidationError } from "@imovel/core";
import { CasafariSource } from "./adapters/casafari";
import { CsvFeedSource, XmlFeedSource } from "./adapters/csvFeed";
import { IdealistaOfficialSource } from "./adapters/idealistaOfficial";
import { IdealistaPiloterrSource } from "./adapters/idealistaPiloterr";
import { ImovirtualParsebotSource } from "./adapters/imovirtualParsebot";

export interface ListingSourceDeps {
  fetch?: typeof fetch;
  /**
   * `idealista-official` credentials. `@imovel/core`'s `Config` has no `IDEALISTA_API_KEY` /
   * `IDEALISTA_API_SECRET` field yet (see the ingestion package's final report for the suggested
   * core change); pass them here until it does.
   */
  idealistaOfficial?: { apiKey: string; apiSecret: string; baseUrl?: string };
}

/**
 * Instantiates the `ListingSource` adapter registered for `id` from config and (for sources whose
 * key does not yet live in `@imovel/core`'s `Config`) `deps`. Throws `ValidationError` when a
 * required key is missing, and for source ids with no adapter in this package yet
 * (`idealista-parsebot`, `api`).
 */
export function createListingSource(id: SourceId, cfg: Config, deps: ListingSourceDeps = {}): ListingSource {
  switch (id) {
    case "csv-feed":
      return new CsvFeedSource();

    case "xml-feed":
      return new XmlFeedSource();

    case "imovirtual-parsebot":
      if (!cfg.PARSEBOT_API_KEY) {
        throw new ValidationError("PARSEBOT_API_KEY is required for source 'imovirtual-parsebot'");
      }
      return new ImovirtualParsebotSource({ apiKey: cfg.PARSEBOT_API_KEY, fetch: deps.fetch });

    case "idealista-piloterr":
      if (!cfg.PILOTERR_API_KEY) {
        throw new ValidationError("PILOTERR_API_KEY is required for source 'idealista-piloterr'");
      }
      return new IdealistaPiloterrSource({ apiKey: cfg.PILOTERR_API_KEY, fetch: deps.fetch });

    case "casafari":
      if (!cfg.CASAFARI_API_KEY) {
        throw new ValidationError("CASAFARI_API_KEY is required for source 'casafari'");
      }
      return new CasafariSource({ apiKey: cfg.CASAFARI_API_KEY, baseUrl: cfg.CASAFARI_BASE_URL, fetch: deps.fetch });

    case "idealista-official": {
      const creds = deps.idealistaOfficial;
      if (!creds?.apiKey || !creds?.apiSecret) {
        throw new ValidationError(
          "idealista-official requires apiKey and apiSecret; pass deps.idealistaOfficial (@imovel/core Config has no IDEALISTA_API_KEY/IDEALISTA_API_SECRET yet)",
        );
      }
      return new IdealistaOfficialSource({
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        baseUrl: creds.baseUrl,
        fetch: deps.fetch,
      });
    }

    default:
      throw new ValidationError(`no ListingSource adapter registered for '${id}'`);
  }
}
