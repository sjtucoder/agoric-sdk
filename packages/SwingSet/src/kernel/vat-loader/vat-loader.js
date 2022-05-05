// @ts-check
import { assert, details as X } from '@agoric/assert';
import { assertKnownOptions } from '../../lib/assertOptions.js';
import { makeVatSlot } from '../../lib/parseVatSlots.js';

export function makeVatRootObjectSlot() {
  return makeVatSlot('object', true, 0n);
}

export function makeVatLoader(stuff) {
  const {
    overrideVatManagerOptions = {},
    vatManagerFactory,
    kernelSlog,
    makeSourcedConsole,
    kernelKeeper,
    panic,
    buildVatSyscallHandler,
    vatAdminRootKref,
  } = stuff;

  /** @typedef {ReturnType<typeof import('../vatTranslator.js').makeVatTranslators>} Translators */

  /**
   * Create a new vat at runtime (called when a 'create-vat' event reaches
   * the top of the run-queue).
   *
   * @param { string } vatID  The pre-allocated vatID
   * @param { SourceOfBundle } source  The source object implementing the vat
   * @param { Translators } translators
   * @param {*} dynamicOptions  Options bag governing vat creation
   *
   * @returns {Promise<VatManager>}
   */
  function createVatDynamically(
    vatID,
    source,
    translators,
    dynamicOptions = {},
  ) {
    assert(vatAdminRootKref, `initializeKernel did not set vatAdminRootKref`);
    // eslint-disable-next-line no-use-before-define
    return create(vatID, source, translators, dynamicOptions, true);
  }

  /**
   * Recreate a dynamic vat from persistent state at kernel startup time.
   *
   * @param {string} vatID  The vatID of the vat to create
   * @param { SourceOfBundle } source  The source object implementing the vat
   * @param { Translators } translators
   * @param {*} dynamicOptions  Options bag governing vat creation
   *
   * @returns {Promise<VatManager>} fires when the vat is ready for messages
   */
  function recreateDynamicVat(vatID, source, translators, dynamicOptions) {
    // eslint-disable-next-line no-use-before-define
    return create(vatID, source, translators, dynamicOptions, true).catch(
      err => {
        panic(`unable to re-create vat ${vatID}`, err);
        throw err;
      },
    );
    // if we fail to recreate the vat during replay, crash the kernel,
    // because we no longer have any way to inform the original caller
  }

  /**
   * Recreate a static vat from persistent state at kernel startup time.
   *
   * @param {string} vatID  The vatID of the vat to create
   * @param { SourceOfBundle } source  The source object implementing the vat
   * @param { Translators } translators
   * @param {*} staticOptions  Options bag governing vat creation
   *
   * @returns {Promise<VatManager>} A Promise which fires when the
   * vat is ready for messages.
   */
  function recreateStaticVat(vatID, source, translators, staticOptions) {
    // eslint-disable-next-line no-use-before-define
    return create(vatID, source, translators, staticOptions, false).catch(
      err => {
        panic(`unable to re-create vat ${vatID}`, err);
        throw err;
      },
    );
  }

  const allowedDynamicOptions = [
    'description',
    'meterID',
    'managerType', // TODO: not sure we want vats to be able to control this
    'enableSetup',
    'enablePipelining',
    'virtualObjectCacheSize',
    'useTranscript',
    'reapInterval',
  ];

  const allowedStaticOptions = [
    'description',
    'name',
    'managerType',
    'enableDisavow',
    'enableSetup',
    'enablePipelining',
    'virtualObjectCacheSize',
    'useTranscript',
    'reapInterval',
  ];

  /**
   * Instantiate a new vat.  The root object will be available soon, but we
   * immediately return the vatID so the ultimate requestor doesn't have to
   * wait.
   *
   * @param {string} vatID  The vatID for the new vat
   * @param {SourceOfBundle} source
   *    an object which either has a `bundle` (JSON-serializable
   *    data), a `bundleName` string, or a `bundleID` string. The bundle
   *    defines the vat, and should be generated by calling bundle-source on
   *    a module with an export named `makeRootObject()` (or possibly
   *    `setup()` if the 'enableSetup' option is true). If `bundleName` is
   *    used, it must identify a bundle already known to the kernel (via the
   *    `config.bundles` table) which satisfies these constraints.
   *
   * @param { Translators } translators
   *
   * @param {object} options  an options bag. These options are currently understood:
   *
   * @param {ManagerType} options.managerType
   *
   * @param {number} options.virtualObjectCacheSize
   *
   * @param {string} [options.meterID] If a meterID is provided, the new
   *        dynamic vat is limited to a fixed amount of computation and
   *        allocation that can occur during any given crank. Peak stack
   *        frames are limited as well. In addition, the given meter's
   *        "remaining" value will be reduced by the amount of computation
   *        used by each crank. The meter will eventually underflow unless it
   *        is topped up, at which point the vat is terminated. If undefined,
   *        the vat is unmetered. Static vats cannot be metered.
   *
   * @param {boolean} [options.enableSetup] If true,
   *        permits the vat to construct itself using the
   *        `setup()` API, which bypasses the imposition of LiveSlots but
   *        requires the vat implementation to enforce the vat invariants
   *        manually.  If false, the vat will be constructed using the
   *        `buildRootObject()` API, which uses LiveSlots to enforce the vat
   *        invariants automatically.  Defaults to false.
   *
   * @param {boolean} [options.enablePipelining] If true,
   *        permits the kernel to pipeline messages to
   *        promises for which the vat is the decider directly to the vat
   *        without waiting for the promises to be resolved.  If false, such
   *        messages will be queued inside the kernel.  Defaults to false.
   *
   * @param {boolean} [options.useTranscript] If true, saves a transcript of a
   *        vat's inbound deliveries and outbound syscalls so that the vat's
   *        internal state can be reconstructed via replay.  If false, no such
   *        record is kept.  Defaults to true.
   *
   * @param {number|'never'} [options.reapInterval] The interval (measured
   *        in number of deliveries to the vat) after which the kernel will
   *        deliver the 'bringOutYourDead' directive to the vat.  If the value
   *        is 'never', 'bringOutYourDead' will never be delivered and the vat
   *        will be responsible for internally managing (in a deterministic
   *        manner) any visible effects of garbage collection.  Defaults to the
   *        kernel's configured 'defaultReapInterval' value.
   *
   * @param {string} [options.name]
   * @param {string} [options.description]
   * @param {boolean} [options.enableDisavow]
   *
   * @param {boolean} isDynamic  If true, the vat being created is a dynamic vat;
   *    if false, it's a static vat (these have differences in their allowed
   *    options and some of their option defaults).
   *
   * @returns {Promise<VatManager>} A Promise which fires when the
   * vat is ready for messages.
   */
  async function create(vatID, source, translators, options, isDynamic) {
    assert(
      'bundle' in source || 'bundleName' in source || 'bundleID' in source,
      'broken source',
    );
    let vatSourceBundle;
    let sourceDesc;
    if ('bundle' in source) {
      vatSourceBundle = source.bundle;
      // TODO: maybe hash the bundle object somehow for the description
      sourceDesc = 'from source bundle';
    } else if ('bundleName' in source) {
      vatSourceBundle = kernelKeeper.getNamedBundle(source.bundleName);
      assert(vatSourceBundle, `unknown bundle name ${source.bundleName}`);
      sourceDesc = `from bundleName: ${source.bundleName}`;
    } else if ('bundleID' in source) {
      vatSourceBundle = kernelKeeper.getBundle(source.bundleID);
      assert(vatSourceBundle, `unknown bundleID ${source.bundleID}`);
      sourceDesc = `from bundleID: ${source.bundleID}`;
    } else {
      assert.fail(X`unknown vat source descriptor ${source}`);
    }
    assert.typeof(vatSourceBundle, 'object', `vat creation requires bundle`);

    assertKnownOptions(
      options,
      isDynamic ? allowedDynamicOptions : allowedStaticOptions,
    );
    const {
      meterID,
      managerType,
      enableSetup = false,
      enableDisavow = false,
      enablePipelining = false,
      virtualObjectCacheSize,
      useTranscript = true,
      name,
    } = options;

    const description = `${options.description || ''} (${sourceDesc})`.trim();

    const { starting } = kernelSlog.provideVatSlogger(
      vatID,
      isDynamic,
      description,
      name,
      vatSourceBundle,
      managerType,
    );

    const managerOptions = {
      managerType,
      bundle: vatSourceBundle,
      metered: !!meterID,
      enableDisavow,
      enableSetup,
      enablePipelining,
      sourcedConsole: makeSourcedConsole(vatID),
      virtualObjectCacheSize,
      useTranscript,
      name,
      ...overrideVatManagerOptions,
    };

    const vatSyscallHandler = buildVatSyscallHandler(vatID, translators);

    const finish = starting && kernelSlog.startup(vatID);
    const manager = await vatManagerFactory(
      vatID,
      managerOptions,
      vatSyscallHandler,
    );
    starting && finish();
    return manager;
  }

  async function loadTestVat(vatID, setup, translators, creationOptions) {
    const managerOptions = {
      ...creationOptions,
      setup,
      enableSetup: true,
      managerType: 'local',
      useTranscript: true,
      ...overrideVatManagerOptions,
    };
    const vatSyscallHandler = buildVatSyscallHandler(vatID, translators);
    const manager = await vatManagerFactory(
      vatID,
      managerOptions,
      vatSyscallHandler,
    );
    return manager;
  }

  return harden({
    createVatDynamically,
    recreateDynamicVat,
    recreateStaticVat,
    loadTestVat,
  });
}
