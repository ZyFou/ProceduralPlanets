# Procedural Planets logo

The logo is based on the image supplied by the project owner. Its white background was removed with the built-in imagegen tool (`background-extraction`, transparent background enabled). The selected PNG was cropped and resized for application use while preserving its alpha channel.

- Main transparent image: `public/branding/procedural-planets-logo.png`
- Browser icons: `public/branding/favicon-32.png`, `public/branding/icon-192.png`
- Touch icon: `public/branding/apple-touch-icon.png`
- Shared React component: `src/components/Logo.jsx`

## Imagegen prompt

> Pure background removal, NOT illustration generation. Extract the exact supplied blue planet emblem, retaining original hard-edged flat shapes and colors. Every white pixel in the source is empty and must become transparent alpha=0. The output MUST be a transparent PNG cutout: NO black background, NO colored background, NO glow, NO shadow, NO blur, NO halo, NO additional effects. Keep clean transparent separation around the orbital ring and moons. Preserve original geometry and original colors. Output the logo isolated on actual fully transparent background.
