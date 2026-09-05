'use strict';
const assert=require('assert/strict');const{test}=require('node:test');const E=require('../caddy-elev.js');
test('north-up elevation raster samples geographic north, not reflected south',()=>{
 const W=20,H=20,bbox=[-100,40,-99.999,40.001],grid=new Float32Array(W*H);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)grid[y*W+x]=300+y;
 const eg={W,H,grid,cellSizeM:5,bbox,validMask:new Uint8Array(W*H).fill(1)};
 const north=bbox[3]-(2.5/H)*(bbox[3]-bbox[1]);const south=bbox[3]-(17.5/H)*(bbox[3]-bbox[1]);
 assert.equal(E.sampleMedianZ(eg,north,-99.9995,3),302);
 assert.equal(E.sampleMedianZ(eg,south,-99.9995,3),317);
});
