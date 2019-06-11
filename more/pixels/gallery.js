import Nat from '@agoric/nat';
import harden from '@agoric/harden';

import {
  makeCompoundPixelAssayMaker,
  makeTransferRightPixelAssayMaker,
  makeUseRightPixelAssayMaker,
} from './pixelAssays';
import { makeMint } from '../../core/issuers';
import { makeWholePixelList, insistPixelList } from './types/pixelList';
import { makeMintController } from './pixelMintController';
import { makeLruQueue } from './lruQueue';

function mockStateChangeHandler(_newState) {
  // does nothing
}

export function makeGallery(
  stateChangeHandler = mockStateChangeHandler,
  canvasSize = 10,
) {
  function getRandomColor() {
    // TODO: actually getRandomColor in a deterministic way
    // return `#${Math.floor(Math.random() * 16777215).toString(16)}`;
    return '#D3D3D3';
  }

  function makeRandomData() {
    const pixels = [];
    for (let x = 0; x < canvasSize; x += 1) {
      const pixelRow = [];
      for (let y = 0; y < canvasSize; y += 1) {
        pixelRow.push(getRandomColor());
      }
      pixels.push(pixelRow);
    }
    return pixels;
  }
  const state = makeRandomData();

  // provide state the canvas html page
  function getState() {
    return JSON.stringify(state);
  }

  function setPixelState(pixel, newColor) {
    state[pixel.x][pixel.y] = newColor;
    // for now we pass the whole state
    stateChangeHandler(getState());
  }

  // create all pixels (list of raw objs)
  const allPixels = makeWholePixelList(canvasSize);

  // create LRU for "seemingly unpredictable" output from faucet
  const { lruQueue, lruQueueBuilder } = makeLruQueue();

  for (const pixel of allPixels) {
    lruQueueBuilder.push(pixel);
  }
  lruQueueBuilder.resortArbitrarily(allPixels.length, 7);

  // START ERTP

  const makePixelListAssay = makeCompoundPixelAssayMaker(canvasSize);
  const makeTransferAssay = makeTransferRightPixelAssayMaker(canvasSize);
  const makeUseAssay = makeUseRightPixelAssayMaker(canvasSize);

  // a pixel represents the right to color and transfer the right to color
  const pixelMint = makeMint('pixels', makeMintController, makePixelListAssay);
  const pixelIssuer = pixelMint.getIssuer();
  const pixelAssay = pixelIssuer.getAssay();
  const pixelLabel = harden({ issuer: pixelIssuer, description: 'pixels' });

  const transferRightMint = makeMint(
    'pixelTransferRights',
    makeMintController,
    makeTransferAssay,
  );
  const useRightMint = makeMint(
    'pixelUseRights',
    makeMintController,
    makeUseAssay,
  );
  const useRightIssuer = useRightMint.getIssuer();
  const useRightAssay = useRightIssuer.getAssay();
  const transferRightIssuer = transferRightMint.getIssuer();
  const transferRightAssay = transferRightIssuer.getAssay();

  // get the pixelList from the LRU
  function makePixelPayment(rawPixelList) {
    insistPixelList(rawPixelList, canvasSize);
    const pixelAmount = {
      label: pixelLabel,
      quantity: rawPixelList,
    };
    // we need to create this, since it was just destroyed
    const newGalleryPurse = pixelMint.mint(pixelAmount, 'gallery');
    const payment = newGalleryPurse.withdraw(pixelAmount);
    return payment;
  }

  const gallerySplitPixelPurse = pixelIssuer.makeEmptyPurse();

  // split pixelList into UseRights and TransferRights
  async function transformToTransferAndUse(pixelListPaymentP) {
    return Promise.resolve(pixelListPaymentP).then(async pixelListPayment => {
      const pixelListAmount = pixelListPayment.getBalance();

      const exclusivePayment = await pixelIssuer.getExclusiveAll(
        pixelListPayment,
      );
      await gallerySplitPixelPurse.depositAll(exclusivePayment); // conserve pixels

      const { transferAmount, useAmount } = pixelAssay.toTransferAndUseRights(
        pixelListAmount,
        useRightAssay,
        transferRightAssay,
      );

      const transferRightPurse = transferRightMint.mint(transferAmount);
      const useRightPurse = useRightMint.mint(useAmount);

      const transferRightPayment = await transferRightPurse.withdrawAll(
        'transferRights',
      );
      const useRightPayment = await useRightPurse.withdrawAll('useRights');

      return {
        transferRightPayment,
        useRightPayment,
      };
    });
  }

  // merge UseRights and TransferRights into a pixel
  async function transformToPixel(transferRightPaymentP) {
    return Promise.resolve(transferRightPaymentP).then(
      async transferRightPayment => {
        // someone else may have the useRightPayment so we must destroy the
        // useRight

        // we have an exclusive on the transfer right
        const transferAmount = transferRightPayment.getBalance();
        await transferRightIssuer.getExclusiveAll(transferRightPayment);

        const pixelListAmount = transferRightAssay.toPixel(
          transferAmount,
          pixelAssay,
        );

        const { useAmount } = pixelAssay.toTransferAndUseRights(
          pixelListAmount,
          useRightAssay,
          transferRightAssay,
        );

        // commit point
        await useRightMint.destroy(useAmount);
        await transferRightMint.destroy(transferAmount);

        const pixelPayment = await gallerySplitPixelPurse.withdraw(
          pixelListAmount,
          'pixels',
        ); // conserve pixels
        return pixelPayment;
      },
    );
  }

  function insistColor(_myColor) {
    // TODO: check whether allowed
  }

  async function changeColor(useRightPaymentP, newColor) {
    return Promise.resolve(useRightPaymentP).then(async useRightPayment => {
      const emptyAmount = useRightAssay.make(harden([]));

      // withdraw empty amount from payment
      // if this doesn't error, it was a useRightPayment
      useRightIssuer.getExclusive(emptyAmount, useRightPaymentP);

      const pixelAmount = useRightPayment.getBalance();

      if (useRightAssay.isEmpty(pixelAmount)) {
        throw new Error('no use rights present');
      }
      insistColor(newColor);

      const pixelList = useRightAssay.quantity(pixelAmount);

      for (let i = 0; i < pixelList.length; i += 1) {
        const pixel = pixelList[i];
        setPixelState(pixel, newColor);
      }
      return pixelAmount;
    });
  }

  function revokePixel(rawPixel) {
    const pixelList = harden([rawPixel]);
    const pixelAmount = pixelAssay.make(pixelList);
    const useRightAmount = useRightAssay.make(pixelList);
    const transferRightAmount = transferRightAssay.make(pixelList);

    pixelMint.destroy(pixelAmount);
    useRightMint.destroy(useRightAmount);
    transferRightMint.destroy(transferRightAmount);
  }

  function tapFaucet() {
    const rawPixel = lruQueue.popToTail();
    revokePixel(rawPixel);
    return makePixelPayment(harden([rawPixel]));
  }

  // anyone can getColor, no restrictions, no tokens
  function getColor(x, y) {
    const rawPixel = { x: Nat(x), y: Nat(y) };
    return state[rawPixel.x][rawPixel.y];
  }

  function getIssuers() {
    return {
      pixelIssuer,
      useRightIssuer,
      transferRightIssuer,
    };
  }

  const userFacet = {
    changeColor,
    getColor,
    tapFaucet,
    transformToTransferAndUse,
    transformToPixel,
    getIssuers,
    getCanvasSize() {
      return canvasSize;
    },
  };

  const adminFacet = {
    revokePixel,
  };

  const readFacet = {
    getState,
    getColor,
  };

  const gallery = {
    userFacet,
    adminFacet,
    readFacet,
  };

  return gallery;
}
