# 花枝默认封面

用户确认采用登录页 `web/public/images/auth-flower.png` 的水彩花枝风格，最终去掉底部“静候翻阅”，保留“知舟”和花枝。

- 原稿：`default-cover-flower-master.png`，1024 × 1536。
- 发布资产：`web/public/images/default-cover-flower.webp`，600 × 900，约 23 KB。
- 生成方式：内置 imagegen；以登录页原花枝作为视觉参考，生成预览后按用户确认进行局部编辑。
- 桌面和移动端截图：`docs/previews/default-cover-flower-desktop.png`、`docs/previews/default-cover-flower-mobile.png`。截图使用真实首页组件和示例 API 数据，不代表线上数据库。

最后一次编辑提示词（原文）：

> Make exactly one small edit to this approved portrait book cover: remove ONLY the four small Chinese characters 静候翻阅 near the bottom, filling their area seamlessly with the surrounding warm cream paper background. Preserve everything else unchanged: the exact 知舟 title, flower shape, petal count, pink colors, twig and leaves, placement, scale, paper texture, margins and full 2:3 portrait framing. Do not redesign, repaint or move the flower or title. Output just the finished full-bleed cover image.

缺省图由项目本地提供，API 构建时复制进 `api/dist/assets`。旧库中标记为 `default` 或旧第三方缺省 URL 的缓存，在响应时展示当前资源；真实源封面、上传和 AI 封面保持原图，后台并发校验继续使用原始存储版本。
