import { formatMessage, type Translate } from "./localize.js";

// A test translator standing in for a translation bundle: it upper-cases the
// message (so "{0} turns" becomes "{0} TURNS") and then fills in the
// arguments, which keep their case. A test can then tell a string that went
// through the Localize seam from a hard-coded one, and data (a session title,
// a model name) from text.
export const upperCaseTranslate: Translate = (message, ...args) => formatMessage(message.toUpperCase(), args);
