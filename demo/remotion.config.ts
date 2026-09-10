import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(94);
Config.setCodec("h264");
Config.setCrf(18);
Config.setPixelFormat("yuv420p");
// The downloaded Markdown summary is shown in the video as a document preview.
Config.overrideWebpackConfig((config) => ({
  ...config,
  module: { ...config.module, rules: [...(config.module?.rules ?? []), { test: /\.md$/, type: "asset/source" }] },
}));
