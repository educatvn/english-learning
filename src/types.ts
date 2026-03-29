export interface VideoMeta {
  videoId: string
  title: string
  channelName: string
  thumbnailUrl: string
  addedAt: string
}

export interface Playlist {
  id: string
  name: string
  videoIds: string[]
  createdAt: string
}
