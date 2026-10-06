import { afterEach, describe, expect, it, vi } from 'vitest';
import { Planet } from '../src/lib/index.js';
import { Explorer } from '../src/exploration/Explorer.js';
import { DEFAULT_SETTINGS } from '../src/exploration/settings.js';
import { PerspectiveCamera } from 'three';
import { Flight } from '../src/exploration/flight.js';
import { position, relative, length } from '../src/exploration/world.js';

afterEach(() => vi.unstubAllGlobals());
function mockExplorer() {
  vi.stubGlobal('window', {devicePixelRatio:1});
  const canvas={clientWidth:1000,clientHeight:600,width:1000,height:600,ownerDocument:{pointerLockElement:null,exitPointerLock:vi.fn()}};
  const renderer={capabilities:{maxTextureSize:4096},ratio:1,getPixelRatio(){return this.ratio},setPixelRatio(v){this.ratio=v},setSize(w,h){canvas.width=Math.floor(w*this.ratio);canvas.height=Math.floor(h*this.ratio)}};
  const explorer=Object.assign(Object.create(Explorer.prototype),{canvas,renderer,settings:{...DEFAULT_SETTINGS},walker:{exit:vi.fn(),clear:vi.fn()},flight:{clear:vi.fn()},camera:{updateProjectionMatrix:vi.fn()},stream:{entries:new Map()},planets:{release:vi.fn()},disposed:false,capturing:false,frame:vi.fn()});
  return explorer;
}
describe('exploration render settings and photo lifecycle',()=>{
  it('teleports to orbit, cancels movement and discovers the destination immediately', () => {
    const e = mockExplorer(); e.camera = new PerspectiveCamera();
    e.flight = new Flight(position(), e.camera);
    e.stream.discover = vi.fn();
    const body = { id: 'remote', radius: 6371, type: 'terrestrial', position: position({x:42,y:7,z:-20}) };
    e.flight.keys.add('KeyW'); e.flight.approaching = body;
    e.teleport(body);
    expect(length(relative(e.flight.position, body.position))).toBeCloseTo(body.radius * 2.8, 4);
    expect(e.target).toBe(body); expect(e.flight.keys.size).toBe(0); expect(e.flight.approaching).toBe(null);
    expect(e.stream.discover).toHaveBeenCalledWith(e.flight.position, body.id);
    expect(e.nextLoad).toBe(0); expect(e.nextHud).toBe(0);
    const star = { ...body, type: 'star', radius: 696340 };
    e.teleport(star);
    expect(length(relative(e.flight.position, star.position))).toBeCloseTo(star.radius * 5, 4);
  });
  it('picks the nearest planet under the pointer or reticle, including its visible edge', () => {
    const e = mockExplorer(); e.camera = new PerspectiveCamera(65, 1000/600, .1, 1e9);
    e.canvas.getBoundingClientRect = () => ({left:100,top:50,width:1000,height:600});
    e.flight = new Flight(position(), e.camera);
    const far = {id:'far',radius:100,position:position(undefined,{x:0,y:0,z:-2000})};
    const near = {id:'near',radius:100,position:position(undefined,{x:0,y:0,z:-300})};
    e.stream.systems = [{bodies:[far,near]}];
    expect(e.pick()).toBe(near);
    expect(e.pick({clientX:740,clientY:350})).toBe(near);
    expect(e.pick({clientX:1090,clientY:60})).toBe(null);
    expect(e.target).toBe(near);
  });
  it('applies live package settings and only releases changed cached bodies',()=>{
    const e=mockExplorer(),resource=new Planet({preset:'terran',cloudQuality:24,maxDepth:9});
    resource.userData.explorationIntrinsic={cloudsEnabled:true,atmoEnabled:true,gasAtmoStrength:resource.params.gasAtmoStrength,starBloom:resource.params.starBloom};
    e.stream.entries.set('Earth',{resource});
    e.setSettings({...DEFAULT_SETTINGS,clouds:false,maxDepth:7,cloudSteps:12,cloudDetailScale:1.75,showTargetMarker:false,layout:'azerty'});
    expect(resource.world.opts.maxDepth).toBe(7);expect(resource.uniforms.uCloudShadowStr.value).toBe(0);
    expect(resource.params.cloudQuality).toBe(12);expect(e.flight.layout).toBe('azerty');expect(e.planets.release).toHaveBeenCalledOnce();
    expect(resource.params.cloudDetailScale).toBe(1.75);expect(e.settings.showTargetMarker).toBe(false);
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
