import { Cell } from 'ton-core';
import fs from 'fs';

const walletJSON = JSON.parse(fs.readFileSync('./build/JettonMinter.compiled.json').toString());

export class JettonWallet {
    static readonly code = Cell.fromBoc(Buffer.from(walletJSON.hex, 'hex'))[0];
}
