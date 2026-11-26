# 私人书架与桌面书房

2026-11-26 源码候选：API 1.14.0 / Web 1.13.0；iOS 沿用 1.4.0 / build 31 候选。

## 私人书架

Web 在「我的书架 → 收藏」直接选择分组、搜索书名／作者／收藏理由，在书籍下方编辑分组与理由。iOS 在书架右上角「筛选与排序」选择私人分组或「整理书架」；整理页支持批量勾选、改名和删除分组。

- 每个账号最多 40 个分组，名称最多 30 个 UTF-16 单位；一本书可以属于多个分组。
- 收藏理由最多 500 个 UTF-16 单位，只随本人书架返回，不进入作品详情、公开评论或其他账号。
- 置顶书排在前面；「我的顺序」可用上移／下移调整，在当前分组内移动时保留其他书籍的相对次序，不能越过置顶边界。顺序属于整份私人书架，不为每个分组另存一份。
- 一次最多整理 100 本，批量加入／移出分组不会替换其他归类。删除分组会保留书籍、收藏理由和置顶。
- 收藏理由和整份分组选择携带 `organizationVersion`；另一端更新后，旧编辑返回 409，保留输入，关闭后重新打开核对。批量增减归类和置顶按明确字段更新，不覆盖理由。
- 移出收藏会删除该书的整理信息；Web 的即时撤销会重新加入收藏，并尝试恢复理由、仍存在的分组和置顶。原手动排序位置不恢复；其他设备已重新整理时，不用旧版本覆盖。

新增 `098_private_bookshelf.sql`，在 `user_bookshelf` 增加理由、置顶、排序和版本；`bookshelf_groups` 与 `bookshelf_group_members` 使用账号复合键及级联外键。所有写入核对本人收藏、当前作品可见性和内容模式。批量写入在同一事务内执行；成员查询、数量、排序与分页采用一致的访问范围。迁移先于 API，API 先于客户端。

接口位于 `/api/bookshelf/organization`：`GET/POST /groups`、`PATCH/DELETE /groups/:id`、`PATCH /entries`、`POST /move`。原 `/api/bookshelf` 新增 `groupId`、`sort=manual` 参数，收藏条目新增可选字段，旧客户端可以继续读取。

## iOS 小组件

两种组件：「继续阅读」显示最近读过的安全作品和本章进度；「收藏的句子」轮换本人最近 20 则可见划句。支持小号、中号桌面，以及矩形和行内锁屏组件。App「我的 → 收藏 → 桌面上的书房」提供添加说明、同步时间、失败提示与手动更新。

主 App 经登录态获取 `/api/bookshelf/widgets` 并写入 App Group 快照；扩展只读快照，不保存或使用账号 Token，不自行联网。快照绑定站点和账号摘要、最多有效 24 小时；时间线每两小时切换候选划句，过期安排空态。打开 App、同步阅读进度和发布划句时请求更新；删除划句先清除缓存里的句子，再同步。实际显示及刷新时机由 WidgetKit 决定，不承诺即时刷新。

小组件始终排除受限作品，沿用作品可见性；锁屏内容使用 `privacySensitive`。退出账号会清理共享文件、取消旧请求并请求重载；重新登录不同账号不会沿用旧内容。系统已渲染的界面仍取决于系统重载时机，远端删除／权限变化也需要下一次同步或打开时复核。

点击使用 `catslibrary://widget/continue` 或 `/quote`，仅携带账号摘要和记录 ID。App 校验当前账号后，通过 `/api/bookshelf/widgets/open` 再检查本人归属、是否删除和访问范围；随后按当前章节 ID 打开阅读器，划句沿用书内搜索定位。正文改动导致原句不再匹配时，仍可阅读该章，不保证旧划句的字符位置仍存在。

## 构建与签名

`ios/project.yml` 新增 `ZhiZhouWidgets` 扩展并由主 App 嵌入。两端共编译 `WidgetShared`，主 App 与扩展的市场版本、构建号必须一致。CI 检查扩展可执行文件、Info.plist 以及两端版本一致性，未签名 IPA 继续包含整个 App 及其扩展。

App Group 默认值为工程级 `LIBRARY_WIDGET_APP_GROUP = group.com.zhizhou.app`。构建和签名时，主 App 与扩展必须使用同一开发团队获准的 App Group；自定义 bundle ID／重签名时，也须一致修改这个设置并保留扩展与双方的共享 entitlement。主 App bundle ID 为 `com.zhizhou.app`，扩展为 `com.zhizhou.app.widgets`。未具备共享权限的安装包仍可使用书架，组件没有个人数据，说明页会提示当前安装包未启用共享。

本轮仅交付源码，未递增已有候选构建号；交付包含新源码的新 IPA 时，主 App 和扩展一起递增构建号。本轮没有触发云构建、签名、IPA 分发或生产迁移。

参考 Apple 的 [App Groups 配置](https://developer.apple.com/documentation/xcode/configuring-app-groups) 与 [创建 Widget 扩展](https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension)。

## 验证与待验收

API 定向用例覆盖账号隔离、多重归类、旧版本冲突、批量事务、内容可见性、排序、删除分组保留信息，以及小组件读取与跳转的重新鉴权。迁移在隔离 PGlite 库按顺序执行。Web 用例覆盖现有书架流程、私人备注检索、保存失败保留输入、批量追加分组、删除确认与撤销恢复。

Windows 可执行类型、定向回归、Swift 语法和 plist／YAML 检查；新增 Swift 测试覆盖快照过期、深链参数转义和拒绝歧义参数，尚未执行 XCTest。没有 Xcode 原生构建、模拟器或真机验收，也未做浏览器视觉验收。发布前需在 iPhone／iPad 核对分组往返、整理后续读、小组件四种尺寸、深浅主题、冷启动与账号退出、共享签名和锁屏隐私显示。
