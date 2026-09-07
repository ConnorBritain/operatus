'use strict';
async function measureRunLayout(page){
 return page.evaluate(()=>{
  const area=document.querySelector('[aria-label="Run evidence scroll area"]');
  const detail=document.querySelector('[data-run-detail]');
  if(!area||!detail)throw Error('Run layout is not mounted');
  const metric=el=>({clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,width:el.getBoundingClientRect().width});
  return {document:metric(document.documentElement),area:metric(area),detail:metric(detail)};
 });
}
function fits(layout){return Object.values(layout).every(m=>m.scrollWidth<=m.clientWidth+1);}
module.exports={measureRunLayout,fits};
