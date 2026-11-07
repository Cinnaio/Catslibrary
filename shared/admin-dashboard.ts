export interface DashboardFollowupBook {
  novelId: string
  title: string
  enabled: boolean
  intervalHours: number
  nextCheckAt: number
  checkedAt: number
  result: string
  message: string
  addedCount: number
  blockedReason?: string
}

export interface DashboardFollowups {
  enabled: number
  waiting: number
  running: number
  attention: number
  scheduled: DashboardFollowupBook[]
  issues: DashboardFollowupBook[]
  recent: DashboardFollowupBook[]
}
