import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real viewport helper against the two keyboard resize behaviors.
const listeners = {}, viewportListeners = {}, properties = new Map(), classes = new Set();
let editing = false, modal = false;
const html = {style:{setProperty:(key,value)=>properties.set(key,value)},
  classList:{toggle:(key,on)=>on ? classes.add(key) : classes.delete(key)}};
const document = {documentElement:html,activeElement:{matches:()=>editing},
  querySelector:s=>s === '.quizbar' ? {getBoundingClientRect:()=>({height:112})} : modal ? {} : null,
  querySelectorAll:()=>[],addEventListener:(key,fn)=>listeners[key]=fn};
const viewport = {height:844,offsetTop:0,scale:1,addEventListener:(key,fn)=>viewportListeners[key]=fn};
const window = {innerHeight:844,innerWidth:390,visualViewport:viewport,
  addEventListener:(key,fn)=>listeners[key]=fn};
vm.runInNewContext(fs.readFileSync('client/assets/mobile-ui.js','utf8'), {window,document,setTimeout:fn=>fn()});
window.MobileUI.mount();
assert.equal(properties.get('--quizbar-height'),'112px');
assert.equal(properties.get('--visible-height'),'844px');

editing = true;
listeners.focusin();
viewport.height = 480; viewport.offsetTop = 30;
viewportListeners.resize();
assert(classes.has('mobile-keyboard'), 'iOS keyboard hides the bottom controls');
assert.equal(properties.get('--visible-height'),'480px');
assert.equal(properties.get('--visible-top'),'30px');
modal = true;
window.MobileUI.mount();
assert(classes.has('has-modal'));

// Layout viewport also shrinks on some Android browsers.
window.innerHeight = 480; listeners.resize();
assert(classes.has('mobile-keyboard'));
viewport.scale = 2; viewport.height = 240; viewportListeners.resize();
assert.equal(properties.get('--visible-height'),'480px', 'pinch zoom does not resize the dialog');
viewport.scale = 1; viewport.height = 480;
window.innerWidth = 667; window.innerHeight = 375; viewport.height = 375;
listeners.resize();
assert(!classes.has('mobile-keyboard'), 'rotation starts with a fresh viewport height');

editing = false; modal = false; viewport.offsetTop = 0;
listeners.focusout(); window.MobileUI.mount();
assert(!classes.has('mobile-keyboard'));
assert(!classes.has('has-modal'));
assert.equal(properties.get('--visible-top'),'0px');
console.log('PASS mobile viewport: iOS/Android keyboard, rotation, zoom and dialog scroll lock');
