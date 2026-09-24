/**
 * 演示数据 —— API 不可用时的离线回退（由 home.js getDemoNovels / novel.js getDemoNovel 平移）。
 * 仅用于断网演示，不参与正常数据流。
 */
import type { ChapterMeta, Novel } from '@shared/types'

function base(id: string, title: string, author: string, description: string, categories: string[], status: string): Novel {
  return {
    id,
    title,
    author,
    description,
    categories,
    status,
    contentRating: 'general',
    coverUrl: '',
    sourceUrl: '',
    chapterCount: 0,
    remoteChapterCount: 0,
    updateCheckedAt: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

const DEMO_NOVELS: Array<Novel & { _chapters: ChapterMeta[] }> = [
  {
    ...base('demo_1', '星辰变', '我吃西红柿', '一部庞大的修真世界，少年秦羽从凡人一步步踏上巅峰。星辰之力，浩瀚无垠。修炼之路，永无止境。', ['修真', '玄幻'], 'completed'),
    chapterCount: 3,
    _chapters: [
      { id: 'dc1_1', novelId: 'demo_1', title: '秦羽', order: 1, wordCount: 3200, sourceUrl: '', createdAt: 0 },
      { id: 'dc1_2', novelId: 'demo_1', title: '流星泪', order: 2, wordCount: 3500, sourceUrl: '', createdAt: 0 },
      { id: 'dc1_3', novelId: 'demo_1', title: '修炼之路', order: 3, wordCount: 2800, sourceUrl: '', createdAt: 0 },
    ],
  },
  {
    ...base('demo_2', '斗破苍穹', '天蚕土豆', '天才少年萧炎在创造了家族空前绝后的修炼纪录后，忽然变成了废人。就在他绝望之际，一缕幽魂从他手上的戒指浮现。', ['玄幻', '热血'], 'completed'),
    chapterCount: 2,
    _chapters: [
      { id: 'dc2_1', novelId: 'demo_2', title: '陨落的天才', order: 1, wordCount: 4000, sourceUrl: '', createdAt: 0 },
      { id: 'dc2_2', novelId: 'demo_2', title: '药老', order: 2, wordCount: 3800, sourceUrl: '', createdAt: 0 },
    ],
  },
  {
    ...base('demo_3', '凡人修仙传', '忘语', '一个普通的山村穷小子，偶然之下，跨入到一个江湖小门派。虽然资质平庸，但依靠自身努力和合理算计最终修炼成仙。', ['修真', '仙侠'], 'ongoing'),
    chapterCount: 2,
    _chapters: [
      { id: 'dc3_1', novelId: 'demo_3', title: '山村少年', order: 1, wordCount: 3600, sourceUrl: '', createdAt: 0 },
      { id: 'dc3_2', novelId: 'demo_3', title: '踏入仙途', order: 2, wordCount: 3400, sourceUrl: '', createdAt: 0 },
    ],
  },
  {
    ...base('demo_4', '全职高手', '蝴蝶蓝', '网游《荣耀》中被誉为教科书级别的顶尖高手叶修，因为种种原因遭到俱乐部的驱逐。', ['游戏', '竞技'], 'completed'),
    chapterCount: 2,
    _chapters: [
      { id: 'dc4_1', novelId: 'demo_4', title: '被驱逐的高手', order: 1, wordCount: 3700, sourceUrl: '', createdAt: 0 },
      { id: 'dc4_2', novelId: 'demo_4', title: '第十区', order: 2, wordCount: 3900, sourceUrl: '', createdAt: 0 },
    ],
  },
  {
    ...base('demo_5', '诡秘之主', '爱潜水的乌贼', '蒸汽与机械的浪潮中，谁能触及非凡？历史与黑暗的迷雾里，又是谁在耳语？', ['奇幻', '悬疑'], 'completed'),
    chapterCount: 2,
    _chapters: [
      { id: 'dc5_1', novelId: 'demo_5', title: '穿越者', order: 1, wordCount: 3500, sourceUrl: '', createdAt: 0 },
      { id: 'dc5_2', novelId: 'demo_5', title: '值夜者', order: 2, wordCount: 3800, sourceUrl: '', createdAt: 0 },
    ],
  },
  {
    ...base('demo_6', '庆余年', '猫腻', '一个年轻的病人，因为一次毫不意外的经历，重生到一个完全不同的世界。', ['历史', '权谋'], 'completed'),
    chapterCount: 2,
    _chapters: [
      { id: 'dc6_1', novelId: 'demo_6', title: '澹州少年', order: 1, wordCount: 3400, sourceUrl: '', createdAt: 0 },
      { id: 'dc6_2', novelId: 'demo_6', title: '京都风云', order: 2, wordCount: 3600, sourceUrl: '', createdAt: 0 },
    ],
  },
]

export function getDemoNovels(): Novel[] {
  return DEMO_NOVELS.map(({ _chapters, ...novel }) => novel)
}

export function getDemoNovel(id: string): (Novel & { _chapters: ChapterMeta[] }) | null {
  return DEMO_NOVELS.find((n) => n.id === id) || null
}
