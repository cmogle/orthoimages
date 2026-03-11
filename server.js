import { getApp } from "./app.js";

const PORT = process.env.PORT || 3000;
const app = await getApp();

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`OrthoRef running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
