export function browserSettings(platform = process.platform) {
  if (platform === "win32") return { name: "Microsoft Edge", launch: { channel: "msedge" } };
  if (platform === "darwin") return { name: "Playwright Chromium", launch: {} };
  throw new Error(`Browser automation is configured for Windows and macOS, not ${platform}. No browser was substituted.`);
}
