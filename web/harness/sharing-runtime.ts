import { CloudRuntime, type SharedAppVersion } from '../src/cloud-runtime';
import type { StudioRuntime } from '../src/runtime';

/** Exercises publication UI without account credentials or hosted writes. */
export class SharingRuntime extends CloudRuntime {
  private versions: SharedAppVersion[] = [];
  constructor(base: StudioRuntime) { super(); Object.assign(this, base); }
  override async publishAppVersion(path: string): Promise<SharedAppVersion> {
    const token = crypto.randomUUID();
    const version = { path, token, title: 'Product hero shots', created_at: new Date().toISOString(),
      url: `/app?share=${'a'.repeat(64)}.${token}` };
    this.versions.push(version);
    return version;
  }
  override async listAppVersions(_path: string): Promise<SharedAppVersion[]> { return [...this.versions]; }
  override async revokeAppVersion(token: string): Promise<void> {
    this.versions = this.versions.filter((version) => version.token !== token);
  }
}
