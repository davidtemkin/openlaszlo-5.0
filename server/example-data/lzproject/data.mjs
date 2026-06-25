// LZProject backend — dependency-free Node reimplementation of the original Java/Derby
// REST app (project/task tracker with session auth + i18n). Std-lib only:
//   persistence = in-memory model seeded from SQL, snapshotted to data/lzproject.json
//                 (atomic temp+rename, debounced); survives restarts.
//   auth        = node:crypto MD5 (matches the seed hash so `openlaszlo` works) + a
//                 sessions Map keyed by a random cookie (the SecurityFilter equivalent).
// Emits the exact XML the webservice JSPs produced (shapes captured from the sources).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "db.json");
const md5 = s => crypto.createHash("md5").update(String(s)).digest("hex").toUpperCase();
const PW  = md5("openlaszlo");   // E439796B953BB9FB06970325219E2940 — the shared seed password

// ---------- seed (ported from docs/database-schema.sql) ----------
const NAMES = [
  ["laszlo", "Laszlo Moholy-Nagy"], ["david", "David Temkin"], ["john", "John Sundman"],
  ["helena", "Helena Kimball"], ["bret", "Bret Simister"], ["max", "Max Carlson"],
  ["henry", "Henry Minsky"], ["tucker", "PT Withington"], ["ben", "Ben Shine"],
  ["mayme", "Mayme Kratt"], ["amy", "Amy Muntz"], ["josh", "Josh Crowley"], ["phil", "Philip Romanik"],
];
const seed = () => ({
  users: NAMES.map(([login, realName], i) => ({
    id: i + 1, login, realName, email: `${login}@openlaszlo.org`, pass: PW,
    lastLogin: "2026-06-20T17:30:00Z",
  })),
  projects: [
    { id: 1, name: "OpenLaszlo 4.1 Release", description: "The release of the next minor version of the OpenLaszlo Server", started: "2006-12-20" },
    { id: 2, name: "Project Orbit", description: "J2ME player for OpenLaszlo DHTML runtime.", started: "2006-10-03" },
    { id: 3, name: "OpenLaszlo iPhone example app", description: 'Development of an iPhone example app at <a href="http://barcamp.org/iPhoneDevCamp">iPhoneDevCamp</a>.', started: "2007-04-10" },
    { id: 4, name: "OpenLaszlo 4.0 Release", description: "Release of OpenLaszlo 4.0, the first release with multiple runtime support around Ajax World in New York", started: "2006-03-01" },
  ],
  tasks: [
    { id: 1, projectId: 1, title: "OL 4.1 Website changes", description: "All the changes on the OpenLaszlo.org website for OpenLaszlo 4.1", created: "2026-06-01", deadline: "2026-07-15", finished: 0 },
    { id: 2, projectId: 1, title: "DHTML Performance Optimization", description: "DHTML runtime performance optimization.", created: "2026-06-01", deadline: "2007-10-03", finished: 0 },
    { id: 3, projectId: 1, title: "Flash Performance Optimization", description: "Here can be a more complex description of the task in the future.", created: "2026-06-01", deadline: "2007-09-13", finished: 0 },
    { id: 4, projectId: 2, title: "Update Build Instructions", description: "Update the Wiki page with the build instruction", created: "2026-06-01", deadline: "2026-07-20", finished: 0 },
    { id: 5, projectId: 2, title: "Java bytecode requirements", description: "Discuss the technical requirements of a Java bytecode runtime.", created: "2026-06-01", deadline: "2007-06-25", finished: 0 },
    { id: 6, projectId: 3, title: "Interface prototypes", description: "Develop interface prototypes/dummies for the mobile Laszlo Webtop.", created: "2026-06-01", deadline: "2007-12-01", finished: 0 },
    { id: 7, projectId: 4, title: "Website changes for 4.0", description: "OpenLaszlo.org website changes for the 4.0 release on March 20th.", created: "2026-06-01", deadline: "2007-03-01", finished: 1 },
    { id: 8, projectId: 4, title: "Community announcements", description: "Community announcements for Webtop and OpenLaszlo 4.0.", created: "2026-06-01", deadline: "2007-03-18", finished: 1 },
    { id: 9, projectId: 4, title: "Wiki Updates", description: "Check the Wiki for content not up-to-date", created: "2026-06-01", deadline: "2007-03-28", finished: 0 },
    { id: 10, projectId: 4, title: "Release party", description: "A huge OL 4.0 release party with Pizza, Beer and the OL team.", created: "2026-06-01", deadline: "2007-03-30", finished: 1 },
  ],
  seq: { user: 14, project: 5, task: 11 },
});

// ---------- state + JSON persistence ----------
let state, saveTimer = null;
function db() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { state = seed(); persist(); }
  return state;
}
function persist() {                                    // atomic, debounced
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA), { recursive: true });
      const tmp = DATA + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, DATA);
    } catch (e) { console.error("lzproject persist failed:", e.message); }
  }, 150);
}

// ---------- auth ----------
const sessions = new Map();                             // sid -> userId
const cookies = req => Object.fromEntries((req.headers.cookie || "").split(/;\s*/).filter(Boolean).map(c => {
  const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
}));
const userOf = req => { const u = sessions.get(cookies(req).LZPROJSESSID); return u ? db().users.find(x => x.id === u) : null; };

// ---------- helpers ----------
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cdata = s => `<![CDATA[${String(s == null ? "" : s).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
const TZ = "UTC";   // format date-only fixtures in UTC so "2006-12-20" doesn't shift a day
const medium = d => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: TZ }).format(new Date(d));
const long = d => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: TZ }).format(new Date(d));
const loginTime = d => new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: TZ }).format(new Date(d));
const daysRunning = d => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5));

// ---------- i18n (English; structured so other locales can be added) ----------
const M = {
  "login.loginButton": "Login", "login.loginMessage": "Login with your username and password",
  "login.user": "Username", "login.password": "Password", "login.success": "Login successful",
  "user.login.missingData": "Please enter both username and password",
  "main.project.newProject": "New Project", "project.create.message": "Please enter title and description",
  "project.create.cancel": "Cancel", "project.create.save": "Save",
  "user.create.missingParameters": "Please fill in all form fields",
  "user.create.passwordMissmatch": "The passwords don't match! Please check...",
  "main.lastLogin": "Last login was", "main.logout": "Logout", "main.project": "Project",
  "main.dashboard": "Dashboard", "main.people": "People", "main.tasks": "Tasks",
  "main.finishedTasks": "Finished Tasks", "main.project.description": "Project details",
  "main.dashboard.overdue": "Overdue tasks", "main.project.deadline": "Deadline",
  "main.project.title": "Task", "main.project.newTask": "Add Task", "main.task.description": "Description",
  "main.project.createButton": "Create Project", "main.people.email": "E-Mail",
  "main.people.realName": "Real name", "main.people.newUser": "Add User",
  "main.people.editUser": "Update", "user.create.cancel": "Cancel",
};
const LOCALES = [["English", "en"], ["German", "de"], ["Korean", "ko"], ["Japanese", "jp"]];

function i18nXML(req) {
  const u = userOf(req);
  const userBlock = u ? `  <user><login>${esc(u.login)}</login><realName>${esc(u.realName)}</realName><lastLogin>${esc(loginTime(u.lastLogin))}</lastLogin></user>\n` : "";
  const locs = LOCALES.map(([lang, code]) => `    <locale><language>${lang}</language><code>${code}</code><flag>resources/flags/${code === "en" ? "us" : code}.jpg</flag></locale>`).join("\n");
  const t = k => esc(M[k] || k);
  return `<app>
${userBlock}  <currentLocale>en</currentLocale>
  <locales>
${locs}
  </locales>
  <login>
    <loginButton>${t("login.loginButton")}</loginButton>
    <loginMessage>${t("login.loginMessage")}</loginMessage>
    <user>${t("login.user")}</user>
    <password>${t("login.password")}</password>
    <success>${t("login.success")}</success>
    <missingData>${t("user.login.missingData")}</missingData>
  </login>
  <project><create>
    <newProject>${t("main.project.newProject")}</newProject>
    <newProjectMessage>${t("project.create.message")}</newProjectMessage>
    <cancel>${t("project.create.cancel")}</cancel>
    <save>${t("project.create.save")}</save>
  </create></project>
  <user><create>
    <missingParameters>${t("user.create.missingParameters")}</missingParameters>
    <passwordMissmatch>${t("user.create.passwordMissmatch")}</passwordMissmatch>
  </create></user>
  <main>
    <lastLogin>${t("main.lastLogin")}</lastLogin>
    <logout>${t("main.logout")}</logout>
    <project>${t("main.project")}</project>
    <dashboard>${t("main.dashboard")}</dashboard>
    <people>${t("main.people")}</people>
    <tasks>${t("main.tasks")}</tasks>
    <finishedTasks>${t("main.finishedTasks")}</finishedTasks>
    <dashboardTab><description>${t("main.project.description")}</description><overdue>${t("main.dashboard.overdue")}</overdue></dashboardTab>
    <projectTab><deadline>${t("main.project.deadline")}</deadline><description>${t("main.project.description")}</description><title>${t("main.project.title")}</title><newTask>${t("main.project.newTask")}</newTask><taskDescription>${t("main.task.description")}</taskDescription><createButton>${t("main.project.createButton")}</createButton></projectTab>
    <peopleTab><email>${t("main.people.email")}</email><realName>${t("main.people.realName")}</realName><newUser>${t("main.people.newUser")}</newUser><editUser>${t("main.people.editUser")}</editUser><cancel>${t("user.create.cancel")}</cancel></peopleTab>
  </main>
</app>`;
}

// ---------- response renderers (match the webservice JSP shapes) ----------
const ok = msg => `<response><success><message>${esc(msg)}</message></success></response>`;
const fail = (msg, no) => `<response><failure><errorMsg>${esc(msg)}</errorMsg>${no ? `<errorNo>${esc(no)}</errorNo>` : ""}</failure></response>`;

function loginResponse(u) {
  return `<response><success><locale>en</locale><message>${esc(M["login.success"])}</message><id>${u.id}</id><login>${esc(u.login)}</login><realName>${esc(u.realName)}</realName><lastLogin>${esc(loginTime(u.lastLogin))}</lastLogin></success></response>`;
}
function userListXML() {
  const rows = db().users.map(u => `    <user><id>${u.id}</id><login>${esc(u.login)}</login><realName>${esc(u.realName)}</realName><email>${esc(u.email)}</email><lastLogin>${esc(loginTime(u.lastLogin))}</lastLogin></user>`).join("\n");
  return `<response><users>\n${rows}\n  </users></response>`;
}
function projectListXML() {
  const rows = db().projects.map(p => `    <project id="${p.id}"><name>${esc(p.name)}</name><started>${esc(medium(p.started))}</started><description>${cdata(p.description)}</description><running>The project start was ${esc(long(p.started))}. It has been running for ${daysRunning(p.started)} days.</running></project>`).join("\n");
  return `<response><currentLocale>en</currentLocale><projects>\n${rows}\n  </projects></response>`;
}
function taskRow(t) {
  const proj = db().projects.find(p => p.id === t.projectId);
  return `    <task id="${t.id}" deadlineMillis="${new Date(t.deadline).getTime()}"><name>${esc(t.title)}</name><created>${esc(medium(t.created))}</created><description>${cdata(t.description)}</description><projectName id="${t.projectId}">${esc(proj ? proj.name : "")}</projectName><deadline>${esc(long(t.deadline))}</deadline><finished>${t.finished}</finished></task>`;
}
function taskListXML() {
  const active = db().tasks.filter(t => !t.finished).map(taskRow).join("\n");
  const done = db().tasks.filter(t => t.finished).map(taskRow).join("\n");
  return `<response><currentLocale>en</currentLocale><rest>${esc(M["main.tasks"])}</rest><tasks>\n${active}\n  </tasks><finishedTasks>\n${done}\n  </finishedTasks></response>`;
}

// ---------- request handler ----------
// Returns { status?, xml, setCookie? } or null if not an lzproject path.
export function handleLzproject(method, restPath, body, req) {
  const d = db();
  const p = restPath.replace(/^\/+|\/+$/g, "");          // e.g. "user/login"

  if (p === "application/i18n") return { xml: i18nXML(req) };

  // ---- user ----
  if (p === "user/login") {
    const login = body.get("login"), pass = body.get("password");
    if (!login || !pass) return { xml: fail(M["user.login.missingData"]) };
    const u = d.users.find(x => x.login.toLowerCase() === login.toLowerCase());
    if (!u) return { xml: fail(`Unknown username ${login}`) };
    if (u.pass !== md5(pass)) return { xml: fail("The password is incorrect") };
    u.lastLogin = new Date().toISOString(); persist();
    const sid = crypto.randomUUID(); sessions.set(sid, u.id);
    return { xml: loginResponse(u), setCookie: `LZPROJSESSID=${sid}; HttpOnly; Path=/; SameSite=Lax` };
  }
  if (p === "user/logout") {
    const sid = cookies(req).LZPROJSESSID; const u = userOf(req);
    sessions.delete(sid);
    return { xml: ok(u ? `User ${u.login} logged out` : "Logged out") };
  }
  if (p === "user/list") return { xml: userListXML() };
  if (p === "user/create") {
    const login = body.get("login"), realName = body.get("realName"), email = body.get("email");
    const pw = body.get("password"), pw2 = body.get("password2") || body.get("passwordConfirm");
    if (!login || !realName) return { xml: fail(M["user.create.missingParameters"]) };
    if (pw != null && pw2 != null && pw !== pw2) return { xml: fail(M["user.create.passwordMissmatch"]) };
    if (d.users.some(u => u.login.toLowerCase() === login.toLowerCase())) return { xml: fail(`A user with the login ${login} already exists`) };
    d.users.push({ id: d.seq.user++, login, realName, email: email || "", pass: pw ? md5(pw) : PW, lastLogin: new Date().toISOString() });
    persist();
    return { xml: ok(`User ${login} with real name ${realName} created`) };
  }
  if (p === "user/update") {
    const login = body.get("login"); const u = d.users.find(x => x.login === login);
    if (!u) return { xml: fail(`A user with username ${login} doesn't exist`) };
    if (body.get("realName") != null) u.realName = body.get("realName");
    if (body.get("email") != null) u.email = body.get("email");
    if (body.get("password")) u.pass = md5(body.get("password"));
    persist();
    return { xml: ok("User information updated") };
  }
  if (p === "user/delete") {
    const login = body.get("login"); const i = d.users.findIndex(x => x.login === login);
    if (i < 0) return { xml: fail(`A user with username ${login} doesn't exist`) };
    d.users.splice(i, 1); persist();
    return { xml: ok(`User with username ${login} successfully deleted`) };
  }

  // ---- project ----
  if (p === "project/list") return { xml: projectListXML() };
  if (p === "project/create") {
    const name = body.get("name") || body.get("title"), desc = body.get("description");
    if (!name || !desc) return { xml: fail(M["project.create.message"]) };
    if (d.projects.some(x => x.name.toLowerCase() === name.toLowerCase())) return { xml: fail(`A project with the name ${name} already exists`) };
    const id = d.seq.project++;
    d.projects.push({ id, name, description: desc, started: new Date().toISOString().slice(0, 10) });
    persist();
    return { xml: ok(`Project ${name} with ID ${id} succesfully created`) };
  }

  // ---- task ----
  if (p === "task/list") return { xml: taskListXML() };
  if (p === "task/create") {
    const title = body.get("title") || body.get("name"), desc = body.get("description");
    const projectId = parseInt(body.get("projectId") || body.get("projectName"), 10);
    const deadline = body.get("deadline");
    if (!title || !desc) return { xml: fail(M["main.task.description"] && "Please enter the task title and description") };
    if (!d.projects.some(x => x.id === projectId)) return { xml: fail("Invalid project ID or deadline") };
    const id = d.seq.task++;
    d.tasks.push({ id, projectId, title, description: desc, created: new Date().toISOString().slice(0, 10), deadline: deadline || new Date().toISOString().slice(0, 10), finished: 0 });
    persist();
    return { xml: ok("Task created") };
  }
  if (p === "task/update") {
    const id = parseInt(body.get("id"), 10); const t = d.tasks.find(x => x.id === id);
    if (!t) return { xml: fail(`Unknown task ID ${id}`) };
    if (body.get("title") != null) t.title = body.get("title");
    if (body.get("description") != null) t.description = body.get("description");
    if (body.get("deadline") != null) t.deadline = body.get("deadline");
    if (body.get("finished") != null) t.finished = parseInt(body.get("finished"), 10) ? 1 : 0;
    persist();
    return { xml: ok(`Task with ID ${id} updated`) };
  }
  if (p === "task/markAsFinished") {
    const id = parseInt(body.get("id"), 10); const t = d.tasks.find(x => x.id === id);
    if (!t) return { xml: fail(`Unknown task ID ${id}`) };
    t.finished = 1; persist();
    return { xml: ok(`Task with ID ${id} marked as finished`) };
  }
  if (p === "task/delete") {
    const id = parseInt(body.get("id"), 10); const i = d.tasks.findIndex(x => x.id === id);
    if (i < 0) return { xml: fail("Missing parameters") };
    d.tasks.splice(i, 1); persist();
    return { xml: ok(`Task with ID ${id} deleted`) };
  }

  return { xml: fail(`Unknown REST method ${p}`) };
}
