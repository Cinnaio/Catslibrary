export interface BookshelfGroup { id: string; name: string; count: number }
export interface ShelfOrganization {
  note?: string
  pinned?: boolean
  position?: number
  organizationVersion?: number
  groupIds?: string[]
}
export interface ShelfEdit {
  novelIds: string[]
  note?: string
  pinned?: boolean
  groupIds?: string[]
  addGroupIds?: string[]
  removeGroupIds?: string[]
  expectedVersion?: number
}
