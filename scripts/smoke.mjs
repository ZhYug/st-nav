import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const worker = read("public/_worker.js");
const admin = read("public/assets/admin.js");
const html = read("public/admin.html");
const pkg = JSON.parse(read("package.json"));

const checks = [
  [pkg.version === "1.2.2", "package version is 1.2.2"],
  [worker.includes('const VERSION = "1.2.2"'), "worker version is 1.2.2"],
  [worker.includes('/api/admin/links/export'), "full CSV export endpoint exists"],
  [worker.includes('text/csv'), "server-side CSV import exists"],
  [worker.includes('/api/admin/navigation/normalize'), "navigation normalize endpoint exists"],
  [worker.includes('data.all === true'), "bulk all-results operation exists"],
  [admin.includes('/api/admin/links/export?q='), "admin uses server-side export"],
  [admin.includes('"Content-Type": "text/csv;charset=utf-8"'), "admin uploads raw CSV"],
  [admin.includes('id="selectAllNavResults"') || html.includes('id="selectAllNavResults"'), "all-results selection control exists"],
  [html.match(/qrcodejs\/1\.0\.0\/qrcode\.min\.js/g)?.length === 1, "QR dependency is included once"],
  [!/onerror\s*=/.test(html + admin), "no inline onerror handlers"],
];
for (const [ok, label] of checks) {
  if (!ok) throw new Error(`smoke check failed: ${label}`);
}
console.log(`✓ smoke tests passed (v${pkg.version})`);
