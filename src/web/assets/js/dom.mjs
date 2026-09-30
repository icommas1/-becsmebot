import {signalStrength} from "./core.mjs";

export function node(document,tag,className,value) {
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(value!=null)element.textContent=value;
  return element;
}

export function sparkline(document,points=[]) {
  const wrap=node(document,"span","spark");
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 112 38");svg.setAttribute("width","112");svg.setAttribute("height","38");
  svg.setAttribute("role","img");
  svg.setAttribute("aria-label",points.length>1?"Observed price trail from "+points.length+" scans":"Collecting price history");
  if(points.length>1) {
    const values=points.map(point=>point[1]),low=Math.min(...values),high=Math.max(...values),span=high-low||high*.01||1;
    const duration=points.at(-1)[0]-points[0][0]||1;
    const xy=values.map((value,index)=>(3+(points[index][0]-points[0][0])*106/duration).toFixed(1)+","+(35-(value-low)/span*32).toFixed(1)).join(" ");
    const line=document.createElementNS("http://www.w3.org/2000/svg","polyline");
    line.setAttribute("points",xy);line.setAttribute("fill","none");
    line.setAttribute("stroke",values.at(-1)>=values[0]?"#59d6a2":"#ff8585");
    line.setAttribute("stroke-width","2");line.setAttribute("stroke-linejoin","round");svg.append(line);
  } else {
    const dot=document.createElementNS("http://www.w3.org/2000/svg","circle");
    dot.setAttribute("cx","56");dot.setAttribute("cy","19");dot.setAttribute("r","3");dot.setAttribute("fill","#70b8ff");svg.append(dot);
  }
  wrap.append(svg);
  return wrap;
}

export function strengthBars(document,row) {
  const strength=signalStrength(row),wrap=node(document,"span","strength");
  wrap.setAttribute("aria-label","Observed activity "+strength+" of 5; heuristic, not wallet score");
  for(let index=1;index<=5;index++)wrap.append(node(document,"i",index<=strength?"lit":""));
  return wrap;
}
