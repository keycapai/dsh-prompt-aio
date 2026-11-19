const fs=require('fs'),path=require('path');
const base='/Users/reno/Documents/deepseek-harness/default-workspace', toolSrc='/Users/reno/.dsh/plugins/dsh-tool-gate';
const specs=[
  {old:'dsh-prompt-gate', oldDir:base+'/dsh-prompt-gate', neo:'dsh-prompt-control', row:'prompt-control-row', tool:'prompt_control'},
  {old:'dsh-skill-gate',  oldDir:base+'/dsh-skill-gate',  neo:'dsh-skill-control',  row:'skill-control-row',  tool:'skill_control'},
  {old:'dsh-tool-gate',   oldDir:toolSrc,                 neo:'dsh-tool-control',   row:'tool-control-row',   tool:'tool_control'},
];
const reps=[
  [/dsh-tool-gate/g,'dsh-tool-control'],
  [/dsh-prompt-gate/g,'dsh-prompt-control'],
  [/dsh-skill-gate/g,'dsh-skill-control'],
  [/prompt-gate-bundle-row/g,'prompt-control-row'],
  [/skill-gate-bundle-row/g,'skill-control-row'],
  [/tool-gate-bundle-row/g,'tool-control-row'],
  [/prompt_gate/g,'prompt_control'],
  [/skill_gate/g,'skill_control'],
  [/tool_gate/g,'tool_control'],
  [/prompt-gate/g,'prompt-control'],
  [/skill-gate/g,'skill-control'],
  [/tool-gate/g,'tool-control'],
  [/PromptGate/g,'PromptControl'],
  [/SkillGate/g,'SkillControl'],
  [/ToolGate/g,'ToolControl'],
  [/\bgate\b/g,'control'],[/\bGate\b/g,'Control'],[/\bgated\b/g,'controlled'],
];
function rewrite(s){ for(const [re,to] of reps) s=s.replace(re,to); return s }
function copyDir(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const e of fs.readdirSync(src,{withFileTypes:true})){
    if(e.name==='node_modules'||e.name==='.git') continue;
    const sp=path.join(src,e.name),dp=path.join(dst,e.name);
    if(e.isDirectory()) copyDir(sp,dp);
    else if(/\.(js|json|yml|md|svg)$/.test(e.name)){
      let c=fs.readFileSync(sp,'utf8');
      try{ if(e.name.endsWith('.json')) JSON.parse(c); c=rewrite(c); if(e.name.endsWith('.json')) JSON.parse(c) }catch(err){}
      fs.writeFileSync(dp,c);
    }
  }
}
for(const s of specs){
  const dst=base+'/'+s.neo;
  if(fs.existsSync(dst)){ console.log('EXISTS skip',s.neo); continue }
  copyDir(s.oldDir,dst);
  // fix package.json name/description explicitly (JSON parse safety)
  const p=path.join(dst,'package.json');
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.name=s.neo;
  j.description=(j.description||'').replace(/dsh-(prompt|skill|tool)-gate/g,x=>x.replace('-gate','-control'));
  fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
  console.log('created',s.neo,'files:',fs.readdirSync(dst).filter(x=>x!=='node_modules').join(','));
}
