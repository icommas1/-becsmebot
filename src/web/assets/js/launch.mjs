const launch=document.getElementById("terminal-launch");
try {
  const response=await fetch("/assets/terminal-fragment.html",{cache:"no-store"});
  if(!response.ok||!response.headers.get("content-type")?.includes("text/html"))throw Error("Terminal unavailable");
  const markup=await response.text();
  document.body.dataset.view="radar";
  document.body.innerHTML=markup;
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
