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
    // Keep residente.io navigations INSIDE the WebView. Because server.url has a
    // path (/login), Capacitor otherwise treated hard window.location navigations
    // to other residente.io paths as external and punted them to Safari (e.g.
    // the post-signup redirect, sign-out, admin step-down). Whitelisting the host
    // keeps them in-app. Stripe/checkout (different host) still opens externally.
    allowNavigation: ['residente.io', '*.residente.io'],
  },
  plugins: {
    PushNotifications: {
      // Show the banner/sound/badge even while the app is in the foreground
      // (iOS suppresses foreground pushes by default).
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
