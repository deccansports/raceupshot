import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const source = new URL('../../../public/bmlogo.png', import.meta.url);
const output = new URL('../assets/images/splash-logo.png', import.meta.url);
const brandOrange = [245, 130, 31];

const { data, info } = await sharp(fileURLToPath(source))
  .extract({ left: 200, top: 140, width: 1500, height: 400 })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

for (let offset = 0; offset < data.length; offset += 4) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const isOrange = red > green + 35 && green > blue + 25;
  const average = (red + green + blue) / 3;
  const coverage =
    average < 120 || (isOrange && blue < 100)
      ? 1
      : isOrange
        ? Math.min(1, Math.max(0, (255 - blue) / (255 - brandOrange[2])))
        : Math.min(1, Math.max(0, (255 - average) / 135));

  data[offset] = brandOrange[0];
  data[offset + 1] = brandOrange[1];
  data[offset + 2] = brandOrange[2];
  data[offset + 3] = Math.round(coverage * 255);
}

// Android launch screens may mask or inset the image. Keep the complete
// horizontal wordmark inside a transparent safe area so neither edge can be
// cropped while retaining the intended on-screen logo size.
const logo = await sharp(data, { raw: info }).png().toBuffer();

await sharp({
  create: {
    width: 1800,
    height: 600,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: logo, left: 150, top: 100 }])
  .png()
  .toFile(fileURLToPath(output));
console.log(`Generated ${output.pathname}`);
