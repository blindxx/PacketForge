import type { EngineSnapshot } from "@packetforge/engine";

export type ProfileId = string;
export type SchemaVersion = string;

export interface ProfileRecord {
  id: ProfileId;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotMetadata {
  profileId: ProfileId;
  namespace: string;
  updatedAt: string;
}

export interface StoredSnapshot<TState = unknown> {
  schemaVersion: SchemaVersion;
  metadata: SnapshotMetadata;
  engine: EngineSnapshot<TState>;
}

export interface ProfileRegistry {
  listProfiles(): Promise<ProfileRecord[]>;
  getProfile(profileId: ProfileId): Promise<ProfileRecord | null>;
  createProfile(displayName: string): Promise<ProfileRecord>;
  renameProfile(profileId: ProfileId, displayName: string): Promise<ProfileRecord>;
  deleteProfile(profileId: ProfileId): Promise<void>;
}

export interface ProfileNamespaceStorage<TState = unknown> {
  loadSnapshot(profileId: ProfileId, namespace: string): Promise<StoredSnapshot<TState> | null>;
  saveSnapshot(snapshot: StoredSnapshot<TState>): Promise<void>;
  clearNamespace(profileId: ProfileId, namespace: string): Promise<void>;
}

export interface SchemaMigrationContext<TState = unknown> {
  fromVersion: SchemaVersion;
  toVersion: SchemaVersion;
  snapshot: StoredSnapshot<TState>;
}

export interface StorageMigrationHook<TState = unknown> {
  migrate(context: SchemaMigrationContext<TState>): Promise<StoredSnapshot<TState>>;
}

export interface StorageAdapter<TState = unknown> {
  schemaVersion: SchemaVersion;
  profiles: ProfileRegistry;
  namespaces: ProfileNamespaceStorage<TState>;
  migrationHook?: StorageMigrationHook<TState>;
}
