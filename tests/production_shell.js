'use strict';
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const root=path.join(__dirname,'..');const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const sw=read('sw.js');const ctx={self:{addEventListener(){}}};vm.createContext(ctx);vm.runInContext(sw,ctx);
const assets=vm.runInContext('APP_SHELL',ctx);const version=vm.runInContext('CACHE_VERSION',ctx);
for(const asset of assets)assert.ok(fs.existsSync(path.join(root,asset==='./'?'index.html':asset)),asset+' must exist');
for(const page of ['index.html','greenmap.html']){
 const html=read(page);const release=html.match(/window[.]CADDY_VERSION\s*=\s*'([^']+)'/)[1];assert.equal(release,version,page+' release must match service worker');
 for(const m of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)){
  if(/^(https?:|data:|\/\/)/.test(m[1]))continue;
  assert.ok(fs.existsSync(path.join(root,m[1])),page+' references missing '+m[1]);
  assert.ok(assets.some(a=>a.replace(/^\.\//,'')===m[1].replace(/^\.\//,'')),page+' dependency missing from offline shell: '+m[1]);
 }
}
const build=read('app.js').match(/const APP_VERSION = '([^']+)'/)[1];assert.equal('v'+build,version,'About/backup version must identify this release');
assert.ok(!read('greenmap.js').includes("'v' + (window.CADDY_VERSION"),'3D label must not double the v prefix');
console.log('PRODUCTION SHELL PASSED: '+assets.length+' offline entries, scripts/styles exist, version '+version);
