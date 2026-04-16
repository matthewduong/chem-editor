import type { ObjectModule } from '../types';

function createEmptyModule(type: ObjectModule['type']): ObjectModule {
  return {
    type,
    draw() {},
    editCapabilities: () => [],
  };
}

export const FRAGMENT_MODULE = createEmptyModule('fragment');
export const GROUP_MODULE = createEmptyModule('group');
