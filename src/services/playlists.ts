import type { Playlist } from '@/types'
import * as gs from '@/services/googleSheets'

export async function loadPlaylists(userId: string): Promise<Playlist[]> {
  return gs.getPlaylists(userId)
}

export async function savePlaylist(playlist: Playlist): Promise<void> {
  await gs.upsertPlaylist(playlist)
}

export async function deletePlaylist(id: string): Promise<void> {
  await gs.removePlaylist(id)
}
