import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const work = resolve(process.argv[2] ?? ".preshot-build-cache/installed-demo");
const profile = join(work, "profile");
for (const directory of ["Desktop", "Documents", "Pictures", "AppData/Local", "AppData/Roaming"]) mkdirSync(join(profile, directory), { recursive: true });
const executable = join(process.env.LOCALAPPDATA, "Programs/Preshot/preshot.exe");
if (!existsSync(executable)) throw new Error("Install the built MSI before launching this workflow");
const child = spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: true, env: {
  ...process.env, USERPROFILE: profile, APPDATA: join(profile, "AppData/Roaming"), LOCALAPPDATA: join(profile, "AppData/Local"),
  WEBVIEW2_USER_DATA_FOLDER: join(work, "webview"),
} });
writeFileSync(join(work, "app-pid.txt"), String(child.pid));
console.log(JSON.stringify({ pid: child.pid, executable, profile }));
child.unref();
