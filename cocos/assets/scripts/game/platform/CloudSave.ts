/**
 * 云存档接口（Phase 4）。默认走本地 Storage；接入账号体系后实现 push/pull 即可。
 */
import { Storage, STORAGE_KEYS } from './Storage';

export interface CloudSaveAdapter {
    pull(): Promise<string | null>;
    push(blob: string): Promise<void>;
}

class LocalCloudSave implements CloudSaveAdapter {
    async pull(): Promise<string | null> {
        return Storage.get(STORAGE_KEYS.save);
    }
    async push(blob: string): Promise<void> {
        Storage.set(STORAGE_KEYS.save, blob);
    }
}

export const CloudSave = {
    adapter: new LocalCloudSave() as CloudSaveAdapter,
    use(a: CloudSaveAdapter): void {
        this.adapter = a;
    },
};
