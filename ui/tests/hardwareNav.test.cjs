// Isolated navigation DOM fixtures: no engine writes, installs, or network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, cache = new Map()) {
    file = path.resolve(__dirname, '..', file);
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    new Function('require', 'module', 'exports', source)(name => name.startsWith('.')
        ? load(path.resolve(path.dirname(file), name + '.ts'), cache) : require(name), module, module.exports);
    cache.set(file, module.exports);
    return module.exports;
}
class Element {
    constructor(tag = 'div', classes = '', attrs = {}) {
        this.tag = tag; this.classes = classes.split(' '); this.attrs = attrs;
        this.children = []; this.connected = true; this.zIndex = 0; this.clicks = 0; this.scrolls = 0;
        this.classList = { contains: name => this.classes.includes(name), remove: name => {
            this.classes = this.classes.filter(item => item !== name);
        }};
    }
    get isConnected() { return this.connected && (!this.parentElement || this.parentElement.isConnected); }
    add(child) { child.parentElement = this; this.children.push(child); return child; }
    matches(selectors) {
        return selectors.split(',').some(selector => {
            selector = selector.trim();
            const not = selector.match(/:not\((.*)\)/);
            if (not) { if (this.matches(not[1])) return false; selector = selector.replace(not[0], ''); }
            if (selector === ':disabled') return 'disabled' in this.attrs;
            const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
            if (attrs.some(([, key, value]) => !(key in this.attrs) || (value !== undefined && this.attrs[key] !== value))) return false;
            selector = selector.replace(/\[[^\]]+\]/g, '');
            const parts = selector.split('.');
            return (!parts[0] || parts[0] === this.tag) && parts.slice(1).every(name => this.classes.includes(name));
        });
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]); }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    contains(item) { return item === this || this.children.some(child => child.contains(item)); }
    getBoundingClientRect() { return { width: this.isConnected ? 100 : 0, height: 20 }; }
    getAttribute(name) { return this.attrs[name]; }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    scrollIntoView() { this.scrolls++; }
    click() { this.clicks++; this.onClick?.(); }
    focus() { document.activeElement = this; document.events.focusin?.({target: this}); }
}
global.Element = Element;
global.window = {getComputedStyle: element => ({display:'block', visibility:'visible', zIndex:String(element.zIndex)})};
function setup() {
    global.document = new Element(); document.events = {};
    document.addEventListener = (name, callback) => document.events[name] = callback;
    document.removeEventListener = name => delete document.events[name];
    const nav = load('src/hardwareNav.ts'); nav.watchHardwareNavFocus();
    return {nav, root: document};
}
const button = (classes = '') => new Element('button', classes);
const marked = item => item.getAttribute('data-mfx-nav-cursor') === 'true';
const touch = item => document.events.pointerdown({type:'pointerdown',target:item});
let count = 0;
function test(name, action) { action(); count++; console.log('PASS ' + name); }
for (const scopeClass of ['split-list','explorer-tree','explorer-list','plugin-catalog-list','snapshot-grid','t3k-grid','t3k-creator-list','layout-group-list','editor-picker-list','chain-page','control-grid','panel']) {
    test(scopeClass + ': focused section only, both directions', () => {
        const {nav,root}=setup();
        const a=root.add(new Element('div',scopeClass)); const b=root.add(new Element('div',scopeClass));
        const a1=a.add(button()),a2=a.add(button()),b1=b.add(button()),b2=b.add(button());
        touch(a1);nav.handleHardwareNav({delta:1});assert(marked(a2));
        touch(b1);nav.handleHardwareNav({delta:1});assert(marked(b2));assert(!marked(a2));
        nav.handleHardwareNav({delta:-1});assert(marked(b1));
    });
}
for (const modalClass of ['mfx-overlay','identity-menu','plugin-browser-overlay','dialog-backdrop','explorer-menu']) {
    test(modalClass + ': blocks Performance and accepts plain action buttons', () => {
        const {nav,root}=setup();root.add(new Element('div','performance-stage'));
        const modal=root.add(new Element('div',modalClass));const cancel=modal.add(button()),ok=modal.add(button());
        assert(nav.hardwareNavBlocksPerformance());touch(cancel);nav.handleHardwareNav({delta:1});assert(marked(ok));
        nav.handleHardwareNav({select:true});assert.equal(ok.clicks,1);
    });
}
test('top dialog overrides stale background focus; keyboard overrides dialogs',()=>{
    const {nav,root}=setup();const old=root.add(new Element('div','mfx-overlay'));old.zIndex=10;const oldBtn=old.add(button());touch(oldBtn);
    const top=root.add(new Element('div','dialog-backdrop'));top.zIndex=20;const topBtn=top.add(button());nav.handleHardwareNav({select:true});assert.equal(topBtn.clicks,1);assert.equal(oldBtn.clicks,0);
    const keyboard=root.add(new Element('div','pimfx-keyboard-panel'));const key=keyboard.add(button('pimfx-keyboard-key'));nav.handleHardwareNav({select:true});assert.equal(key.clicks,1);
});
test('disabled, inert, hidden-to-accessibility, and nested card controls are excluded',()=>{
    const {nav,root}=setup();const list=root.add(new Element('div','panel'));
    const disabled=list.add(button());disabled.attrs.disabled='';const inert=list.add(new Element('div','',{inert:''}));const inertBtn=inert.add(button());
    const hidden=list.add(new Element('div','',{'aria-hidden':'true'}));hidden.add(button());
    const card=list.add(new Element('div','',{'role':'button'}));const nested=card.add(button());const last=list.add(button());
    nav.handleHardwareNav({delta:1});assert(marked(card));nav.handleHardwareNav({delta:1});assert(marked(last));assert(!marked(nested));assert(!marked(inertBtn));
});
test('form editing consumes turns without activating dialog buttons',()=>{
    const {nav,root}=setup();const modal=root.add(new Element('div','dialog-backdrop'));const input=modal.add(new Element('input'));const ok=modal.add(button());
    input.focus();assert(nav.handleHardwareNav({delta:1}));nav.handleHardwareNav({select:true});assert.equal(ok.clicks,0);
});
test('a handled select never reaches another listener when its dialog closes',()=>{
    const {nav,root}=setup();root.add(new Element('div','performance-stage'));const modal=root.add(new Element('div','identity-menu'));const choice=modal.add(button());choice.onClick=()=>modal.connected=false;
    const {EngineClient}=load('src/api.ts');const client=new EngineClient();let background=0;
    client.subscribeUiNav(nav.handleHardwareNav);client.subscribeUiNav(()=>{background++;return true;});client.ingest({type:'uiNav',select:true});assert.equal(choice.clicks,1);assert.equal(background,0);
});
test('empty dialogs block background; removed focus yields to Performance',()=>{
    const {nav,root}=setup();root.add(new Element('div','performance-stage'));const modal=root.add(new Element('div','dialog-backdrop'));touch(modal);assert(nav.handleHardwareNav({delta:1}));modal.connected=false;assert.equal(nav.handleHardwareNav({delta:1}),false);
});
test('local focus publishes a stable named list and remote focus only moves the cursor',()=>{
    global.document = new Element(); document.events = {};
    document.addEventListener = (name, callback) => document.events[name] = callback;
    document.removeEventListener = name => delete document.events[name];
    const nav=load('src/hardwareNav.ts');let shared=null;
    nav.watchHardwareNavFocus(undefined, location=>shared=location);
    const list=document.add(new Element('div','',{'data-mfx-nav-list':'shared-list'}));
    const first=list.add(button()),second=list.add(button());first.attrs['data-mfx-nav-key']='first';second.attrs['data-mfx-nav-key']='second';touch(first);nav.handleHardwareNav({delta:1});
    assert.equal(shared.scopeName,'shared-list');assert.equal(shared.itemIndex,1);
    assert.equal(shared.itemKey,'second');
    nav.applyHardwareNavFocus({...shared,itemKey:'first',itemIndex:1});assert(marked(first));assert.equal(first.clicks,0);assert.equal(second.clicks,0);
});
test('repeated shared focus does not pull a locally scrolled list back to the same item',()=>{
    const {nav,root}=setup();
    const list=root.add(new Element('div','t3k-grid',{'data-mfx-nav-list':'tone-results'}));
    const first=list.add(button());first.attrs['data-mfx-nav-key']='first';
    const location={scopeName:'tone-results',scopeKind:'.t3k-grid',scopeOrdinal:0,scopeIndex:0,itemKey:'first',itemIndex:0};
    nav.applyHardwareNavFocus(location);assert.equal(first.scrolls,1);
    nav.applyHardwareNavFocus(location);assert.equal(first.scrolls,1);
});
test('touching blank list space shares that list and starts from its selected row',()=>{
    global.document = new Element(); document.events = {};
    document.addEventListener = (name, callback) => document.events[name] = callback;
    document.removeEventListener = name => delete document.events[name];
    const nav=load('src/hardwareNav.ts');let shared=null;
    nav.watchHardwareNavFocus(undefined, location=>shared=location);
    const banks=document.add(new Element('div','split-list',{'data-mfx-nav-list':'banks'}));
    const bank1=banks.add(button('selected')),bank2=banks.add(button());
    touch(banks);assert.equal(shared.scopeName,'banks');assert.equal(shared.itemIndex,-1);const blank={...shared};
    nav.handleHardwareNav({delta:1});assert(marked(bank2));assert(!marked(bank1));
    nav.applyHardwareNavFocus(blank);nav.handleHardwareNav({delta:-1});assert(marked(bank2));
});
console.log(`${count} navigation checks passed`);
