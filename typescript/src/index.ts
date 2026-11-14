/**
 * @hospify/org-sdk: Hospify for Organisations SOS inside your own app.
 *
 * In the app (browser, React Native):  import { Hospify } from "@hospify/org-sdk";
 * On your server:                      import { HospifyServer, verifyWebhook } from "@hospify/org-sdk/server";
 *
 * Docs: https://developers.hospify.africa
 */
export { Hospify, Sos, browserLocation } from "./client.js";
export type { HospifyOptions, LocationFix, LocationProvider, MeResult } from "./client.js";
export { HospifyError, SDK_VERSION } from "./http.js";
export * from "./types.js";
