import '@agoric/install-ses';
import { test } from 'tape-promise/tape';
import path from 'path';
import {
  initSwingStore,
  getAllState,
  setAllState,
} from '@agoric/swing-store-simple';
import { buildVatController, loadBasedir } from '../src/index';

test('transcript-light load', async t => {
  const config = await loadBasedir(
    path.resolve(__dirname, 'basedir-transcript'),
  );
  const { storage } = initSwingStore();
  config.hostStorage = storage;
  const c = await buildVatController(config, ['one']);
  const state0 = getAllState(storage);
  t.equal(state0.initialized, 'true');
  t.notEqual(state0.runQueue, '[]');

  await c.step();
  const state1 = getAllState(storage);

  await c.step();
  const state2 = getAllState(storage);

  await c.step();
  const state3 = getAllState(storage);

  await c.step();
  const state4 = getAllState(storage);

  await c.step();
  const state5 = getAllState(storage);

  // build from loaded state
  // Step 0

  const cfg0 = await loadBasedir(path.resolve(__dirname, 'basedir-transcript'));
  const storage0 = initSwingStore().storage;
  setAllState(storage0, state0);
  cfg0.hostStorage = storage0;
  const c0 = await buildVatController(cfg0, ['one']);

  await c0.step();
  t.deepEqual(state1, getAllState(storage0), `p1`);

  await c0.step();
  t.deepEqual(state2, getAllState(storage0), `p2`);

  await c0.step();
  t.deepEqual(state3, getAllState(storage0), `p3`);

  await c0.step();
  t.deepEqual(state4, getAllState(storage0), `p4`);

  await c0.step();
  t.deepEqual(state5, getAllState(storage0), `p5`);

  // Step 1

  const cfg1 = await loadBasedir(path.resolve(__dirname, 'basedir-transcript'));
  const storage1 = initSwingStore().storage;
  setAllState(storage1, state1);
  cfg1.hostStorage = storage1;
  const c1 = await buildVatController(cfg1, ['one']);

  t.deepEqual(state1, getAllState(storage1), `p6`); // actual, expected

  await c1.step();
  t.deepEqual(state2, getAllState(storage1), `p7`);

  await c1.step();
  t.deepEqual(state3, getAllState(storage1), `p8`);

  await c1.step();
  t.deepEqual(state4, getAllState(storage1), `p9`);

  await c1.step();
  t.deepEqual(state5, getAllState(storage1), `p10`);

  // Step 2

  const cfg2 = await loadBasedir(path.resolve(__dirname, 'basedir-transcript'));
  const storage2 = initSwingStore().storage;
  setAllState(storage2, state2);
  cfg2.hostStorage = storage2;
  const c2 = await buildVatController(cfg2, ['one']);

  t.deepEqual(state2, getAllState(storage2), `p11`);

  await c2.step();
  t.deepEqual(state3, getAllState(storage2), `p12`);

  await c2.step();
  t.deepEqual(state4, getAllState(storage2), `p13`);

  await c2.step();
  t.deepEqual(state5, getAllState(storage2), `p14`);

  t.end();
});
