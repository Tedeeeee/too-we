import { EMPTY_SETTINGS } from './mappers';

export function createSettingsRepository() {
  return {
    async getSettings() {
      return { ...EMPTY_SETTINGS };
    },
  };
}
