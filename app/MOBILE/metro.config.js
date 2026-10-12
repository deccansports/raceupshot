const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /(^|[/\\])\._[^/\\]*$/,
  /(^|[/\\])\.__[^/\\]*$/,
];

module.exports = config;
