# README 插画

- 用途：Cat’s Library 项目首页横幅与「阅读／收藏／创作」三联插画，均为品牌插画，不是产品界面截图。
- 生成日期：2026-11-06。
- 来源：内置 `image_gen` 工具；未使用 CLI/API 回退模式，无外部参考图片。
- 交付：[hero.webp](readme/hero.webp)、[features.webp](readme/features.webp)。
- 处理：仅将生成的 PNG 编码为 WebP（quality 88），保留原始 2172 × 724 尺寸及画面，未裁切。生成原稿保留在本机 Codex generated_images 目录。

## 横幅提示词

```text
Use case: illustration-story. Asset type: premium illustrated GitHub README hero banner for the self-hosted novel reading and AI writing project Cat’s Library. Create a finished very wide panoramic landscape illustration, approximately 3:1 aspect ratio, 1800x600. Quiet sophisticated editorial picture-book illustration in muted warm paper cream (#faf9f6), terracotta (#a64d32), deep charcoal, soft sage and biscuit brown, fine hand-drawn ink contours and subtle printed-paper grain, restrained and spacious, mature and charming. Composition: airy cream background with carefully typeset large elegant dark serif title on the left reading EXACTLY “Cat’s Library” (curly apostrophe), below it tiny widely spaced sans-serif text EXACTLY “READ · COLLECT · CREATE”. On the right half a charming sleepy cream-and-ginger cat curled on an open book at a wooden library desk, tail curls around the book, beside a small stack of books, warm terracotta reading lamp, and a quiet arched window with leafy branch silhouette. One tiny discreet cat paw motif near the left title. Scene should feel like a beautifully art-directed independent literary journal, flat gouache and delicate pen illustration, not photorealistic, not 3D. Keep generous margins, no objects or lettering clipped, balanced negative space. Avoid childish cartoon eyes, busy backgrounds, neon, UI mockups, extraneous lettering, watermarks. Background opaque. Save the final selected image locally and include its absolute file path in output_hint so it can be copied into the repository.
```

## 三联插画提示词

```text
Use case: illustration-story. Asset type: a single panoramic three-vignette feature illustration strip for the GitHub README of Cat’s Library. Approx 3:1 landscape ratio 1800x600. Match the established brand: premium quiet editorial gouache-and-pen picture-book illustration, warm cream paper background #faf9f6 with subtle paper grain, terracotta #a64d32, charcoal, muted sage, biscuit orange. Three equally spaced separate small still-life vignettes on the SAME uninterrupted cream background with lots of breathing room, each occupies its own third; no vertical lines, no border, no panels, no text anywhere. Left vignette, READING: a little cream-and-ginger cat sitting behind an open book under a small terracotta reading lamp, gentle attentive pose. Middle vignette, COLLECTING: tidy little wooden bookshelf filled with a few sage and terracotta books with ribbon bookmarks and the same cat reaching one paw toward a book. Right vignette, CREATING: a little cream-and-ginger cat at a writing desk, an elegant fountain pen resting across an open manuscript notebook, three tiny gold star glints above the notebook to suggest inspiration; physically plausible cat paws, pen is resting not held in human fingers. Polished independent literary journal art direction, fine warm ink outlines, tactile flat gouache, rounded gentle shapes with realistically feline features, not childish cartoon, no 3D, no photorealism. Keep entire compositions inside generous margins, consistent scale, clear silhouettes even at 300px wide per vignette. No humans, no logos, no lettering, no watermarks. Opaque background. Save final selected image locally and provide the absolute path in output_hint.
```
