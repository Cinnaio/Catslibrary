# README 插画

## 2026-11-28 · 花影书房横幅

- 现用横幅为 [flower-library.webp](readme/flower-library.webp)，以用户提供的银粉色猫娘三视图和原立绘为角色参考。
- 使用内置 `image_gen` 生成并调整构图，原尺寸为 2172 × 724。将 PNG 编码为 WebP，保留完整画面。
- [书架](readme/bookshelf.webp)和[阅读器](readme/reader.webp)是本地 Web 界面截图，书目、封面与章节使用示例内容。

### 生成提示词

```text
Use case: illustration-story. Create a polished wide 3:1 landscape banner for a GitHub README, approximately 2400 × 800. The two local images are reference material only. Reference 1 is the user's original character turnaround for costume and flourishes, and reference 2 is the user's original single character illustration for her recognizable face, soft delicate rendering, and distinctive over-the-shoulder glance. Create an entirely fresh setting and composition while faithfully preserving her silver-blush long wavy hair, braided circlet, large pale cat ears with pink inside, rose-pink eyes, five-petal white-blush flowers beside the nearer ear, flowing pink silk ribbons and pendants, ivory floral neck ornament, delicate ivory and blush layered dress, ruffle sleeves, and a glimpse of a fluffy pale tail if it fits naturally.
Composition: approximately 55% on the left is a spacious warm ivory paper field. On the right, a waist-up view of her seated sideways at a subtly rendered desk, gently looking back toward the viewer as if called while turning the pages of an open book. Keep her full ears, head silhouette and hands comfortably inside the frame, no cut ear tips, hands anatomically coherent. Her calm subtle expression echoes the reference. One thin pink ribbon bookmark. Behind her, a very subtle dusty lilac-gray window shadow and soft blossom shadows separate the light hair and ears from the background; let the warm paper field blend seamlessly into the soft setting. Airy and refined anime illustration, fine hair and fabric, muted blush with warm white #FAF9F6, gray mauve and little other color. One coherent quiet illustration, no dark reference backdrop, no busy bookshelves, other characters or ornate frames.
Text exactly two lines, on the left near the vertical middle: “Cat’s Library” in generous editorial serif lettering in dark plum-grey, and on the line below “故事翻到这里，刚好遇见你。” in legible smaller Chinese serif letters in muted plum-grey. The quote marks in this instruction are delimiters only. No extra text, badges, symbols or watermarks. Give the text and character generous safety margins for the full wide composition.
```

### 构图调整提示词

```text
Make a targeted framing correction to this existing GitHub README banner, keeping its 3:1 aspect ratio and exact text, “Cat’s Library” and “故事翻到这里，刚好遇见你。”. Move the whole illustrated scene very slightly down and zoom the right-side scene out by about 12–15%, so the previously clipped tall rear cat ear is now fully visible with at least 45 pixels of clear paper/window air above both ear tips at a 2160 × 720 size. Extend the existing soft warm paper and window shadow naturally into the top of the frame, and preserve the complete illustrated open book and both hands. Retain the exact silver-pink cat-girl character, identity, over-the-shoulder face, small smile, braid, flowers and dangling ribbons, the soft lilac window shadows, the warm ivory paper texture, and the overall composition. Keep the typography and layout otherwise as close to the input as possible. The two quoted lines are the only text and must be reproduced exactly without their enclosing quotes.
```

## 2026-11-06 · 书房猫咪系列

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
