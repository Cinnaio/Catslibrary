import type { StoryEchoInput, StoryEchoResponse, StoryEchoSource } from '@shared/story-echoes'
import { request } from './api'

export function findStoryEchoes(input: StoryEchoInput): Promise<StoryEchoResponse> {
  return request('POST', '/ai/story-echoes', input, true, {}, 180_000)
}

export function storyEchoSourceURL(novelId: string, source: StoryEchoSource): string {
  const query = new URLSearchParams({ find: source.quote,
    echoParagraph: String(source.paragraphIndex), echoHash: source.paragraphHash })
  return `/read/${encodeURIComponent(novelId)}/${encodeURIComponent(source.chapterId)}?${query}`
}
