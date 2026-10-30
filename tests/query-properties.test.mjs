import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

const wrap = (nodeAttrs, bondAttrs = '') =>
  `<?xml version="1.0"?><CDXML><page id="1"><fragment id="2"><n id="3" p="0 0" ${nodeAttrs}/><n id="4" p="14 0"/><b id="5" B="3" E="4" ${bondAttrs}/></fragment></page></CDXML>`;
const node = (doc) => doc.pages[0].objects.find((o) => o.id === '3');
const bond = (doc) => doc.pages[0].objects.find((o) => o.id === '5');

test('atom query properties are read as typed fields and written back', () => {
  const source = wrap(
    'SubstituentsUpTo="3" FreeSites="1" RingBondCount="SimpleRing" UnsaturatedBonds="MustBePresent" ImplicitHydrogens="yes" RxnStereo="Retention" Translation="Broad" IsotopicAbundance="Natural"',
    'RxnParticipation="MakeOrBreak" Topology="Ring"',
  );
  const { document } = cdxmlToChemDrawDocument(source);
  assert.deepEqual(node(document).queryProperties, {
    substituentsUpTo: 3,
    freeSites: 1,
    implicitHydrogens: true,
    ringBondCount: 'SimpleRing',
    unsaturatedBonds: 'MustBePresent',
    rxnStereo: 'Retention',
    translation: 'Broad',
    isotopicAbundance: 'Natural',
  });
  assert.equal(bond(document).rxnParticipation, 'MakeOrBreak');
  assert.equal(node(document).preservation?.rawAttributes?.RingBondCount, undefined);
  const once = chemDrawDocumentToCDXML(document);
  for (const attribute of [
    'SubstituentsUpTo="3"',
    'FreeSites="1"',
    'RingBondCount="SimpleRing"',
    'UnsaturatedBonds="MustBePresent"',
    'ImplicitHydrogens="yes"',
    'RxnStereo="Retention"',
    'Translation="Broad"',
    'IsotopicAbundance="Natural"',
    'RxnParticipation="MakeOrBreak"',
  ]) {
    assert.ok(once.includes(attribute), attribute);
  }
  assert.equal(chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(once).document), once);
});

test('a value outside the DTD is left as the file had it', () => {
  const { document } = cdxmlToChemDrawDocument(
    wrap('RingBondCount="Sometimes" SubstituentsExactly="-2"', 'RxnParticipation="Maybe"'),
  );
  assert.equal(node(document).queryProperties, undefined);
  const xml = chemDrawDocumentToCDXML(document);
  assert.ok(xml.includes('RingBondCount="Sometimes"'));
  assert.ok(xml.includes('SubstituentsExactly="-2"'));
  assert.ok(xml.includes('RxnParticipation="Maybe"'));
});

test("the DTD's defaults are the property being absent", () => {
  const { document } = cdxmlToChemDrawDocument(
    wrap(
      'RingBondCount="Unspecified" Translation="Equal" ImplicitHydrogens="no"',
      'RxnParticipation="Unspecified"',
    ),
  );
  assert.equal(node(document).queryProperties, undefined);
  assert.equal(bond(document).rxnParticipation, undefined);
});
