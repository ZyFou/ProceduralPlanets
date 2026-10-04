import { afterEach, describe, expect, it, vi } from 'vitest';
import { Planet } from '../src/lib/index.js';
import { Explorer } from '../src/exploration/Explorer.js';
import { DEFAULT_SETTINGS } from '../src/exploration/settings.js';

afterEach(() => vi.unstubAllGlobals());
function mockExplorer() {
  vi.stubGlobal('window', {devicePixelRatio:1});
  const canvas={clientWidth:1000,clientHeight:600,width:1000,height:600,ownerDocument:{pointerLockElement:null,exitPointerLock:vi.fn()}};
  const renderer={capabilities:{maxTextureSize:4096},ratio:1,getPixelRatio(){return this.ratio},setPixelRatio(v){this.ratio=v},setSize(w,h){canvas.width=Math.floor(w*this.ratio);canvas.height=Math.floor(h*this.ratio)}};
  const explorer=Object.assign(Object.create(Explorer.prototype),{canvas,renderer,settings:{...DEFAULT_SETTINGS},flight:{clear:vi.fn()},camera:{updateProjectionMatrix:vi.fn()},stream:{entries:new Map()},planets:{release:vi.fn()},disposed:false,capturing:false,frame:vi.fn()});
  return explorer;
}
describe('exploration render settings and photo lifecycle',()=>{
  it('applies live package settings and only releases changed cached bodies',()=>{
    const e=mockExplorer(),resource=new Planet({preset:'terran',cloudQuality:24,maxDepth:9});
    resource.userData.explorationIntrinsic={cloudsEnabled:true,atmoEnabled:true,gasAtmoStrength:resource.params.gasAtmoStrength,starBloom:resource.params.starBloom};
    e.stream.entries.set('Earth',{resource});
    e.setSettings({...DEFAULT_SETTINGS,clouds:false,maxDepth:7,cloudSteps:12,layout:'azerty'});
    expect(resource.world.opts.maxDepth).toBe(7);expect(resource.uniforms.uCloudShadowStr.value).toBe(0);
    expect(resource.params.cloudQuality).toBe(12);expect(e.flight.layout).toBe('azerty');expect(e.planets.release).toHaveBeenCalledOnce();
    e.setSettings(e.settings);expect(e.planets.release).toHaveBeenCalledOnce();
    e.setSettings({...e.settings,clouds:true});expect(resource.params.cloudsEnabled).toBe(true);
    resource.dispose();
  });
  it('bounds render pixels and hardware texture dimensions on oversized viewports',()=>{
    const e=mockExplorer();e.canvas.clientWidth=12000;e.canvas.clientHeight=8000;e.settings.renderScale=2;e.resize();
    expect(e.canvas.width).toBeLessThanOrEqual(4096);expect(e.canvas.height).toBeLessThanOrEqual(4096);
    expect(e.canvas.width*e.canvas.height).toBeLessThanOrEqual(16_777_216);
  });
  it('clears approach/movement and releases capture on entering photo mode',()=>{
    const e=mockExplorer();e.canvas.ownerDocument.pointerLockElement=e.canvas;e.setPhoto(true);
    expect(e.photo).toBe(true);expect(e.flight.clear).toHaveBeenCalledOnce();expect(e.canvas.ownerDocument.exitPointerLock).toHaveBeenCalledOnce();
    e.setPhoto(false);expect(e.photo).toBe(false);
  });
  it('captures a bounded PNG, prevents overlapping capture and restores rendering on failure',async()=>{
    const e=mockExplorer();let complete;e.canvas.toBlob=(callback)=>{complete=callback};
    const pending=e.takePhoto(20);expect(e.capturing).toBe(true);expect(e.frame).toHaveBeenCalledWith(0);
    expect(e.canvas.width).toBeLessThanOrEqual(4096);expect(e.canvas.height).toBeLessThanOrEqual(2160);
    expect(await e.takePhoto(1)).toBe(null);
    complete(new Blob(['image'],{type:'image/png'}));const image=await pending;
    expect(image.blob.type).toBe('image/png');expect(e.renderer.ratio).toBe(1);expect(e.capturePixelRatio).toBe(null);
    const failed=e.takePhoto(2);complete(null);await expect(failed).rejects.toThrow('Image capture failed');
    expect(e.capturing).toBe(false);expect(e.canvas.width).toBe(1000);expect(e.renderer.ratio).toBe(1);
  });
});
