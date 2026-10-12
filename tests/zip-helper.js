import { execFileSync } from "node:child_process";

// Independent reader (Python zipfile): validates the archive structure, the CRCs, "stored" mode, and returns names, sizes and SHA-256.
const PY = `
import sys, json, zipfile, hashlib
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
out = {"bad": bad, "files": []}
for i in z.infolist():
    d = z.read(i.filename)
    out["files"].append({"name": i.filename, "size": len(d), "method": i.compress_type, "sha256": hashlib.sha256(d).hexdigest(), "text": d.decode("utf-8") if i.filename == "index.csv" else None})
print(json.dumps(out))
`;
export const readZip = (path) => JSON.parse(execFileSync("python3", ["-I", "-c", PY, path], { maxBuffer: 1 << 26 }).toString());
