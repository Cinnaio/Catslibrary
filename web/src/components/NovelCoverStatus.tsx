/** 封面共用状态：只读提示，不在书目链接内嵌套操作按钮。 */
export default function NovelCoverStatus({ updates = 0, read = false, favorite = false }: { updates?: number; read?: boolean; favorite?: boolean }) {
  return (
    <>
      {updates > 0 && (
        <span className="novel-cover-status novel-cover-status--update" title={`有 ${updates} 章待更新`} aria-label={`有 ${updates} 章待更新`}>
          {updates > 99 ? '99+' : `+${updates}`}
        </span>
      )}
      {(read || favorite) && (
        <span className="novel-cover-status novel-cover-status--reading">
          {read && (
            <span className="novel-cover-status-label" title="有阅读记录" aria-label="有阅读记录">
              读过
            </span>
          )}
          {favorite && (
            <span className="novel-cover-status-label" title="已收藏" aria-label="已收藏">
              收藏
            </span>
          )}
        </span>
      )}
    </>
  )
}
