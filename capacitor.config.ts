import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.myfirstghostgamesocilet.com",
  appName: "Black Mirror Forest",
  webDir: "dist/mobile",
  android: {
    allowMixedContent: true,
  },
};

export default config;
