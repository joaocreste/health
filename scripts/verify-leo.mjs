/* Headless check: load static pages AS Leo (auth stubbed) and assert the
 * removed items are gone from the RENDERED DOM. Read-only; no deploy. */
import { spawn } from "node:child_process";
import path from "node:path";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9355;
const root = path.resolve(process.cwd(), "web");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--disable-gpu",
  "--no-first-run", "--no-default-browser-check", `--user-data-dir=/tmp/chrome-leo-${process.pid}`, "about:blank"], { stdio: "ignore" });
async function dt() { for (let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/version`);if(r.ok)return;}catch{}await sleep(100);} throw new Error("no devtools"); }
function rpc(ws){let id=0;const p=new Map();ws.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id);}});return(method,params={})=>new Promise(res=>{const i=++id;p.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});}

const LEO = "pending:leo-keller-a3f1c2";
async function loadPage(file, evalExpr) {
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener("open",r);ws.addEventListener("error",j);});
  const send = rpc(ws);
  await send("Page.enable"); await send("Runtime.enable");
  // Stub auth + patient + neutralise redirects BEFORE page scripts run.
  await send("Page.addScriptToEvaluateOnNewDocument", { source:
    `try{sessionStorage.setItem('jc_authed','true');sessionStorage.setItem('jc_current_patient','${LEO}');` +
    `sessionStorage.setItem('jc_viewer_clerk','pending:admin');localStorage.setItem('jc_lang','en');` +
    `history.replaceState=function(){};var _r=location.replace;Object.defineProperty(location,'replace',{value:function(){},writable:true});}catch(e){}` });
  await send("Page.navigate", { url: "file://" + path.join(root, file) });
  await sleep(2200);
  const { result } = await send("Runtime.evaluate", { expression: evalExpr, returnByValue: true });
  ws.close();
  return result.value;
}
function checkExpr(ids, forbidden) {
  return `(()=>{const disp=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).display:'(absent)';};` +
    `const ids=${JSON.stringify(ids)};const out={};ids.forEach(s=>out[s]=disp(s));` +
    `const txt=document.body.innerText;const forb=${JSON.stringify(forbidden)};` +
    `out._visibleForbidden=forb.filter(w=>txt.indexOf(w)!==-1);return out;})()`;
}
try {
  await dt();
  console.log("=== physical-exams (as Leo) ===");
  console.log(JSON.stringify(await loadPage("physical-exams.html",
    checkExpr(["#mri-cervical","#us-face-2026","#imaging","#tc-heart","#alcohol"],
      ["Coronary CT","cervical spine MRI","Dermatologic Ultrasound","AUDIT","CT facial sinuses","US-guided biopsy"])), null, 1));
  console.log("=== mental (as Leo) ===");
  console.log(JSON.stringify(await loadPage("mental.html",
    `(()=>{const g=(sel,dim)=>{const e=[...document.querySelectorAll(sel)].find(x=>x.getAttribute('data-dim')==='risk');return e?getComputedStyle(e).display:'(absent)';};` +
    `const crisis=document.querySelector('#crisis-29apr');const out={'#crisis-29apr':crisis?getComputedStyle(crisis).display:'(absent)',` +
    `'risk-panel':g('.psych-dim-panel'),'risk-card':g('.psych-dim-card')};` +
    `const txt=document.body.innerText;out._visibleForbidden=['suicid','Suicid','overdose','AUDIT','Diazepam','benzodiazepine'].filter(w=>txt.indexOf(w)!==-1);return out;})()`), null, 1));
  console.log("=== home (as Leo) ===");
  console.log(JSON.stringify(await loadPage("home.html", checkExpr([], ["AUDIT","suicid","overdose"])), null, 1));
  console.log("=== physical (as Leo) ===");
  console.log(JSON.stringify(await loadPage("physical.html", checkExpr([], ["AUDIT","cervical","Coronary","suicid"])), null, 1));
} catch (e) { console.error(e); process.exitCode = 1; }
finally { chrome.kill("SIGKILL"); }
