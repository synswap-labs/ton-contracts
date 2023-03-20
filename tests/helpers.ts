import { beginCell, Cell, Dictionary } from 'ton';
import { Sha256 } from '@aws-crypto/sha256-js';

export type JettonMetaDataKeys = 'name' | 'description' | 'image' | 'symbol';

const jettonOnChainMetadataSpec: {
    [key in JettonMetaDataKeys]: 'utf8' | 'ascii' | undefined;
} = {
    name: 'utf8',
    description: 'utf8',
    image: 'ascii',
    symbol: 'utf8',
};

const ONCHAIN_CONTENT_PREFIX = 0x00;
const SNAKE_PREFIX = 0x00;

export const buildTokenMetadataCell = (data: { [s: string]: string | undefined }): Cell => {
    const CELL_CAPACITY = 1023;
    const PREFIX_SIZE = 8;
    const CELL_MAX_SIZE_BYTES = Math.floor((CELL_CAPACITY - PREFIX_SIZE) / 8);
    const KEYLEN = 256;
    const dict = Dictionary.empty(Dictionary.Keys.Buffer(KEYLEN / 8), Dictionary.Values.Cell());

    Object.entries(data).forEach(([k, v]: [string, string | undefined]) => {
        if (!jettonOnChainMetadataSpec[k as JettonMetaDataKeys]) throw new Error(`Unsupported onchain key: ${k}`);
        if (v === undefined || v === '') return;

        let bufferToStore = Buffer.from(v, jettonOnChainMetadataSpec[k as JettonMetaDataKeys]);

        const rootCell = beginCell();
        rootCell.storeUint(SNAKE_PREFIX, PREFIX_SIZE);
        let currentCell = rootCell;

        while (bufferToStore.length > 0) {
            currentCell.storeBuffer(bufferToStore.subarray(0, CELL_MAX_SIZE_BYTES));
            bufferToStore = bufferToStore.subarray(CELL_MAX_SIZE_BYTES);
            if (bufferToStore.length > 0) {
                let newCell = beginCell();
                currentCell.storeRef(newCell);
                currentCell = newCell;
            }
        }

        dict.set(sha256(k), rootCell.endCell());
    });

    return beginCell().storeInt(ONCHAIN_CONTENT_PREFIX, PREFIX_SIZE).storeDict(dict).endCell();
};

export const sha256 = (str: string) => {
    const sha = new Sha256();
    sha.update(str);
    return Buffer.from(sha.digestSync());
};
