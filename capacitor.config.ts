import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.residente.app',
  appName: 'Residente',
  webDir: 'public',
  server: {
    // Native app opens at the sign-in screen (which auto-redirects logged-in
    // users to /app) rather than the public marketing landing.
    // Switch to https://residente.com when you cut over the domain.
    url: 'https://residente.io/login',
    cleartext: false,
  },
};

export default config;
