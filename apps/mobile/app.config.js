module.exports = ({ config }) => {
  const androidGoogleMapsKey =
    process.env.GOOGLE_MAPS_ANDROID_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const isEasBuild = process.env.EAS_BUILD === "true";

  if (isEasBuild && !androidGoogleMapsKey) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY must be configured in the selected EAS environment before building Android.",
    );
  }

  config.ios = config.ios || {};
  config.ios.config = {
    ...(config.ios.config || {}),
    usesNonExemptEncryption: false,
  };

  if (androidGoogleMapsKey) {
    config.android = config.android || {};
    config.android.config = {
      ...(config.android.config || {}),
      googleMaps: { apiKey: androidGoogleMapsKey },
    };
  }

  config.extra = {
    ...(config.extra || {}),
    // Never use this value to decide whether MapView can render. Secret EAS
    // variables are available to native builds but intentionally unavailable
    // to OTA JavaScript bundling, so that check produces a false negative.
    androidMapsNativeKeyInjected: Boolean(androidGoogleMapsKey),
  };

  return config;
};
