const launch=document.getElementById("terminal-launch");
try {
  const response=await fetch("/assets/terminal-fragment.html",{cache:"no-store"});
  if(!response.ok||!response.headers.get("content-type")?.includes("text/html"))throw Error("Terminal unavailable");
  const markup=await response.text();
  document.body.dataset.view="radar";
  document.body.innerHTML=markup;
  const home=document.createElement("a");
  home.href="/home";home.textContent="BECS Home";
  home.style.cssText="display:inline-flex;align-items:center;min-height:44px;padding:0 12px;flex-shrink:0;color:inherit;white-space:nowrap";
  document.querySelector(".view-nav")?.prepend(home);
  const sourceLink=document.createElement("a");
  sourceLink.href="/assets/sources.html";
  sourceLink.textContent="Sources & tools";
  sourceLink.style.cssText="display:inline-flex;align-items:center;min-height:44px;padding:0 12px;flex-shrink:0;color:inherit";
  document.querySelector(".view-nav")?.append(sourceLink);
  const research=document.createElement("a");
  research.href="/research";research.textContent="Sources & engines";
  research.style.cssText="display:flex;align-items:center;min-height:44px;padding:8px 12px;color:inherit;text-decoration:none;white-space:nowrap;flex-shrink:0";
  document.querySelector(".view-nav")?.append(research);
  for(const [href,label] of [["/memory","Memory evidence"],["/superagent","BecsSuperAgent"]]){
    const link=document.createElement("a");link.href=href;link.textContent=label;
    link.style.cssText="display:inline-flex;align-items:center;min-height:44px;padding:0 12px;flex-shrink:0;color:inherit;white-space:nowrap";
    document.querySelector(".view-nav")?.append(link);
  }
  await import("./dashboard.mjs");
} catch (_error) {
  document.body.replaceChildren();
  launch.textContent="Terminal did not open. ";
  const retry=document.createElement("a");
  retry.href="/terminal";
  retry.textContent="Try again";
  launch.append(retry);
  document.body.append(launch);
}
