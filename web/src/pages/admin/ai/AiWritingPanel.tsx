/** AI 创作工作台：新写 / 续写，生成结果先保存为草稿。 */
import { useEffect, useState } from 'react'
import { aiApi, novelsApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import CustomSelect from '@/components/admin/CustomSelect'

export default function AiWritingPanel() {
  const { toast } = useToast()
  const [mode, setMode] = useState<'new' | 'continue'>('new')
  const [novels, setNovels] = useState<Array<{ id: string; title: string }>>([])
  const [novelId, setNovelId] = useState('')
  const [title, setTitle] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [outline, setOutline] = useState('')
  const [targetWords, setTargetWords] = useState(2000)
  const [chapterCount, setChapterCount] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void novelsApi.list({ limit: 100, page: 1 }).then((data) => setNovels(data.novels.map((novel) => ({ id: novel.id, title: novel.title })))).catch((err) => toast((err as Error).message, 'error'))
  }, [toast])

  async function generateOutline() {
    if (!title.trim()) return toast('请填写作品标题', 'error')
    setBusy(true)
    try {
      await aiApi.writing.outline({ novelId, title, instruction, targetWords, chapterCount })
      toast('大纲已生成，请到“已生成内容”查看', 'success')
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }

  async function generateChapter() {
    if (!novelId || !chapterTitle.trim()) return toast('请选择小说并填写章节标题', 'error')
    setBusy(true)
    try {
      await aiApi.writing.chapter({ novelId, title, outline, instruction, targetWords, chapterCount })
      toast('章节已生成，请到“已生成内容”查看', 'success')
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }

  async function continueNovel() {
    if (!novelId) return toast('请选择小说', 'error')
    setBusy(true)
    try {
      await aiApi.writing.continue({ novelId, title: chapterTitle, instruction, targetWords, chapterCount })
      toast('续写已生成，请到“已生成内容”查看', 'success')
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }

  return <div className="space-y-4">
    <Card>
      <CardHeader><CardTitle className="text-base">AI 创作工作台</CardTitle><p className="text-sm text-muted-foreground">生成结果先保存为草稿，编辑确认后再发布为正式章节。</p></CardHeader>
      <CardContent className="grid gap-4">
        <Tabs value={mode} onValueChange={(value) => setMode(value as 'new' | 'continue')}>
          <TabsList><TabsTrigger value="new">新写</TabsTrigger><TabsTrigger value="continue">续写</TabsTrigger></TabsList>
        </Tabs>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>目标小说</Label>
            <CustomSelect
              options={novels.map((novel) => ({ value: novel.id, label: novel.title }))}
              value={novelId}
              onChange={setNovelId}
              placeholder="选择小说"
              searchable
              searchPlaceholder="搜索小说名称…"
              dropdownSide="bottom"
            />
          </div>
          <div className="grid gap-1.5"><Label>{mode === 'new' ? '作品标题' : '章节标题（可选）'}</Label><Input value={mode === 'new' ? title : chapterTitle} onChange={(event) => mode === 'new' ? setTitle(event.target.value) : setChapterTitle(event.target.value)} placeholder={mode === 'new' ? '例如：雾城来信' : '例如：第十二章 暴雨前夜'} /></div>
        </div>
        {mode === 'new' && <div className="grid gap-1.5"><Label>章节标题</Label><Input value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} placeholder="例如：第一章 雾中来客" /></div>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1.5"><Label>{mode === 'continue' ? '每章目标字数' : '目标字数'}</Label><Input type="number" min={300} max={30000} step={100} value={targetWords} onChange={(event) => setTargetWords(Number(event.target.value) || 300)} /></div>
          {mode === 'continue' && (
            <div className="grid gap-1.5">
              <Label>续写章节数</Label>
              <Input type="number" min={1} max={20} value={chapterCount} onChange={(event) => setChapterCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} />
            </div>
          )}
        </div>
        <div className="grid gap-1.5"><Label>创作要求</Label><textarea className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="人物、风格、冲突、节奏或本次剧情目标" /></div>
        {mode === 'new' && <div className="grid gap-1.5"><Label>大纲（生成章节时使用）</Label><textarea className="min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={outline} onChange={(event) => setOutline(event.target.value)} placeholder="先生成大纲，或直接粘贴已有大纲" /></div>}
        <div className="flex flex-wrap gap-2">
          {mode === 'new' ? <><Button variant="secondary" disabled={busy} onClick={() => void generateOutline()}>生成大纲</Button><Button disabled={busy} onClick={() => void generateChapter()}>生成章节</Button></> : <Button disabled={busy} onClick={() => void continueNovel()}>生成续写</Button>}
        </div>
      </CardContent>
    </Card>
  </div>
}
