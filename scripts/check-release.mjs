import { readFile } from 'node:fs/promises';
const ledger=JSON.parse(await readFile(new URL('../docs/acceptance-status.json',import.meta.url),'utf8'));
const expected=[...Array.from({length:30},(_,i)=>'A'+String(i+1).padStart(2,'0')),...Array.from({length:36},(_,i)=>'S'+String(i+1).padStart(2,'0'))];
const ids=ledger.cases.map(item=>item.id);
if(ids.length!==66||new Set(ids).size!==66||expected.some(id=>!ids.includes(id)))throw Error('Acceptance ledger must retain every A01–A30 and S01–S36 case exactly once');
const remaining=[...ledger.cases.filter(item=>item.status!=='PASS').map(item=>({id:item.id,status:item.status,remaining:item.remaining??item.required})),
  ...(ledger.release_gates??[]).filter(item=>item.status!=='PASS')];
const ready=remaining.length===0&&ledger.release_ready===true;
console.log(JSON.stringify({release_ready:ready,remaining},null,2));if(!ready)process.exitCode=1;
