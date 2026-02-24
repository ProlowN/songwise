export interface ApiResource {
  id: string;
  type: string;
  href?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

export interface ApiResponse<T = ApiResource> {
  data: T[];
  next?: string;
  meta?: { total: number };
}

export interface SongAttributes {
  name: string;
  artistName: string;
  albumName: string;
  durationInMillis: number;
  trackNumber: number;
  genreNames?: string[];
  [key: string]: unknown;
}

export interface PlaylistAttributes {
  name: string;
  description?: { standard: string };
  canEdit: boolean;
  dateAdded?: string;
  lastModifiedDate?: string;
  [key: string]: unknown;
}

export interface LibrarySong extends ApiResource {
  type: "library-songs";
  attributes: SongAttributes;
}

export interface LibraryPlaylist extends ApiResource {
  type: "library-playlists";
  attributes: PlaylistAttributes;
}
