import { Cell } from 'ton-core';
import fs from 'fs';

const minterJSON = JSON.parse(fs.readFileSync('./build/JettonMinter.compiled.json').toString());

export class JettonMinter {
    static readonly code = Cell.fromBoc(Buffer.from(minterJSON.hex, 'hex'))[0];
}
