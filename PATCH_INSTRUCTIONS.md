# Patching kosha-platform_1.html for live data

Apply these 3 find-and-replace edits using cPanel File Manager's code editor
(or any text editor) after uploading the original file as `index.html`.

---

## Patch 1 — replace the hardcoded BHAV array

**Find** (near the top of the `<script>` block):
```
const BHAV=[{"s":"LENSKART"...very long array...}];
```
(This is the single line starting `const BHAV=[` and ending `];` — it's one
very long line, easy to spot since it's by far the longest line in the file.)

**Replace with:**
```js
let BHAV=[];
```

---

## Patch 2 — wrap UNIVERSE/BY construction in a function

**Find:**
```js
const UNIVERSE=BHAV.map(r=>({s:r.s,n:NAMES[r.s]||r.s,e:r.e,c:r.c,p:r.p,d:r.d,t:r.t,r:r.r,nt:r.n}))
 .concat(MFS.map(m=>({s:m.s,n:m.n,e:"MF",c:m.c,p:0,d:0,t:0,r:0.5,nt:0})))
 .concat([{s:"GUJINTRX",n:"Gujarat Intrux",e:"EQ",c:419,p:0,d:0,t:0,r:0.5,nt:0,bse:true}]);
const BY={};UNIVERSE.forEach(u=>BY[u.s]=u);
```

**Replace with:**
```js
let UNIVERSE=[];
let BY={};
function buildUniverse(){
  UNIVERSE=BHAV.map(r=>({s:r.s,n:NAMES[r.s]||r.s,e:r.e,c:r.c,p:r.p,d:r.d,t:r.t,r:r.r,nt:r.n}))
   .concat(MFS.map(m=>({s:m.s,n:m.n,e:"MF",c:m.c,p:0,d:0,t:0,r:0.5,nt:0})))
   .concat([{s:"GUJINTRX",n:"Gujarat Intrux",e:"EQ",c:419,p:0,d:0,t:0,r:0.5,nt:0,bse:true}]);
  BY={};UNIVERSE.forEach(u=>BY[u.s]=u);
}
```

---

## Patch 3 — replace the boot sequence

**Find** (at the very end of the `<script>` block):
```js
/* ---------- boot ---------- */
paint();
if(!state.onboarded){$("onb").classList.remove("off");ostep(1);}else{go(state.lastView||"today");}
```

**Replace with:**
```js
/* ---------- boot ---------- */
async function boot(){
  try{
    const r=await fetch('/api/bhavcopy');
    if(!r.ok) throw new Error('bad status '+r.status);
    const live=await r.json();
    if(Array.isArray(live)&&live.length){BHAV=live;}
  }catch(e){
    console.warn('live fetch failed, using bundled snapshot',e);
  }
  buildUniverse();
  paint();
  if(!state.onboarded){$("onb").classList.remove("off");ostep(1);}else{go(state.lastView||"today");}
}
setInterval(async()=>{
  try{
    const r=await fetch('/api/bhavcopy');
    if(r.ok){
      const live=await r.json();
      if(Array.isArray(live)&&live.length){BHAV=live;buildUniverse();paint();}
    }
  }catch(e){console.warn('refresh failed',e);}
}, 60000);
boot();
```

---

## Notes

- Patch 1 keeps the original bundled snapshot as a fallback is **not** preserved
  by this patch (the array is deleted). If you want a fallback for when the
  live API is down, keep a *small* trimmed version of BHAV (e.g. top 50 by
  traded value) instead of deleting it, and reference it in the catch block.
  For a v1 launch, an empty-then-populated array is fine — the UI just shows
  less until the first successful fetch.
- NAMES, MFS, and the static GUJINTRX entry are left untouched — they're small
  and don't need a live feed.
- Nothing else in the file should change. All portfolio math, verdict logic,
  onboarding, credits, tax calc etc. are independent of where BHAV's data
  comes from.
