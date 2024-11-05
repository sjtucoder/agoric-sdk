/* global fetch setTimeout */

import test from 'ava';

import { makeWalletUtils } from '@agoric/client-utils';
import { GOV1ADDR, GOV2ADDR } from '@agoric/synthetic-chain';
import { makeGovernanceDriver } from './test-lib/governance.js';
import { networkConfig } from './test-lib/index.js';
import { makeTimerUtils } from './test-lib/utils.js';

const GOV4ADDR = 'agoric1c9gyu460lu70rtcdp95vummd6032psmpdx7wdy';
const governanceAddresses = [GOV4ADDR, GOV2ADDR, GOV1ADDR];

// TODO test-lib export `walletUtils` with this ambient authority like s:stake-bld has
const delay = ms =>
  new Promise(resolve => setTimeout(() => resolve(undefined), ms));

test.serial(
  'economic committee can make governance proposal and vote on it',
  async t => {
    const { waitUntil } = makeTimerUtils({ setTimeout });
    const { readLatestHead, getLastUpdate } = await makeWalletUtils(
      { delay, fetch },
      networkConfig,
    );
    const governanceDriver = await makeGovernanceDriver(fetch, networkConfig);

    /** @type {any} */
    const instance = await readLatestHead(`published.agoricNames.instance`);
    const instances = Object.fromEntries(instance);

    /** @type {any} */
    const wallet = await readLatestHead(
      `published.wallet.${governanceAddresses[0]}.current`,
    );
    const usedInvitations = wallet.offerToUsedInvitation;

    const charterInvitation = usedInvitations.find(
      v =>
        v[1].value[0].instance.getBoardId() ===
        instances.econCommitteeCharter.getBoardId(),
    );

    t.log('proposing on param change');
    const params = {
      ChargingPeriod: 400n,
    };
    const path = { paramPath: { key: 'governedParams' } };

    await governanceDriver.proposeVaultDirectorParamChange(
      governanceAddresses[0],
      params,
      path,
      charterInvitation[0],
    );

    const questionUpdate = await getLastUpdate(governanceAddresses[0]);
    t.like(questionUpdate, {
      status: { numWantsSatisfied: 1 },
    });

    t.log('Voting on param change');
    for (const address of governanceAddresses) {
      /** @type {any} */
      const voteWallet = await readLatestHead(
        `published.wallet.${address}.current`,
      );

      const usedInvitationsForVoter = voteWallet.offerToUsedInvitation;

      const committeeInvitationForVoter = usedInvitationsForVoter.find(
        v =>
          v[1].value[0].instance.getBoardId() ===
          instances.economicCommittee.getBoardId(),
      );
      await governanceDriver.voteOnProposedChanges(
        address,
        committeeInvitationForVoter[0],
      );

      const voteUpdate = await getLastUpdate(address);
      t.like(voteUpdate, {
        status: { numWantsSatisfied: 1 },
      });
    }

    /** @type {any} */
    const latestQuestion = await readLatestHead(
      'published.committees.Economic_Committee.latestQuestion',
    );
    await waitUntil(latestQuestion.closingRule.deadline);

    t.log('check if latest outcome is correct');
    const latestOutcome = await readLatestHead(
      'published.committees.Economic_Committee.latestOutcome',
    );
    t.like(latestOutcome, { outcome: 'win' });
  },
);
