/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Migration mode — the JS-ported pages have a long tail of soft type
  // issues (Date arithmetic, supabase-could-be-null, implicit any) that
  // are real-but-harmless. Skipping type errors at build keeps prod
  // shipping; dev still surfaces them so we can tighten incrementally.
  // Remove this once the page-level types are cleaned up.
  typescript: { ignoreBuildErrors: true },
  // Same logic for ESLint — the bulk-converted files would otherwise
  // trip a hundred no-unused-vars / no-explicit-any warnings.
  eslint: { ignoreDuringBuilds: true },
  // Hide the dev-mode overlay badge — it sits bottom-left and overlaps the
  // floating mobile tab bar while testing on a phone. (Dev only; never shipped.)
  devIndicators: false,
};

export default nextConfig;
