import { getApp } from "../app.js";

function rebuildUrl(req) {
  const currentUrl = new URL(req.url, `https://${req.headers.host}`);
  const pathname = currentUrl.searchParams.get("__pathname");

  if (!pathname) {
    return;
  }

  currentUrl.searchParams.delete("__pathname");
  const search = currentUrl.searchParams.toString();
  req.url = `${pathname}${search ? `?${search}` : ""}`;
}

export default async function handler(req, res) {
  rebuildUrl(req);
  const app = await getApp();
  await app.ready();
  app.server.emit("request", req, res);
}
