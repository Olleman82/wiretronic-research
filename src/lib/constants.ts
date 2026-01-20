export const VENDOR_DOMAINS = [
  "se.farnell.com",
  "se.rs-online.com",
  "www.digikey.se",
  "www.tti.com",
  "www.onlinecomponents.com",
  "www.mouser.se",
  "nexelec.com",
  "www.arrow.com",
  "www.auto-click.co.uk",
  "www.automotiveconnectors.com",
  "www.automotive-connectors.com"
];

export const DEFAULT_PROMPT = `Jag vill ha hjälp med att hitta bästa pris för den här artikeln. Leta hos samtliga leverantörer listade nedan. Svara i en tabell med ledtid, pris, Lagerstatus, samt leverantörens namn och länk till där artikeln kan köpas. Vi vill köpa från svenska, eller europeiska siter. Sortera tabellen utifrån pris, lägsta pris först. Många leverantörer har stafflade priser, se till att du kollar rätt pris. Ibland är nästa nivå i stafflingen så mycket billigare så att det är värt att köpa fler. Informera om detta isåfall! En del har också MOQ- se till att informera användaren om det om det påverkar den volymen de ska köpa.

Sök på dessa leverantörers hemsida:
https://se.farnell.com/
https://se.rs-online.com/web/
https://www.digikey.se/
https://www.tti.com/
https://www.onlinecomponents.com/
https://www.mouser.se/
https://nexelec.com/
https://www.arrow.com/
https://www.auto-click.co.uk/
https://www.automotiveconnectors.com/
https://www.automotive-connectors.com/`;

export const DEFAULT_REASONING_EFFORT = "medium" as const;
export const DEFAULT_PRICE_MODE = "total" as const;
