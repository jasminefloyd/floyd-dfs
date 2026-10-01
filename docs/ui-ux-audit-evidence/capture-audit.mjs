// Requires an existing Playwright installation and its Chromium browser.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { writeFile } from 'node:fs/promises';
const out = new URL('.', import.meta.url).pathname;
const baseUrl = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:5199';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const date=new Date(Date.now()+86400000).toISOString();
const players=['Alex Morgan-Smith','Jordan Williams','Taylor Robinson','Casey Johnson','Riley Washington','Avery Thompson'].map((name,i)=>({playerId:`p${i}`,playerName:name,team:i<3?'AAA':'BBB',position:i%2?'F':'G',salary:6000+i*400,eligibility:{CPT:true,UTIL:true},availability:{status:'ACTIVE'}}));
const slate={slateId:'fixture',sport:'WNBA',contest:{contestKind:'GPP',lockTime:date},playerPool:players,salaryCap:50000};
const lp={bulletNumber:1,playerIds:players.map(p=>p.playerId),rosterSlots:{CPT:'p0',UTIL_1:'p1',UTIL_2:'p2',UTIL_3:'p3',UTIL_4:'p4',UTIL_5:'p5'},salaryUsed:45000,median:103.4,ceiling:138.2,explanation:'This lineup prioritizes projected opportunity and correlated production in a competitive game. The Captain has a substantial role, while the remaining players balance salary and projected fantasy production.',rationale:['Stable projected minutes support the selected core.','Availability has been checked, but the rotation remains uncertain.'],watchItems:['Confirm the starting rotation before lock.'],readinessStatus:'READY_WITH_WATCH'};
const lineups=[{id:'fixture-lineup',status:'GENERATED',lineup_payload:lp}];
const stages=[{stage:'SLATE',status:'COMPLETE',output_payload:slate},{stage:'RESEARCH',status:'PARTIAL',output_payload:{findings:[],unknowns:[{question:'Will the rotation change?',reason:'Awaiting a confirmed update.'}]}},{stage:'PROJECTION',status:'COMPLETE',output_payload:{players:players.map((p,i)=>({playerId:p.playerId,projectedOutcomes:{medianP50:12+i*2}}))}},{stage:'SELECTION',status:'COMPLETE',output_payload:{selectedLineups:[]}}];
const run={id:'fixture-run',state:'complete',sport:'WNBA',contest_format:'SHOWDOWN',created_at:new Date().toISOString(),request_payload:{input:{contestName:'Illustrative WNBA Showdown — Audit fixture',validatedSlate:slate}}};
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname.startsWith('/api/')){
 let data={}; let status=200;
 if(u.pathname==='/api/news') data={items:[{id:'fixture-news',sport:'wnba',title:'Illustrative audit headline: rotation update expected before tip-off',link:'https://example.com',category:'injury'}]};
 else if(u.pathname==='/api/slates') data={groups:[{draftGroupId:'fixture-group',matchupLabel:'AAA vs BBB'}],contests:[{id:'fixture-contest',draftGroupId:'fixture-group',name:'Illustrative WNBA Showdown — Audit fixture',sport:'WNBA',format:'SHOWDOWN',lockTime:date,contestSize:100,matchup:{away:'AAA',home:'BBB'}}]};
 else if(u.pathname.startsWith('/api/contests/'))data={contest:{contestSize:100}};
 else if(u.pathname==='/api/generation-runs'&&route.request().method()==='POST')data={run,slate};
 else if(u.pathname.endsWith('/entered')){data={error:'Fixture: save failed'};status=500;}
 else if(u.pathname.includes('fixture-run'))data={run,stages,lineups,trust:{trust_payload:{dataTier:'DEGRADED',modelTier:'UNVALIDATED',missingRequiredFacts:['Rotation confirmation missing']}}};
 else if(u.pathname==='/api/lineups')data={lineups:lineups.map(x=>({...x,sport:'WNBA',contest_name:'Illustrative WNBA Showdown — Audit fixture',generation_run_id:run.id,created_at:run.created_at}))};
 else if(u.pathname.includes('/research/'))data={research:{findings:[]}};
 return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 }
 if(u.origin!==new URL(baseUrl).origin)return route.abort();
 return route.continue();
});
const metrics=[];
async function capture(name){await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:`${out}/${name}.png`,fullPage:true}); metrics.push({name,...await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,firstRosterNameTop:[...document.querySelectorAll('p')].find(e=>e.textContent.includes('Alex Morgan-Smith'))?.getBoundingClientRect().top??null,smallTextElements:[...document.querySelectorAll('p,span,label,a,button')].filter(e=>parseFloat(getComputedStyle(e).fontSize)<12&&e.getBoundingClientRect().height>0).length}))});}
await page.goto(`${baseUrl}/`);await page.waitForTimeout(700);await page.locator('label').filter({has:page.locator('input[value=wnba]')}).click();await page.waitForTimeout(500);await capture('01-mobile-builder');
await page.getByRole('button',{name:'Run Scan',exact:true}).click(); await page.getByText('Recommended Lineups',{exact:true}).waitFor();await capture('02-mobile-results');
const before=await page.getByRole('button',{name:'Lineup Entered',exact:true}).count();
if(before){await page.getByRole('button',{name:'Lineup Entered',exact:true}).click();await page.waitForTimeout(150);metrics.push({name:'failed-save',buttonDisabled:await page.getByRole('button',{name:'Lineup Entered',exact:true}).isDisabled(),errorVisible:await page.getByText('Fixture: save failed',{exact:true}).count()});}
await page.setViewportSize({width:320,height:740});await capture('03-small-mobile-results');
await page.setViewportSize({width:1440,height:1000});await capture('04-desktop-results');
await page.setViewportSize({width:390,height:844});await page.goto(`${baseUrl}/runs/fixture-run`);await page.getByText('Lineup generated',{exact:true}).waitFor();await capture('05-mobile-saved-run');
await page.goto(`${baseUrl}/learning`);await page.getByText('Learning, measured.',{exact:true}).waitFor();await capture('06-mobile-learning');
await writeFile(`${out}/measurements.json`,JSON.stringify({fixtureOnly:true,liveApiCalls:false,capturedAt:new Date().toISOString(),metrics},null,2));
console.log(JSON.stringify(metrics,null,2));await browser.close();
