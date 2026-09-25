const fs = require('fs');
let v = fs.readFileSync('scripts/validate-data.mjs', 'utf8');
if (!v.includes("report.sub(file, 'melee'")) {
  const anchor = "    report.sub(file, 'hitStop', p.hitStop,";
  if (!v.includes(anchor)) { console.log('ANCHOR melee missing'); process.exit(1); }
  v = v.replace(anchor, "    report.sub(file, 'melee', p.melee, { impactLoudness: { min: 0.0001, max: 1 }, killNoiseLoudness: { min: 0.0001, max: 1 } })\n" + anchor);
}
if (!v.includes("breakLoudness")) {
  const anchor2 = "if (p.breakLabel !== undefined && !isStr(p.breakLabel)) report.error(file, pw + '.breakLabel', '必须是非空字符串')";
  if (!v.includes(anchor2)) { console.log('ANCHOR breakLoudness missing'); process.exit(1); }
  v = v.replace(anchor2, anchor2 + "\n        report.num(file, pw + '.breakLoudness', p.breakLoudness, { min: 0.0001, max: 1, name: 'breakLoudness' })");
}
fs.writeFileSync('scripts/validate-data.mjs', v);
console.log('patched');
