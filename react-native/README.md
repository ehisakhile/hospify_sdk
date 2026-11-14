# @hospify/org-sdk-react-native

Hospify for Organisations SOS in React Native and Expo apps. See https://developers.hospify.africa/docs/react-native

```ts
import * as Location from "expo-location";
import { Hospify, expoLocation, useHospifySos } from "@hospify/org-sdk-react-native";

const hospify = Hospify.start({ publishableKey: "hpk_test_...", getToken: api.hospifyToken, location: expoLocation(Location) });

function SosButton() {
  const { isOpen, start, safe, busy, state } = useHospifySos(hospify);
  // hold to start, show state?.responder when someone picks it up
}
```
