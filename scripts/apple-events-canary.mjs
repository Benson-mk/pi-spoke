// Own finite non-UI receiver only; never requests Automation privacy changes.
import {mkdtemp,mkdir,writeFile,readFile,unlink,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseConfig} from '../dist/config.js';
import {spawnSchema} from '../dist/contracts.js';
import {resolvePolicy} from '../dist/security/policy.js';
import {Sandbox} from '../dist/sandbox/backend.js';
const interactive=process.env.PI_SPOKE_APPLE_EVENTS_ALLOW_PROMPT==='1';
const execute=promisify(execFile),root=await mkdtemp('/private/tmp/ps-ae-'),cwd=join(root,'p'),bundle=join(root,'Receiver.app'),ready=join(root,'ready'),marker=join(root,'received');
const id='local.pi-spoke.fixture.'+randomUUID();let launched=false;let receiverPid;let result;
try{
  await mkdir(cwd);await mkdir(join(bundle,'Contents/MacOS'),{recursive:true});
  await writeFile(join(bundle,'Contents/Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>receiver</string><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>`);
  const receiver=join(root,'receiver.m'),sender=join(root,'sender.c'),send=join(root,'sender');
  await writeFile(receiver,`#import <Cocoa/Cocoa.h>\n#include <stdio.h>\n#include <unistd.h>\n@interface Receiver:NSObject<NSApplicationDelegate>\n-(void)ping:(NSAppleEventDescriptor*)event reply:(NSAppleEventDescriptor*)reply;\n@end\n@implementation Receiver\n-(void)applicationDidFinishLaunching:(NSNotification*)note{[[NSAppleEventManager sharedAppleEventManager]setEventHandler:self andSelector:@selector(ping:reply:) forEventClass:'PSpk' andEventID:'ping'];FILE*f=fopen(${JSON.stringify(ready)},"w");if(f){fprintf(f,"%d",getpid());fclose(f);}}\n-(void)ping:(NSAppleEventDescriptor*)event reply:(NSAppleEventDescriptor*)reply{FILE*f=fopen(${JSON.stringify(marker)},"w");if(f){fputs("received",f);fclose(f);}}\n@end\nstatic Receiver*receiver;\nint main(){@autoreleasepool{[NSApplication sharedApplication];receiver=[Receiver new];[NSApp setDelegate:receiver];[NSTimer scheduledTimerWithTimeInterval:${interactive?55:8} repeats:NO block:^(NSTimer*t){unlink(${JSON.stringify(ready)});exit(0);}];[NSApp run];}return 0;}\n`);
  await writeFile(sender,`#include <Carbon/Carbon.h>\n#include <stdio.h>\n#include <stdlib.h>\nint main(int argc,char**argv){if(argc!=2)return 2;pid_t pid=atoi(argv[1]);AEAddressDesc target;AppleEvent event,reply;OSStatus r=AECreateDesc(typeKernelProcessID,&pid,sizeof(pid),&target);if(!r)r=AECreateAppleEvent('PSpk','ping',&target,kAutoGenerateReturnID,kAnyTransactionID,&event);if(!r)r=AESendMessage(&event,&reply,kAEWaitReply|kAENeverInteract${interactive?'':'|kAEDoNotPromptForUserConsent'},${interactive?2400:120});if(!r){SInt32 remote=0;DescType actual;Size size;if(AEGetParamPtr(&reply,keyErrorNumber,typeSInt32,&actual,&remote,sizeof(remote),&size)==noErr)r=remote;}printf("%d\\n",(int)r);return r?1:0;}\n`);
  await execute('/usr/bin/clang',[receiver,'-framework','Cocoa','-fobjc-arc','-o',join(bundle,'Contents/MacOS/receiver')]);await execute('/usr/bin/clang',[sender,'-framework','Carbon','-o',send]);
  await execute('/usr/bin/open',['-n',bundle],{timeout:5000});launched=true;
  const deadline=Date.now()+5000;while(Date.now()<deadline){if(await readFile(ready).then(()=>true,()=>false))break;await new Promise(resolve=>setTimeout(resolve,50));}
  receiverPid=Number(await readFile(ready,'utf8'));if(!Number.isSafeInteger(receiverPid)||receiverPid<1)throw Error('Receiver identity missing');
  let positive;
  try{positive=await execute(send,[String(receiverPid)],{timeout:interactive?45000:3000});}catch(error){result={status:'BLOCKED',scope:'direct Apple Events',reason:interactive?'Outside-sandbox positive control did not complete after the explicitly enabled consent flow':'Outside-sandbox positive control failed with user-consent prompts disabled; no privacy setting was changed',code:String(error.stdout??'').trim()};}
  if(positive){
    if((await readFile(marker,'utf8'))!=='received')throw Error('Apple Events positive control did not reach the fixture');await unlink(marker);
    const config=parseConfig({version:2,state_dir:join(root,'s'),scratch_dir:join(root,'t'),workspace_roots:[cwd],allowed_tools:['bash'],pi:{auth_path:join(root,'auth')},sandbox:{backend:'srt',required:true,tool_network:'none'}});
    const policy=await resolvePolicy(config,spawnSchema.parse({request_key:'ae',task:'fixture',cwd,tools:['bash'],model:{provider:'fixture',id:'fixture'}}),join(root,'config'),resolve('.'));
    const sandbox=new Sandbox(config,resolve('.')),run='run_'+randomUUID(),scratch=await sandbox.createScratch(run),quote=text=>"'"+text.replaceAll("'","'\\''")+"'";
    try{const denied=await sandbox.tool(run,policy,scratch,'bash',{command:quote(send)+' '+receiverPid,timeout:3});
      if(denied.evidence.code===0||await readFile(marker).then(()=>true,()=>false))throw Error('Apple Event escaped tool sandbox');
      await execute(send,[String(receiverPid)],{timeout:3000});if((await readFile(marker,'utf8'))!=='received')throw Error('Post-denial positive control failed');
      result={status:'PASS',scope:'direct Apple Events to a disposable finite non-UI receiver',positive_code:positive.stdout.trim(),sandbox_code:denied.evidence.stdout.trim(),policy_hash:policy.policy_hash};
    }finally{await sandbox.cancel(run);}
  }
}finally{
  if(launched){const deadline=Date.now()+(interactive?57000:10000);while(Date.now()<deadline&&await readFile(ready).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,100));
    if(await readFile(ready).then(()=>true,()=>false))throw Error('Receiver cleanup unconfirmed; inspect '+root);}
  if(receiverPid){const deadline=Date.now()+2000;let alive=true;while(alive&&Date.now()<deadline){try{process.kill(receiverPid,0);await new Promise(resolve=>setTimeout(resolve,50));}catch(error){if(error.code!=='ESRCH')throw error;alive=false;}}if(alive)throw Error('Receiver exit unconfirmed; inspect '+root);}
  await rm(root,{recursive:true,force:true});
}
console.log(JSON.stringify(result,null,2));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');if(result?.status!=='PASS')process.exitCode=1;
