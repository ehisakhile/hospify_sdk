# Hospify SDKs

Hospify for Organisations inside your own app: an SOS button for your field agents, their live
location while they're in danger, and an escalation chain that reaches the right people. Your app,
your users, your database. Docs: https://developers.hospify.africa

| Package | For | Folder |
|---|---|---|
| `@hospify/org-sdk` | Web apps and your server (Node 18+, Deno, Bun, edge): `@hospify/org-sdk/server` | `typescript/` |
| `@hospify/org-sdk-react-native` | React Native and Expo apps | `react-native/` |
| `hospify_org_sdk` | Flutter apps | `flutter/` |

## How it fits together

1. **Your server** registers agents with your secret key (`hsk_...`) and gives the app a one hour session token for the signed-in agent.
2. **Your app** starts the SDK with your publishable key (`hpk_...`) and a function that fetches that token. The agent holds SOS.
3. **Hospify** runs the emergency: live location, the Live SOS Board, escalation from supervisors to every admin.
4. **Back to you**: signed webhooks and an event feed, so your own system has every event. Your back office can acknowledge and resolve through the API.

Test keys (`_test_`) work from the start and alert no one. Live keys unlock once your business verification (KYB) is approved.

## Develop

```bash
# TypeScript (web and server)
cd typescript && npm install && npm test

# React Native
cd react-native && npm install && npm test

# Flutter
cd flutter && flutter pub get && flutter analyze && flutter test
```

### End to end against the real API

`hospify_api` serves a local copy of the Org API on SQLite, with nothing outbound:

```bash
cd ../hospify_api && .venv/bin/python -m tests.sdk_contract_server 8765   # prints the test keys as JSON
# in another terminal, with that JSON:
cd typescript && node e2e/flow.mjs '<keys json>'
cd flutter && HOSPIFY_E2E='<keys json>' flutter test e2e/flow_test.dart
```
