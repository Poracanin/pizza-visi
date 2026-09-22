# Kamenné pozadí podle reference

Aktuální zákaznický web používá tmavou břidlicovou desku s jemnými oděrkami a surovinami po krajích. Vychází z uživatelem dodaného snímku z 22. 9. 2026; převzat je materiál a okrajové rozmístění dekorací. Červené akcenty, rozvržení, fotografie poboček a objednávkové funkce zůstávají. Úvodní fotografie pobočky má průhledný přechod do kamene.

Podklad byl vytvořen vestavěným nástrojem ImageGen, následně pouze převeden do WebP (kvalita 84). Výsledný soubor: `public/assets/textures/charcoal-slate.webp`. Původní dřevěný podklad `smoked-wood-flour.webp` už hlavní web nepoužívá.

CSS aplikuje jeden navazující podklad pod sekcemi a lehké ztmavení kvůli čitelnosti. Minimální šířka pozadí 1440 px ořízne na mobilu dekorace mimo text; karty a objednávkové dialogy mají jednolité tmavé povrchy.

## Finální prompt

```text
Use case: photorealistic-natural.
Asset type: background photography for an existing modern black and red pizzeria website, not a website mockup.
Primary request: dark charcoal slate tabletop with delicate natural scuffs, fine stone grain and a few understated pizza ingredients around the extreme side edges, like overhead Italian food photography.
Composition: portrait 1536x2048. Flat top-down surface fills the whole frame. The middle 84% of the width must be uninterrupted empty dark stone, reserved for real website content. Only at the extreme left and right 8%: three small individual arugula leaves, two thin mushroom slices, a tiny scattering of peppercorns. These ingredients should be small, sparsely placed at different heights, partly cropped at the side edges. Upper and lower 12% pure stone without props, matching dark tone, suitable for subtle vertical repetition.
Texture: matte natural slate, fine irregular veins, delicate hairline scratches and faint rubbed flour traces, quiet tactile depth. No wooden boards, no geometric pattern, no cracks or seams. A smooth low-contrast surface that remains visibly stone rather than flat black.
Lighting: even soft diffuse light, no spotlight, gentle natural contact shadows under ingredients.
Palette: near-black charcoal stone, approximately #1b1d1e, fine grain from #121415 to #292b2c, muted natural greens and mushroom neutrals, no strong grey wash or bright white flour.
Constraints: background only. No pizza, plate, bowl, cutlery, tablecloth, hands, people, text, typography, logo, watermark, frame, UI or cards. Keep all objects away from the central content area. Photorealistic, refined and restrained.
```
