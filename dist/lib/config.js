// --- SERP discovery ---
export const SERP_DEPTH = 100;
/** Max original SERP queries per discovery run */
export const MAX_ORIGINAL_QUERIES = 60;
// --- Scoring thresholds ---
export const SCORING_THRESHOLDS = {
    minAuthority: 15,
    maxAuthority: 95,
    minTraffic: 500,
    maxRounds: 10,
    maxReminders: 2,
    maxOutboundLinks: 50,
};
// --- Discovery config ---
/** Min prospects with status "prospect" before triggering runDiscovery() */
export const PIPELINE_MIN_THRESHOLD = 50;
/** Domains to never consider as competitors or prospects */
export const COMPETITOR_EXCLUSIONS = [
    // Own domain
    "protickets.com",
    // Marketplaces
    "amazon.com", "amazon.es", "amazon.com.mx",
    "mercadolibre.com", "mercadolibre.com.mx", "mercadolibre.com.ar", "mercadolibre.com.co",
    "ebay.com", "ebay.es",
    // Social media
    "facebook.com", "instagram.com", "twitter.com", "x.com",
    "youtube.com", "wikipedia.org", "reddit.com",
    "linkedin.com", "tiktok.com", "pinterest.com",
    // Ticket platforms and resellers (competitors, not prospects)
    "ticketmaster.com", "ticketmaster.es", "ticketmaster.com.mx",
    "stubhub.com", "stubhub.es",
    "viagogo.com", "viagogo.es",
    "seatgeek.com", "vividseats.com",
    "entradas.com", "taquilla.com",
    "eventbrite.com", "eventbrite.es",
    "livefootballtickets.com", "footballticketnet.es", "footballticketnet.com",
    "sportsevents365.es", "sportsevents365.com",
    "footballhost.com", "seatpick.com",
    "ticket-compare.es", "ticket-compare.com",
    "e-ticketplus.com", "ticombo.com",
    "hellotickets.es", "hellotickets.com",
    "monoticket.com", "biletwise.com",
    "madrid-tickets.net", "madrid-football-tickets.com",
    "footballticketsbarcelona.es", "footballticketsbarcelona.com",
    "entradafutbol.es", "mercaentradas.com",
    "ticket-time.es", "safeticketcompare.com",
    "bestevents.es", "eventradas.com",
    "atrapalo.com", "civitatis.com",
    // Major media (too big, won't respond)
    "marca.com", "as.com", "sport.es", "mundodeportivo.com",
    "elpais.com", "elmundo.es", "lavanguardia.com", "abc.es",
    "bbc.com", "bbc.co.uk", "cnn.com", "espn.com", "espn.com.ec",
    "goal.com", "bleacherreport.com", "nfl.com",
    "elespanol.com", "cronicaglobal.elespanol.com",
    "clarosports.com", "lne.es",
    // Stock photo / media libraries
    "gettyimages.com", "gettyimages.es", "gettyimages.fr", "gettyimages.nl",
    "shutterstock.com", "istockphoto.com", "alamy.com",
    // Academic / non-relevant
    "dialnet.unirioja.es", "todamateria.com",
    // Banks / telecom / corporate (never respond to link outreach)
    "caixabank.com", "bbva.com", "santander.com",
    "personal.com.ar", "tigo.com.co", "movistar.com",
    // Official league / team sites
    "laliga.com", "liga.net", "premierleague.com", "uefa.com", "fifa.com",
    "realmadrid.com", "fcbarcelona.com", "atleticodemadrid.com",
    // Google properties
    "google.com", "google.es", "google.com.mx",
];
// --- Wave-based outreach ---
/** Fixed wave sizes by wave number (wave 1 = calibration) */
export const WAVE_SIZES = { 1: 5 };
/** Default wave size for wave 2+ */
export const WAVE_SIZE_DEFAULT = 40;
/** Days after last send before observation period ends and next wave starts */
export const WAVE_OBSERVATION_DAYS = 7;
//# sourceMappingURL=config.js.map