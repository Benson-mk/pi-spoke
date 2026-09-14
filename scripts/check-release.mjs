import { readFile } from 'node:fs/promises';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--platform')) {
  throw Error('Usage: node scripts/check-release.mjs [--platform darwin|linux]');
}
const platform = args[1] ?? process.platform;
const ledgers = { darwin: '../docs/acceptance-status.json', linux: '../docs/evidence/linux-support/acceptance.json' };
if (!Object.hasOwn(ledgers, platform)) throw Error('No qualified acceptance ledger for platform: ' + platform);
const ledger=JSON.parse(await readFile(new URL(ledgers[platform],import.meta.url),'utf8'));
const expected=[...Array.from({length:30},(_,i)=>'A'+String(i+1).padStart(2,'0')),...Array.from({length:36},(_,i)=>'S'+String(i+1).padStart(2,'0'))];
const ids=ledger.cases.map(item=>item.id);
if(ids.length!==66||new Set(ids).size!==66||expected.some(id=>!ids.includes(id)))throw Error('Acceptance ledger must retain every A01–A30 and S01–S36 case exactly once');
const remaining=[...ledger.cases.filter(item=>item.status!=='PASS').map(item=>({id:item.id,status:item.status,remaining:item.remaining??item.required})),
  ...(ledger.release_gates??[]).filter(item=>item.status!=='PASS')];
const ready=remaining.length===0&&ledger.release_ready===true;
console.log(JSON.stringify({platform,scope:'Recorded qualification for the pinned host; not verification of the current machine',release_ready:ready,remaining},null,2));if(!ready)process.exitCode=1;
