import type { ChemDrawObjectType } from '../../types/chemdraw';
import { ARROW_MODULE } from './modules/arrowModule';
import { BOND_MODULE } from './modules/bondModule';
import { BRACKET_MODULE } from './modules/bracketModule';
import { EMBEDDED_OBJECT_MODULE } from './modules/embeddedObjectModule';
import { FRAGMENT_MODULE, GROUP_MODULE } from './modules/emptyModules';
import { GRAPHIC_MODULE } from './modules/graphicModule';
import { NODE_MODULE } from './modules/nodeModule';
import { TABLE_MODULE } from './modules/tableModule';
import { TEXT_MODULE } from './modules/textModule';
import type { ObjectModule } from './types';

export const OBJECT_MODULES: Record<ChemDrawObjectType, ObjectModule> = {
  node: NODE_MODULE,
  bond: BOND_MODULE,
  arrow: ARROW_MODULE,
  text: TEXT_MODULE,
  graphic: GRAPHIC_MODULE,
  'embedded-object': EMBEDDED_OBJECT_MODULE,
  table: TABLE_MODULE,
  bracket: BRACKET_MODULE,
  fragment: FRAGMENT_MODULE,
  group: GROUP_MODULE,
};
