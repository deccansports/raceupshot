const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const defaultResolveRequest = config.resolver.resolveRequest;
const appleDoubleFiles = /[\\/]\._[^\\/]+$/;
const existingBlockList = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList
  : config.resolver.blockList
    ? [config.resolver.blockList]
    : [];

// External macOS volumes can recreate AppleDouble resource-fork files while
// Metro is already watching. They are metadata, never application routes.
config.resolver.blockList = [...existingBlockList, appleDoubleFiles];

// The shared timing package publishes NodeNext TypeScript source with explicit
// `.js` imports. Metro needs to resolve those specifiers to sibling `.ts` files.
// Keep the fallback scoped to that package so other modules use Expo defaults.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isTimingPackageSource = /[\\/]@race-technology[\\/]timing-calculations[\\/]src[\\/]/.test(
    context.originModulePath,
  );
  if (isTimingPackageSource && moduleName.endsWith(".js")) {
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
