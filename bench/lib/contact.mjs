// Contact sheet of filmstrip frames: node bench/lib/contact.mjs out.png cols f1.png f2.png ...
import fs from 'node:fs';
import { decodePNG, encodePNG } from './image.mjs';
const [out, colsArg, ...files] = process.argv.slice(2);
const imgs = files.map((f) => decodePNG(fs.readFileSync(f)));
const w = imgs[0].width, h = imgs[0].height, cols = +colsArg, rows = Math.ceil(imgs.length / cols);
const sheet = { width: w * cols, height: h * rows, data: new Uint8Array(w * cols * h * rows * 4) };
imgs.forEach((im, i) => {
  const ox = (i % cols) * w, oy = Math.floor(i / cols) * h;
  for (let y = 0; y < h; y++) sheet.data.set(im.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * sheet.width + ox) * 4);
});
fs.writeFileSync(out, encodePNG(sheet));
